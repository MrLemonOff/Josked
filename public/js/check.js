import { $, esc, fmtCompact, fmtDate, fmtInt, icon, initChrome, statusNote } from './common.js';
import { checkEmail, checkPassword, LookupError } from './api.js';
import {
  PASSWORD_RISK,
  adviceFor,
  estimatePasswordStrength,
  formatDateTime,
  reportMarkdown,
  reportModel,
  verdictFor,
} from './core.js';
import { buildReportPdf } from './report-pdf.js';

initChrome();

const results = $('#results');
const tabs = [...document.querySelectorAll('[data-tab]')];
const panels = [...document.querySelectorAll('[data-panel]')];
const emailForm = $('#email-form');
const emailInput = $('#email');
const passForm = $('#pass-form');
const passInput = $('#password');
const meter = $('#meter');
const meterLabel = $('#meter-label');
const eyeButton = $('#eye');

let lastEmailResult = null;
let showAllBreaches = false;

const VERDICT_ICON = { ok: 'check', warn: 'warning', danger: 'alert' };
const LOADING = `<div class="j-loading" role="status"><span class="spinner sm"></span> Checking XposedOrNot…</div>`;

// Tabs

function selectTab(name) {
  for (const tab of tabs) {
    const on = tab.dataset.tab === name;
    tab.setAttribute('aria-selected', String(on));
    tab.tabIndex = on ? 0 : -1;
  }
  for (const panel of panels) panel.hidden = panel.dataset.panel !== name;
  results.innerHTML = '';
  history.replaceState(null, '', name === 'password' ? '#password' : '#email');
}

tabs.forEach((tab) => tab.addEventListener('click', () => selectTab(tab.dataset.tab)));
const tabFromHash = () => (location.hash === '#password' ? 'password' : 'email');
selectTab(tabFromHash());
window.addEventListener('hashchange', () => selectTab(tabFromHash()));

// Email

function tagFor(tone) {
  return { danger: 'red', warn: 'amber', ok: 'green' }[tone] || '';
}

function breachCard(b) {
  const risk = PASSWORD_RISK[b.passwordRisk] ?? PASSWORD_RISK.unknown;
  const initial = (b.name[0] || '?').toUpperCase();
  const logo = b.logo
    ? `<span class="j-logo" data-initial="${esc(initial)}"><img src="${esc(b.logo)}" alt="" loading="lazy" referrerpolicy="no-referrer"></span>`
    : `<span class="j-logo" aria-hidden="true">${esc(initial)}</span>`;
  const types = b.dataTypes.slice(0, 6).map((t) => `<span class="tag">${esc(t)}</span>`).join('');
  return `
    <article class="j-breach">
      <div class="j-breach-head">
        ${logo}
        <div class="grow">
          <b>${esc(b.name)}</b>
          <small class="muted">${esc([b.domain, b.industry, fmtDate(b.date)].filter(Boolean).join(' · '))}</small>
        </div>
      </div>
      <div class="j-tags">
        <span class="tag ${tagFor(risk.tone)}">${esc(risk.tag)}</span>
        ${b.verified ? '<span class="tag blue">Verified</span>' : ''}
        ${b.records ? `<span class="tag">${esc(fmtCompact(b.records))} records</span>` : ''}
        ${types}
      </div>
      ${b.description ? `<details class="j-more"><summary>What happened</summary><p>${esc(b.description)}</p>${b.reference ? `<p><a href="${esc(b.reference)}" rel="noopener noreferrer" target="_blank">Read the source</a></p>` : ''}</details>` : ''}
    </article>`;
}

function renderEmail(r) {
  const v = verdictFor(r);
  const stats = r.found
    ? [
        [fmtInt(r.breaches.length), 'Breaches'],
        [fmtInt(r.pasteCount), 'Pastes'],
        [fmtInt(r.passwords.plainText), 'Plain-text leaks'],
        [r.latestAdded ? fmtDate(r.latestAdded) : '—', 'Latest added'],
      ]
    : [];
  const shown = showAllBreaches ? r.breaches : r.breaches.slice(0, 8);
  const advice = adviceFor(r)
    .map((a) => `<li class="j-advice-item ${a.tone}">${icon(a.tone === 'ok' ? 'check' : a.tone === 'warn' ? 'warning' : 'alert')}<div><b>${esc(a.title)}</b><span>${esc(a.text)}</span></div></li>`)
    .join('');
  const checked = formatDateTime(r.checkedAt);

  results.innerHTML = `
    <div class="j-verdict ${v.tone}" role="status">
      <span class="bubble-ic ${v.tone}">${icon(VERDICT_ICON[v.tone])}</span>
      <div class="grow">
        <h2>${esc(v.title)}</h2>
        <p>${esc(v.text)}</p>
      </div>
    </div>

    <div class="j-asof">
      <span class="muted small">${r.cached ? 'Saved result' : 'Live result'} · checked ${esc(checked)}</span>
      <button class="btn sm" id="recheck">${icon('refresh', 'sm')}Check again</button>
    </div>

    ${stats.length ? `<div class="j-stats">${stats.map(([n, l]) => `<div class="j-stat"><b>${esc(n)}</b><span>${esc(l)}</span></div>`).join('')}</div>` : ''}

    ${r.breaches.length ? `
      <section class="j-block" aria-labelledby="platforms-h">
        <h2 id="platforms-h">${icon('list')}Where it leaked</h2>
        <div class="j-breach-list">${shown.map(breachCard).join('')}</div>
        ${r.breaches.length > 8 ? `<button class="btn sm" id="more-breaches">${showAllBreaches ? 'Show fewer' : `Show all ${fmtInt(r.breaches.length)}`}</button>` : ''}
      </section>` : ''}

    <section class="j-block" aria-labelledby="steps-h">
      <h2 id="steps-h">${icon('shield')}What to do now</h2>
      <ul class="j-advice">${advice}</ul>
    </section>

    <section class="j-report" aria-labelledby="report-h">
      <div>
        <h2 id="report-h">${icon('file-text')}Download this report</h2>
        <p class="muted">Choose Markdown for notes, or PDF for printing and sharing. Both contain the same information.</p>
      </div>
      <div class="j-report-choices">
        <button class="j-choice" type="button" data-report="md">
          <span class="bubble-ic">${icon('code')}</span>
          <span><b>Markdown (.md)</b><small>Plain text with tables. Opens in any editor.</small></span>
        </button>
        <button class="j-choice primary" type="button" data-report="pdf">
          <span class="bubble-ic">${icon('file-text')}</span>
          <span><b>PDF (.pdf)</b><small>A formatted report for printing and sharing.</small></span>
        </button>
      </div>
      <p class="j-fine muted" id="report-status" role="status"></p>
    </section>

    <p class="j-fine muted">Results come from XposedOrNot and can be incomplete. A clean result does not prove an account is safe.</p>`;
}

function renderEmailError(err) {
  results.innerHTML = statusNote(err.message, { warn: true });
}

async function lookupEmail({ fresh = false } = {}) {
  results.innerHTML = LOADING;
  try {
    lastEmailResult = await checkEmail(emailInput.value, { fresh });
    showAllBreaches = false;
    renderEmail(lastEmailResult);
  } catch (err) {
    lastEmailResult = null;
    renderEmailError(err instanceof LookupError ? err : new LookupError('Something went wrong. Try again.'));
  }
}

emailForm.addEventListener('submit', (e) => {
  e.preventDefault();
  lookupEmail();
});

// Report download

const slug = (text) => String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'report';

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function setReportStatus(message, { error = false } = {}) {
  const el = $('#report-status');
  if (!el) return;
  el.textContent = message;
  el.classList.toggle('bad', error);
}

function downloadReport(format) {
  const r = lastEmailResult;
  if (!r) return;
  const now = new Date();
  const stamp = now.toISOString().slice(0, 10);
  const base = `josked-report-${slug(r.email)}-${stamp}`;
  try {
    if (format === 'md') {
      const md = reportMarkdown({ email: r.email, result: r, date: stamp });
      saveBlob(new Blob([md], { type: 'text/markdown;charset=utf-8' }), `${base}.md`);
      setReportStatus(`Saved ${base}.md`);
    } else {
      const JsPDF = window.jspdf?.jsPDF;
      if (!JsPDF) throw new Error('The PDF library did not load. Refresh the page and try again.');
      const model = reportModel(r, { email: r.email, checkedAt: r.checkedAt, generatedAt: now });
      buildReportPdf(model, JsPDF).save(`${base}.pdf`);
      setReportStatus(`Saved ${base}.pdf`);
    }
  } catch (err) {
    setReportStatus(`The report could not be created: ${err.message || 'unknown error'}`, { error: true });
  }
}

results.addEventListener('click', (e) => {
  if (e.target.closest('#more-breaches') && lastEmailResult) {
    showAllBreaches = !showAllBreaches;
    renderEmail(lastEmailResult);
    return;
  }
  if (e.target.closest('#recheck') && lastEmailResult) {
    lookupEmail({ fresh: true });
    return;
  }
  const choice = e.target.closest('[data-report]');
  if (choice) downloadReport(choice.dataset.report);
});

// A logo that fails to load is swapped for its initial.
results.addEventListener('error', (e) => {
  if (e.target.tagName !== 'IMG') return;
  const wrap = e.target.parentElement;
  e.target.remove();
  wrap.textContent = wrap.dataset.initial || '?';
}, true);

// Password

function paintMeter(password) {
  const s = estimatePasswordStrength(password);
  meter.dataset.s = String(s.score);
  meter.firstElementChild.style.width = password ? `${(s.score + 1) * 20}%` : '0%';
  meterLabel.textContent = password ? `${s.label} · about ${s.bits} bits. A rough estimate that ignores common words, computed in your browser.` : '';
}

passInput.addEventListener('input', () => paintMeter(passInput.value));

eyeButton.addEventListener('click', () => {
  const shown = passInput.type === 'text';
  passInput.type = shown ? 'password' : 'text';
  eyeButton.innerHTML = icon(shown ? 'eye' : 'eye-off');
  eyeButton.setAttribute('aria-label', shown ? 'Show password' : 'Hide password');
});

function renderPassword(r) {
  const chars = r.characteristics;
  const verdict = r.found
    ? { tone: 'danger', ic: 'alert', title: `Seen ${fmtInt(r.count)} times in breaches`, text: 'Do not use this password anywhere. If you use it on any account, change it now.' }
    : { tone: 'ok', ic: 'check', title: 'Not found in known breaches', text: 'Good news. It is still wise to use a unique password for each account.' };
  const stats = chars
    ? [[fmtInt(chars.length), 'Length'], [fmtInt(chars.alphabets), 'Letters'], [fmtInt(chars.digits), 'Digits'], [fmtInt(chars.special), 'Symbols']]
    : [];
  results.innerHTML = `
    <div class="j-verdict ${verdict.tone}" role="status">
      <span class="bubble-ic ${verdict.tone}">${icon(verdict.ic)}</span>
      <div class="grow">
        <h2>${esc(verdict.title)}</h2>
        <p>${esc(verdict.text)}</p>
      </div>
    </div>
    ${stats.length ? `<div class="j-stats">${stats.map(([n, l]) => `<div class="j-stat"><b>${esc(n)}</b><span>${esc(l)}</span></div>`).join('')}</div>` : ''}
    <p class="j-fine muted">Your password never left this page. Only the first 10 characters of its Keccak-512 hash were sent: <code>${esc(r.prefix)}</code>.${r.cached ? ' This result came from memory.' : ''}</p>`;
}

passForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  results.innerHTML = LOADING;
  try {
    // keccak512 comes from vendor/sha3.min.js, which the page loads before this module.
    const r = await checkPassword(passInput.value, window.keccak512);
    renderPassword(r);
  } catch (err) {
    results.innerHTML = statusNote(err instanceof LookupError ? err.message : 'Something went wrong. Try again.', { warn: true });
  }
});
