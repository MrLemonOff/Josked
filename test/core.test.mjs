import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

import {
  adviceFor,
  createSpacedQueue,
  estimatePasswordStrength,
  formatDay,
  isValidEmail,
  isValidPrefix,
  normalizeEmail,
  parseBreachCatalogue,
  parseCharacteristics,
  parseEmailAnalytics,
  parsePasswordResponse,
  passwordPrefix,
  reportMarkdown,
  reportModel,
  riskKey,
  safeUrl,
  verdictFor,
} from '../public/js/core.js';
import { buildReportPdf } from '../public/js/report-pdf.js';

// Loads the vendored js-sha3 the same way a browser would, so the test uses the real hash.
function loadKeccak512() {
  const ctx = {};
  ctx.window = ctx;
  ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(readFileSync(new URL('../public/vendor/sha3.min.js', import.meta.url), 'utf8'), ctx);
  const fn = ctx.keccak512 ?? ctx.window?.keccak512;
  assert.equal(typeof fn, 'function', 'vendored keccak512 should be exposed');
  return fn;
}

// Loads jsPDF and the autotable plugin the way a browser does, on a fake window.
function loadJsPDF() {
  const ctx = {
    navigator: { userAgent: 'node-test' },
    location: { origin: 'null', href: 'x' },
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
  };
  ctx.window = ctx;
  ctx.self = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(readFileSync(new URL('../public/vendor/jspdf.umd.min.js', import.meta.url), 'utf8'), ctx, { filename: 'jspdf.js' });
  vm.runInContext(readFileSync(new URL('../public/vendor/jspdf.plugin.autotable.min.js', import.meta.url), 'utf8'), ctx, { filename: 'autotable.js' });
  assert.equal(typeof ctx.jspdf?.jsPDF?.API?.autoTable, 'function', 'jsPDF with autotable should load');
  return ctx.jspdf.jsPDF;
}

const keccak512 = loadKeccak512();

const sampleResult = () => parseEmailAnalytics({
  ExposedBreaches: {
    breaches_details: [
      { breach: 'Alpha', domain: 'alpha.example', xposed_date: '2024', added: '2025-03-01T00:00:00+00:00', xposed_data: 'Email addresses;Passwords', xposed_records: 5000, password_risk: 'plaintext', verified: 'Yes', details: 'Plain text passwords were stored.' },
      { breach: 'Beta | Pipe', domain: 'beta.example', xposed_date: '2023', added: '2024-01-01', xposed_data: 'Phone numbers', xposed_records: 1200000, password_risk: 'stronghash', verified: 'No' },
    ],
  },
  BreachMetrics: { risk: [{ risk_label: 'Critical', risk_score: 95 }], passwords_strength: [{ PlainText: 1, StrongHash: 1 }] },
});

test('normalizeEmail trims and lowercases', () => {
  assert.equal(normalizeEmail('  Name@Example.COM  '), 'name@example.com');
  assert.equal(normalizeEmail(undefined), '');
});

test('isValidEmail accepts normal addresses and rejects junk', () => {
  assert.equal(isValidEmail('test@example.com'), true);
  assert.equal(isValidEmail('no-at-sign.example.com'), false);
  assert.equal(isValidEmail('a b@example.com'), false);
  assert.equal(isValidEmail(`${'a'.repeat(250)}@x.co`), false);
});

test('passwordPrefix matches Keccak-512 of the password (value from the live API)', () => {
  // "password" is in the XposedOrNot data with count 1590937 under this prefix.
  assert.equal(passwordPrefix('password', keccak512), 'a6818b8188');
  assert.equal(isValidPrefix(passwordPrefix('anything at all', keccak512)), true);
  assert.equal(isValidPrefix('ABC'), false);
});

test('parsePasswordResponse reads the count and characteristics', () => {
  const found = parsePasswordResponse({
    SearchPassAnon: { anon: 'a6818b8188', char: 'D:0;A:8;S:0;L:8', count: '1590937', wordlist: 0 },
  });
  assert.equal(found.found, true);
  assert.equal(found.count, 1590937);
  assert.deepEqual(found.characteristics, { digits: 0, alphabets: 8, special: 0, length: 8 });

  const missing = parsePasswordResponse(null);
  assert.equal(missing.found, false);
  assert.equal(missing.count, 0);
  assert.equal(missing.characteristics, null);
});

test('parseCharacteristics ignores unknown keys and handles empty input', () => {
  assert.equal(parseCharacteristics(''), null);
  assert.deepEqual(parseCharacteristics('X:9;L:4'), { digits: 0, alphabets: 0, special: 0, length: 4 });
});

test('parseEmailAnalytics maps breaches, risk and password counts', () => {
  const json = {
    ExposedBreaches: {
      breaches_details: [
        { breach: 'Older', domain: 'old.example', xposed_date: '2019', added: '2021-01-01', xposed_data: 'Email addresses;Passwords', xposed_records: 1200, password_risk: 'plaintext', verified: 'Yes', searchable: 'Yes', details: 'Old leak', references: 'https://example.com/x' },
        { breach: 'Newer', domain: 'new.example', xposed_date: '2026', added: '2026-10-02', xposed_data: 'Phone numbers', xposed_records: '6,800,000', password_risk: 'Unknown', verified: 'No', references: 'javascript:alert(1)' },
      ],
    },
    ExposedPastes: null,
    BreachMetrics: {
      risk: [{ risk_label: 'High', risk_score: 80 }],
      passwords_strength: [{ EasyToCrack: 0, PlainText: 1, StrongHash: 0, Unknown: 1 }],
    },
  };
  const r = parseEmailAnalytics(json);
  assert.equal(r.found, true);
  assert.equal(r.breaches.length, 2);
  assert.equal(r.breaches[0].name, 'Newer', 'newest added should come first');
  assert.equal(r.breaches[1].passwordRisk, 'plaintext');
  assert.equal(r.breaches[1].verified, true);
  assert.equal(r.breaches[1].reference, 'https://example.com/x');
  assert.equal(r.breaches[0].reference, '', 'javascript: links must be dropped');
  assert.equal(r.breaches[0].records, 6800000);
  assert.deepEqual(r.dataTypes, ['Email addresses', 'Passwords', 'Phone numbers']);
  assert.equal(r.risk.label, 'High');
  assert.equal(r.passwords.plainText, 1);
  assert.equal(r.latestAdded, '2026-10-02');
});

test('parseEmailAnalytics handles a clean email', () => {
  const r = parseEmailAnalytics({ BreachMetrics: null, ExposedBreaches: null, ExposedPastes: null });
  assert.equal(r.found, false);
  assert.equal(r.breaches.length, 0);
  assert.equal(r.risk.label, 'None');
});

test('pastes alone still count as found', () => {
  const r = parseEmailAnalytics({ ExposedBreaches: null, ExposedPastes: [{ id: 1 }, { id: 2 }] });
  assert.equal(r.found, true);
  assert.equal(r.pasteCount, 2);
});

test('parseBreachCatalogue normalises gallery entries', () => {
  const list = parseBreachCatalogue({
    exposedBreaches: [
      { breachID: 'DoubleCounter', breachedDate: '2026-10-01T00:00:00+00:00', addedDate: '2026-10-11T05:51:02+00:00', domain: 'doublecounter.gg', logo: 'https://xposedornot.com/static/logos/DoubleCounter.png', passwordRisk: 'PlainText', verified: true, sensitive: false, exposedData: ['Email addresses', 'Names'], exposedRecords: 294741, exposureDescription: 'desc' },
    ],
  });
  assert.equal(list.length, 1);
  assert.equal(list[0].name, 'DoubleCounter');
  assert.equal(list[0].breachedDate, '2026-10-01');
  assert.equal(list[0].passwordRisk, 'plaintext');
  assert.deepEqual(list[0].dataTypes, ['Email addresses', 'Names']);
  assert.equal(list[0].verified, true);
  assert.deepEqual(parseBreachCatalogue({}), []);
});

test('riskKey and safeUrl sanitise third-party values', () => {
  assert.equal(riskKey('Easy-To-Crack'), 'easytocrack');
  assert.equal(riskKey(undefined), 'unknown');
  assert.equal(safeUrl('https://xposedornot.com/a.png'), 'https://xposedornot.com/a.png');
  assert.equal(safeUrl('http://insecure.example/a.png'), '');
  assert.equal(safeUrl('javascript:alert(1)'), '');
});

test('estimatePasswordStrength rates weak and strong passwords', () => {
  assert.equal(estimatePasswordStrength('').score, 0);
  assert.ok(estimatePasswordStrength('aaaaaaaaaaaa').score <= 1, 'repeated characters must not score high');
  assert.ok(estimatePasswordStrength('p4ssw0rd').score <= 2);
  assert.ok(estimatePasswordStrength('correct-Horse-battery-42!').score >= 3);
});

test('adviceFor puts plain-text warnings first when they apply', () => {
  const r = parseEmailAnalytics({
    ExposedBreaches: { breaches_details: [{ breach: 'X', password_risk: 'plaintext', xposed_data: 'Passwords' }] },
    BreachMetrics: { passwords_strength: [{ PlainText: 1 }] },
  });
  const advice = adviceFor(r);
  assert.equal(advice[0].tone, 'danger');
  assert.match(advice[0].title, /plain text/i);
  assert.ok(advice.some((a) => /sessions/i.test(a.title)), 'leaked passwords should suggest signing out sessions');
});

test('formatDay shows calendar days without a time-zone shift', () => {
  assert.equal(formatDay('2026-10-02'), 'Oct 2, 2026');
  assert.equal(formatDay('2026-10-01T00:00:00+00:00'), 'Oct 1, 2026');
  assert.equal(formatDay('2026'), '2026');
  assert.equal(formatDay(''), '—');
});

test('verdictFor picks the tone from risk and plain-text passwords', () => {
  const found = verdictFor({ ...sampleResult(), email: 'a@b.co' });
  assert.equal(found.tone, 'danger');
  assert.equal(found.title, 'Found in 2 breaches');
  const clean = verdictFor({ found: false, email: 'a@b.co', breaches: [], pasteCount: 0, risk: { label: 'None' }, passwords: { plainText: 0 } });
  assert.equal(clean.tone, 'ok');
  assert.equal(clean.title, 'No breaches found');
});

test('reportMarkdown writes a table and escapes pipes', () => {
  const r = parseEmailAnalytics({
    ExposedBreaches: { breaches_details: [{ breach: 'Pipe|Name', domain: 'a.example', xposed_date: '2024', xposed_data: 'Names' }] },
    BreachMetrics: { risk: [{ risk_label: 'Medium', risk_score: 40 }] },
  });
  const md = reportMarkdown({ email: 'you@example.com', result: r, date: '2026-10-11' });
  assert.match(md, /^# Josked breach report/m);
  assert.match(md, /\| Service \| Domain \| Year \| Records \| Exposed data \| Passwords \| Verified \|/);
  assert.match(md, /Pipe\\\|Name/);
  assert.match(md, /- \[ \] \*\*/);
});

test('reportModel orders rows, limits detail sections and formats stats', () => {
  const m = reportModel(sampleResult(), { email: 'a@b.co', checkedAt: '2026-10-11T12:00:00Z', generatedAt: new Date('2026-10-11T00:00:00Z') });
  assert.equal(m.rows.length, 2);
  assert.equal(m.rows[0].name, 'Alpha');
  assert.equal(m.rows[0].passwords, 'Plain text');
  assert.equal(m.rows[1].records, '1.2M');
  assert.equal(m.stats[0].value, '2');
  assert.equal(m.stats[3].value, 'Mar 1, 2025');
  assert.equal(m.details.length, 2);
  assert.equal(m.generatedAt, 'Oct 11, 2026');
});

test('buildReportPdf produces a valid multi-page PDF', () => {
  const JsPDF = loadJsPDF();
  const big = sampleResult();
  // 120 breaches forces several pages, so the table, repeated header and footers all run.
  big.breaches = Array.from({ length: 120 }, (_, i) => ({ ...big.breaches[i % 2], name: `Breach ${i} é “quoted” — ok` }));
  const model = reportModel(big, { email: 'a@b.co', checkedAt: new Date(), generatedAt: new Date() });
  const doc = buildReportPdf(model, JsPDF);
  const bytes = Buffer.from(doc.output('arraybuffer'));
  assert.equal(bytes.subarray(0, 5).toString('latin1'), '%PDF-');
  assert.ok(doc.getNumberOfPages() > 2, 'long tables should span several pages');
});

test('buildReportPdf still works for a clean email and for paste-only results', () => {
  const JsPDF = loadJsPDF();
  const clean = reportModel({ found: false, email: 'a@b.co', breaches: [], pasteCount: 0, risk: { label: 'None' }, passwords: { plainText: 0 }, dataTypes: [], latestAdded: '' }, { email: 'a@b.co' });
  assert.equal(buildReportPdf(clean, JsPDF).getNumberOfPages(), 1);
  const pasteOnly = reportModel({ found: true, email: 'a@b.co', breaches: [], pasteCount: 3, risk: { label: 'Medium' }, passwords: { plainText: 0 }, dataTypes: [], latestAdded: '' }, { email: 'a@b.co' });
  assert.ok(buildReportPdf(pasteOnly, JsPDF).getNumberOfPages() >= 1);
});

test('createSpacedQueue starts tasks at least gapMs apart and keeps order', async () => {
  let clock = 0;
  const sleeps = [];
  const enqueue = createSpacedQueue(1100, {
    now: () => clock,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
  });
  const starts = [];
  const task = (name) => async () => {
    starts.push([name, clock]);
    return name;
  };
  const results = await Promise.all([enqueue(task('a')), enqueue(task('b')), enqueue(task('c'))]);
  assert.deepEqual(results, ['a', 'b', 'c']);
  assert.deepEqual(starts.map(([, t]) => t), [0, 1100, 2200]);
  assert.deepEqual(sleeps, [1100, 1100]);
});

test('createSpacedQueue keeps going after a task fails', async () => {
  let clock = 0;
  const enqueue = createSpacedQueue(10, { now: () => clock, sleep: async (ms) => { clock += ms; } });
  await assert.rejects(enqueue(async () => { throw new Error('boom'); }), /boom/);
  assert.equal(await enqueue(async () => 'ok'), 'ok');
});
