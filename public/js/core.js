// Pure helpers: no DOM, no network. The browser UI, the report builders and the tests all use this file.

export const EMAIL_API = 'https://api.xposedornot.com/v1';
export const PASSWORD_API = 'https://passwords.xposedornot.com/api/v1';

// XposedOrNot's free tier allows about one request per second, so every upstream call is spaced out.
export const RATE_GAP_MS = 1100;

// How many breaches get a written section in the PDF and Markdown reports. The table lists them all.
export const DETAIL_LIMIT = 15;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// label is the short form used in tables. tag is the sentence shown on cards.
export const PASSWORD_RISK = {
  plaintext: { label: 'Plain text', tag: 'Passwords in plain text', tone: 'danger' },
  easytocrack: { label: 'Easy to crack', tag: 'Passwords easy to crack', tone: 'danger' },
  stronghash: { label: 'Strong hash', tag: 'Passwords strongly hashed', tone: 'warn' },
  unknown: { label: 'Unknown', tag: 'Password storage unknown', tone: 'muted' },
};

export function normalizeEmail(raw) {
  return String(raw ?? '').trim().toLowerCase();
}

export function isValidEmail(email) {
  return email.length <= 254 && EMAIL_RE.test(email);
}

// The hash function is passed in so this module never reaches for a global.
export function passwordPrefix(password, keccak512) {
  return keccak512(password).slice(0, 10);
}

export function isValidPrefix(prefix) {
  return /^[0-9a-f]{10}$/.test(prefix);
}

export function toNumber(value) {
  const n = Number(String(value ?? '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

export function isYes(value) {
  return value === true || /^(yes|true)$/i.test(String(value ?? ''));
}

export function splitList(value) {
  if (Array.isArray(value)) return value.map(String).map((s) => s.trim()).filter(Boolean);
  return String(value ?? '').split(';').map((s) => s.trim()).filter(Boolean);
}

// Only https links reach the page. Breach data comes from a third party, so it is treated as untrusted.
export function safeUrl(value) {
  const s = String(value ?? '').trim();
  return /^https:\/\//i.test(s) ? s : '';
}

export function riskKey(value) {
  return String(value ?? 'unknown').toLowerCase().replace(/[^a-z]/g, '') || 'unknown';
}

// Formatting. Breach dates are calendar days, so they are shown in UTC to avoid a one-day shift.

export function formatCount(n) {
  return new Intl.NumberFormat('en-US').format(n);
}

export function formatCompact(n) {
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

// "2026" stays as it is. Any other date becomes "Oct 2, 2026".
export function formatDay(value) {
  if (value instanceof Date) value = value.toISOString();
  const s = String(value ?? '');
  if (!s) return '—';
  if (/^\d{4}$/.test(s)) return s;
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00Z` : s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

// A moment in time, shown in the viewer's own time zone.
export function formatDateTime(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function parseCharacteristics(text) {
  const map = { D: 'digits', A: 'alphabets', S: 'special', L: 'length' };
  const out = { digits: 0, alphabets: 0, special: 0, length: 0 };
  let seen = false;
  for (const part of String(text ?? '').split(';')) {
    const [key, value] = part.split(':', 2);
    if (map[key] && value !== undefined) {
      out[map[key]] = Number.parseInt(value, 10) || 0;
      seen = true;
    }
  }
  return seen ? out : null;
}

function normalizeEmailBreach(b) {
  return {
    name: String(b.breach ?? 'Unknown breach'),
    domain: String(b.domain ?? ''),
    industry: String(b.industry ?? ''),
    logo: safeUrl(b.logo),
    date: String(b.xposed_date ?? ''),
    added: String(b.added ?? ''),
    records: toNumber(b.xposed_records),
    dataTypes: splitList(b.xposed_data),
    passwordRisk: riskKey(b.password_risk),
    verified: isYes(b.verified),
    searchable: isYes(b.searchable),
    description: String(b.details ?? ''),
    reference: safeUrl(b.references),
  };
}

// Turns a /v1/breach-analytics response into the shape the UI renders.
export function parseEmailAnalytics(json) {
  const details = json?.ExposedBreaches?.breaches_details;
  const breaches = Array.isArray(details) ? details.map(normalizeEmailBreach) : [];
  breaches.sort((a, b) => b.added.localeCompare(a.added));

  const pastes = Array.isArray(json?.ExposedPastes) ? json.ExposedPastes : [];
  const risk = json?.BreachMetrics?.risk?.[0];
  const strength = json?.BreachMetrics?.passwords_strength?.[0] ?? {};

  return {
    found: breaches.length > 0 || pastes.length > 0,
    breaches,
    pasteCount: pastes.length,
    risk: {
      label: String(risk?.risk_label ?? (breaches.length ? 'Unknown' : 'None')),
      score: toNumber(risk?.risk_score),
    },
    passwords: {
      plainText: toNumber(strength.PlainText),
      easyToCrack: toNumber(strength.EasyToCrack),
      strongHash: toNumber(strength.StrongHash),
      unknown: toNumber(strength.Unknown),
    },
    dataTypes: [...new Set(breaches.flatMap((b) => b.dataTypes))].sort(),
    latestAdded: breaches[0]?.added ?? '',
  };
}

// Turns a /v1/breaches response into gallery cards.
export function parseBreachCatalogue(json) {
  const list = Array.isArray(json?.exposedBreaches) ? json.exposedBreaches : [];
  return list.map((b) => ({
    name: String(b.breachID ?? ''),
    domain: String(b.domain ?? ''),
    industry: String(b.industry ?? ''),
    logo: safeUrl(b.logo),
    breachedDate: String(b.breachedDate ?? '').slice(0, 10),
    added: String(b.addedDate ?? '').slice(0, 10),
    records: toNumber(b.exposedRecords),
    dataTypes: splitList(b.exposedData),
    passwordRisk: riskKey(b.passwordRisk),
    verified: isYes(b.verified),
    sensitive: isYes(b.sensitive),
    searchable: isYes(b.searchable),
    type: String(b.breachType ?? ''),
    description: String(b.exposureDescription ?? ''),
  }));
}

// Turns a passwords.xposedornot.com response into a count plus characteristics.
export function parsePasswordResponse(json) {
  const d = json?.SearchPassAnon;
  const count = d ? toNumber(d.count) : 0;
  return {
    found: count > 0,
    count,
    characteristics: d?.char ? parseCharacteristics(d.char) : null,
  };
}

// A rough local estimate. It only looks at length and character classes, so common words still look
// stronger than they are. The breach lookup is the better signal. Nothing is sent anywhere to compute it.
export function estimatePasswordStrength(password) {
  if (!password) return { score: 0, label: '', bits: 0 };
  let pool = 0;
  if (/[a-z]/.test(password)) pool += 26;
  if (/[A-Z]/.test(password)) pool += 26;
  if (/\d/.test(password)) pool += 10;
  if (/[^A-Za-z0-9]/.test(password)) pool += 33;
  const bits = password.length * Math.log2(Math.max(pool, 1));
  let score = bits < 30 ? 0 : bits < 40 ? 1 : bits < 60 ? 2 : bits < 80 ? 3 : 4;
  // "aaaaaaaaaaaa" has many characters but almost no entropy.
  if (password.length >= 8 && new Set(password).size < 4) score = Math.min(score, 1);
  return { score, label: ['Very weak', 'Weak', 'Fair', 'Good', 'Strong'][score], bits: Math.round(bits) };
}

// The headline for an email result: a tone (ok, warn, danger), a title and a sentence.
export function verdictFor(result) {
  if (!result.found) {
    return {
      tone: 'ok',
      title: 'No breaches found',
      text: `${result.email} is not in XposedOrNot's breach data. Keep using unique passwords and two-factor authentication.`,
    };
  }
  const count = result.breaches.length;
  const severe = /critical|high/i.test(result.risk.label) || result.passwords.plainText > 0;
  const title = count
    ? `Found in ${formatCount(count)} breach${count === 1 ? '' : 'es'}`
    : `Found in ${formatCount(result.pasteCount)} paste${result.pasteCount === 1 ? '' : 's'}`;
  return {
    tone: severe ? 'danger' : 'warn',
    title,
    text: `Risk level: ${result.risk.label}. Your email appeared in data leaks. Work through the steps below.`,
  };
}

// Colour family for a risk label from XposedOrNot.
export function riskTone(label) {
  if (/critical|high/i.test(label)) return 'danger';
  if (/medium/i.test(label)) return 'warn';
  if (/low|none/i.test(label)) return 'ok';
  return 'warn';
}

// Advice is tailored to what was actually found.
export function adviceFor(result) {
  const items = [];
  if (!result.found) {
    items.push({ tone: 'ok', title: 'Keep unique passwords', text: 'Use a different password for every account. A password manager makes that easy.' });
    items.push({ tone: 'ok', title: 'Turn on two-factor authentication', text: 'Start with your email, bank and social accounts.' });
    return items;
  }
  if (result.passwords.plainText > 0) {
    items.push({ tone: 'danger', title: 'Change passwords stored in plain text', text: `${result.passwords.plainText} breach(es) stored passwords without protection. Change any password you used on those services.` });
  }
  items.push({ tone: 'danger', title: 'Change the password on every listed service', text: 'Do it from the service itself, not from a link in an email.' });
  const types = new Set(result.dataTypes.map((t) => t.toLowerCase()));
  if (types.has('auth tokens') || types.has('passwords')) {
    items.push({ tone: 'warn', title: 'Sign out other sessions', text: 'Leaked tokens can keep a session open after a password change.' });
  }
  if ([...types].some((t) => t.includes('phone'))) {
    items.push({ tone: 'warn', title: 'Be careful with calls and texts', text: 'Scammers use leaked phone numbers. Never share a verification code with anyone.' });
  }
  if ([...types].some((t) => t.includes('address') || t.includes('birth') || t.includes('social security') || t.includes('government'))) {
    items.push({ tone: 'warn', title: 'Watch for identity misuse', text: 'Review your bank and credit statements, and consider a fraud alert or credit freeze where it is available.' });
  }
  items.push({ tone: 'ok', title: 'Turn on two-factor authentication', text: 'Protect your email first, because it can reset almost every other account.' });
  items.push({ tone: 'ok', title: 'Stop reusing passwords', text: 'A leak on one site should never unlock another.' });
  return items;
}

// One shared model for the Markdown and PDF reports, so both always say the same thing.
export function reportModel(result, { email = result.email, checkedAt, generatedAt = new Date() } = {}) {
  const breaches = result.breaches;
  return {
    email,
    checkedAt: formatDateTime(checkedAt ?? generatedAt),
    generatedAt: formatDay(generatedAt),
    risk: result.risk.label,
    riskTone: riskTone(result.risk.label),
    verdict: verdictFor({ ...result, email }),
    found: result.found,
    stats: [
      { label: 'Breaches', value: formatCount(breaches.length) },
      { label: 'Pastes', value: formatCount(result.pasteCount) },
      { label: 'Plain-text leaks', value: formatCount(result.passwords.plainText) },
      { label: 'Latest leak', value: result.latestAdded ? formatDay(result.latestAdded) : '—' },
    ],
    rows: breaches.map((b) => ({
      name: b.name,
      domain: b.domain || '—',
      year: b.date || '—',
      records: b.records ? formatCompact(b.records) : '—',
      data: b.dataTypes.join(', ') || '—',
      passwords: (PASSWORD_RISK[b.passwordRisk] ?? PASSWORD_RISK.unknown).label,
      verified: b.verified ? 'Yes' : 'No',
    })),
    details: breaches.slice(0, DETAIL_LIMIT).map((b) => ({
      name: b.name,
      meta: [b.domain, b.industry, b.date].filter(Boolean).join(' · '),
      text: b.description || 'No description was published for this breach.',
    })),
    detailLimit: DETAIL_LIMIT,
    advice: adviceFor({ ...result, email }),
  };
}

const escapeCell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

// Markdown report that the user can download, save or share.
export function reportMarkdown({ email, result, date }) {
  const m = reportModel(result, { email, checkedAt: result.checkedAt, generatedAt: date ? new Date(`${date}T00:00:00Z`) : new Date() });
  const lines = [];
  lines.push('# Josked breach report', '');
  lines.push(`- **Email:** ${email}`);
  lines.push(`- **Checked:** ${m.checkedAt}`);
  lines.push(`- **Report date:** ${m.generatedAt}`);
  lines.push('- **Source:** XposedOrNot (https://xposedornot.com)', '');
  lines.push(`## ${m.verdict.title}`, '');
  lines.push(m.verdict.text, '');
  if (m.found) {
    lines.push('| Metric | Value |', '| --- | --- |');
    for (const s of m.stats) lines.push(`| ${escapeCell(s.label)} | ${escapeCell(s.value)} |`);
    lines.push('');
  }
  if (m.rows.length) {
    lines.push('## Where it leaked', '');
    lines.push('| Service | Domain | Year | Records | Exposed data | Passwords | Verified |', '| --- | --- | --- | --- | --- | --- | --- |');
    for (const r of m.rows) {
      lines.push(`| ${[r.name, r.domain, r.year, r.records, r.data, r.passwords, r.verified].map(escapeCell).join(' | ')} |`);
    }
    lines.push('');
  }
  if (m.details.length) {
    lines.push(`## Details for the ${m.details.length} most recent breaches`, '');
    for (const d of m.details) {
      lines.push(`### ${d.name}`, '');
      if (d.meta) lines.push(`*${d.meta}*`, '');
      lines.push(d.text, '');
    }
  }
  lines.push('## What to do now', '');
  for (const item of m.advice) lines.push(`- [ ] **${item.title}.** ${item.text}`);
  lines.push('', '---', '', 'Generated by Josked. Only check addresses you own or are allowed to check.', '');
  return lines.join('\n');
}

// Runs tasks one at a time, starting each one at least gapMs after the previous start.
export function createSpacedQueue(gapMs, { now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  let tail = Promise.resolve();
  let last = -Infinity;
  return function enqueue(task) {
    const run = async () => {
      const wait = last + gapMs - now();
      if (wait > 0) await sleep(wait);
      last = now();
      return task();
    };
    const result = tail.then(run);
    tail = result.catch(() => {});
    return result;
  };
}
