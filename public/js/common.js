import { SPRITE } from './icons.js';
import { formatCompact, formatCount, formatDay } from './core.js';

const THEME_KEY = 'josked-theme';

export const $ = (selector, root = document) => root.querySelector(selector);

// Escapes anything that came from a user or from a third-party API before it goes into HTML.
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export function icon(name, size = '') {
  return `<svg class="i ${size}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
}

export const fmtInt = formatCount;
export const fmtCompact = formatCompact;
// Breach dates are calendar days. Years stay as they are, other dates read like "Oct 2, 2026".
export const fmtDate = formatDay;

export function statusNote(message, { warn = false } = {}) {
  return `<div class="site-note ${warn ? 'warn' : ''}">${icon(warn ? 'warning' : 'info')}<div><p>${esc(message)}</p></div></div>`;
}

// Sets the theme and the toggle button's label. The toggle is optional on a page.
export function initChrome() {
  document.body.insertAdjacentHTML('afterbegin', SPRITE);

  let saved = null;
  try {
    saved = localStorage.getItem(THEME_KEY);
  } catch {
    // Storage can be blocked. The system theme is used then.
  }
  const systemDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = saved || (systemDark ? 'dark' : 'light');

  const button = $('[data-theme-toggle]');
  if (!button) return;
  const paint = () => {
    const dark = document.documentElement.dataset.theme === 'dark';
    button.innerHTML = icon(dark ? 'sun' : 'moon');
    button.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
  };
  button.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // Ignored: the choice then lasts only for this page view.
    }
    paint();
  });
  paint();
}
