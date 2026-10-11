import { $, esc, fmtCompact, fmtDate, fmtInt, icon, initChrome, statusNote } from './common.js';
import { fetchBreachCatalogue, LookupError } from './api.js';
import { PASSWORD_RISK, formatDateTime } from './core.js';

initChrome();

const PAGE = 48;
const grid = $('#grid');
const statsBox = $('#stats');
const search = $('#search');
const sort = $('#sort');
const filters = [...document.querySelectorAll('[data-filter]')];
const more = $('#more');
const countLabel = $('#count');
const asOf = $('#asof');
const refreshButton = $('#refresh');
const dialog = $('#detail');
const dialogBody = $('#detail-body');

let all = [];
let items = [];
let filter = 'all';
let shown = PAGE;

const SORTS = {
  newest: (a, b) => b.added.localeCompare(a.added),
  largest: (a, b) => b.records - a.records,
  oldest: (a, b) => a.breachedDate.localeCompare(b.breachedDate),
  name: (a, b) => a.name.localeCompare(b.name),
};

const toneClass = (tone) => ({ danger: 'red', warn: 'amber', ok: 'green' }[tone] || '');

function matchesFilter(b) {
  if (filter === 'verified') return b.verified;
  if (filter === 'sensitive') return b.sensitive;
  if (filter === 'plaintext') return b.passwordRisk === 'plaintext';
  return true;
}

function matchesSearch(b, q) {
  if (!q) return true;
  const hay = [b.name, b.domain, b.industry, b.type, ...b.dataTypes].join(' ').toLowerCase();
  return hay.includes(q);
}

function visible() {
  const q = search.value.trim().toLowerCase();
  return all.filter((b) => matchesFilter(b) && matchesSearch(b, q)).sort(SORTS[sort.value] || SORTS.newest);
}

function riskTag(b) {
  const risk = PASSWORD_RISK[b.passwordRisk] ?? PASSWORD_RISK.unknown;
  return `<span class="tag ${toneClass(risk.tone)}">${esc(risk.tag)}</span>`;
}

function logo(b, size = '') {
  const initial = (b.name[0] || '?').toUpperCase();
  return b.logo
    ? `<span class="j-logo ${size}" data-initial="${esc(initial)}"><img src="${esc(b.logo)}" alt="" loading="lazy" referrerpolicy="no-referrer"></span>`
    : `<span class="j-logo ${size}" aria-hidden="true">${esc(initial)}</span>`;
}

function card(b, index) {
  const types = b.dataTypes.slice(0, 4).map((t) => `<span class="tag">${esc(t)}</span>`).join('');
  const extra = b.dataTypes.length > 4 ? `<span class="tag">+${b.dataTypes.length - 4}</span>` : '';
  return `
    <button class="j-gal-card" type="button" data-index="${index}" aria-label="Open details for ${esc(b.name)}">
      <span class="j-breach-head">${logo(b)}
        <span class="grow j-name"><b>${esc(b.name)}</b><small class="muted">${esc(b.domain || b.industry || '')}</small></span>
      </span>
      <span class="j-tags">
        ${b.verified ? '<span class="tag blue">Verified</span>' : ''}
        ${b.sensitive ? '<span class="tag red">Sensitive</span>' : ''}
      </span>
      <span class="j-tags">${types}${extra}</span>
      <span class="j-gal-foot muted">
        <span>${esc(fmtDate(b.breachedDate))}</span>
        <span>${b.records ? `${esc(fmtCompact(b.records))} records` : ''}</span>
      </span>
    </button>`;
}

function renderStats() {
  const total = all.length;
  const records = all.reduce((sum, b) => sum + b.records, 0);
  const verified = all.filter((b) => b.verified).length;
  const plain = all.filter((b) => b.passwordRisk === 'plaintext').length;
  const cells = [[fmtInt(total), 'Breaches'], [fmtCompact(records), 'Records exposed'], [fmtInt(verified), 'Verified'], [fmtInt(plain), 'Plain-text passwords']];
  statsBox.innerHTML = cells.map(([n, l]) => `<div class="j-stat"><b>${esc(n)}</b><span>${esc(l)}</span></div>`).join('');
}

function render() {
  items = visible();
  const slice = items.slice(0, shown);
  countLabel.textContent = `${fmtInt(items.length)} of ${fmtInt(all.length)} breaches`;
  grid.innerHTML = slice.length
    ? slice.map((b, i) => card(b, i)).join('')
    : `<div class="j-empty">${icon('search')}<p>No breaches match this search.</p></div>`;
  more.hidden = items.length <= shown;
  more.textContent = `Show ${fmtInt(Math.min(PAGE, items.length - shown))} more`;
}

// The full write-up for one breach: facts, exposed data, the story and what to do about it.
function detailHtml(b) {
  const risk = PASSWORD_RISK[b.passwordRisk] ?? PASSWORD_RISK.unknown;
  const severe = b.passwordRisk === 'plaintext' || b.passwordRisk === 'easytocrack';
  const facts = [
    ['Breached', fmtDate(b.breachedDate)],
    ['Added to database', fmtDate(b.added)],
    ['Records exposed', b.records ? fmtInt(b.records) : 'Not listed'],
    ['Breach type', b.type || 'Not listed'],
    ['Searchable', b.searchable ? 'Yes' : 'No'],
    ['Verified', b.verified ? 'Yes' : 'No'],
  ];
  const data = b.dataTypes.length
    ? b.dataTypes.map((t) => `<li>${esc(t)}</li>`).join('')
    : '<li class="muted">Not listed</li>';
  const story = b.description
    ? `<p class="j-story">${esc(b.description)}</p>`
    : '<p class="muted">No description was published for this breach.</p>';
  const steps = [
    severe ? `Change the password on ${esc(b.name)} and on any other site where you used it.` : `If you had an account on ${esc(b.name)}, change its password.`,
    'Turn on two-factor authentication for that account.',
    `Be careful with messages that mention ${esc(b.name)}. Phishing often follows a leak.`,
  ];

  return `
    <header class="j-detail-hero">
      ${logo(b, 'lg')}
      <div class="grow">
        <p class="j-kicker">${esc([b.domain, b.industry].filter(Boolean).join(' · ') || 'Data breach')}</p>
        <h2 id="detail-title">${esc(b.name)}</h2>
        <div class="j-tags">
          ${b.verified ? '<span class="tag blue">Verified</span>' : ''}
          ${b.sensitive ? '<span class="tag red">Sensitive</span>' : ''}
          <span class="tag ${toneClass(risk.tone)}">${esc(risk.tag)}</span>
        </div>
      </div>
    </header>

    <dl class="j-facts">
      ${facts.map(([k, v]) => `<div class="j-fact"><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}
    </dl>

    <section class="j-detail-sec" aria-labelledby="exposed-h">
      <h3 id="exposed-h">Exposed data</h3>
      <ul class="j-chips">${data}</ul>
    </section>

    <section class="j-detail-sec" aria-labelledby="story-h">
      <h3 id="story-h">What happened</h3>
      ${story}
    </section>

    <section class="j-detail-sec" aria-labelledby="steps-h">
      <h3 id="steps-h">What you should do</h3>
      <ol class="j-steps">${steps.map((s) => `<li>${s}</li>`).join('')}</ol>
    </section>

    <footer class="j-detail-foot">
      <p class="j-fine muted">Breach details come from XposedOrNot. Use the check page to see whether your own email is affected.</p>
      <a class="btn primary" href="index.html#email">${icon('mail', 'sm')}Check my email</a>
    </footer>`;
}

function openDetail(b) {
  dialogBody.innerHTML = detailHtml(b);
  dialog.showModal();
  dialogBody.scrollTop = 0;
  dialog.querySelector('#detail-close')?.focus();
}

grid.addEventListener('click', (e) => {
  const card = e.target.closest('[data-index]');
  if (!card) return;
  openDetail(items[Number(card.dataset.index)]);
});

// A logo that fails to load is swapped for its initial.
const onLogoError = (e) => {
  if (e.target.tagName !== 'IMG') return;
  const wrap = e.target.parentElement;
  e.target.remove();
  wrap.textContent = wrap.dataset.initial || '?';
};
grid.addEventListener('error', onLogoError, true);
dialog.addEventListener('error', onLogoError, true);

dialog.addEventListener('click', (e) => {
  if (e.target === dialog || e.target.closest('#detail-close')) dialog.close();
});

search.addEventListener('input', () => { shown = PAGE; render(); });
sort.addEventListener('change', () => { shown = PAGE; render(); });
more.addEventListener('click', () => { shown += PAGE; render(); });

for (const chip of filters) {
  chip.addEventListener('click', () => {
    filter = chip.dataset.filter;
    for (const c of filters) c.setAttribute('aria-pressed', String(c === chip));
    shown = PAGE;
    render();
  });
}

async function load({ fresh = false } = {}) {
  if (!all.length) grid.innerHTML = `<div class="j-loading" role="status"><span class="spinner sm"></span> Loading the breach list…</div>`;
  refreshButton.disabled = true;
  try {
    const { data, at } = await fetchBreachCatalogue({ fresh });
    all = data;
    asOf.textContent = `Updated ${formatDateTime(at)}`;
    renderStats();
    render();
  } catch (err) {
    grid.innerHTML = statusNote(err instanceof LookupError ? err.message : 'Something went wrong. Try again.', { warn: true });
    statsBox.innerHTML = '';
    more.hidden = true;
    countLabel.textContent = '';
  } finally {
    refreshButton.disabled = false;
  }
}

refreshButton.addEventListener('click', () => load({ fresh: true }));
load();
