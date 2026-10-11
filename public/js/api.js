// Browser side of the XposedOrNot calls. The API allows cross-origin requests, so no backend is needed.
import {
  EMAIL_API,
  PASSWORD_API,
  RATE_GAP_MS,
  createSpacedQueue,
  isValidEmail,
  isValidPrefix,
  normalizeEmail,
  parseBreachCatalogue,
  parseEmailAnalytics,
  parsePasswordResponse,
  passwordPrefix,
} from './core.js';

export class LookupError extends Error {
  constructor(message, { status = 0, input = false } = {}) {
    super(message);
    this.name = 'LookupError';
    this.status = status;
    this.input = input;
  }
}

// Results are reused for 10 minutes. Pass fresh: true to ask XposedOrNot again.
const TTL_MS = 10 * 60 * 1000;
const CATALOGUE_KEY = 'josked:catalogue';
const CATALOGUE_TTL_MS = 15 * 60 * 1000;

const enqueue = createSpacedQueue(RATE_GAP_MS);
const memo = new Map();

// Returns null for a 404 when allowNotFound is set. Every other failure throws a LookupError.
async function getJson(url, { allowNotFound = false } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  let res;
  try {
    res = await fetch(url, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      signal: controller.signal,
    });
  } catch {
    throw new LookupError('Could not reach XposedOrNot. Check your connection and try again.');
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 429) {
    throw new LookupError('XposedOrNot is limiting requests right now. Wait a minute and try again.', { status: 429 });
  }
  if (res.status === 404 && allowNotFound) return null;
  if (!res.ok) {
    throw new LookupError(`XposedOrNot answered with HTTP ${res.status}. Try again later.`, { status: res.status });
  }
  try {
    return await res.json();
  } catch {
    throw new LookupError('XposedOrNot sent an answer Josked could not read.', { status: res.status });
  }
}

function fromMemo(key) {
  const hit = memo.get(key);
  return hit && Date.now() - hit.at < TTL_MS ? hit.value : null;
}

export async function checkEmail(raw, { fresh = false } = {}) {
  const email = normalizeEmail(raw);
  if (!isValidEmail(email)) {
    throw new LookupError('Enter a valid email address, for example name@example.com.', { input: true });
  }
  const key = `email:${email}`;
  const cached = fresh ? null : fromMemo(key);
  if (cached) return { ...cached, cached: true };

  const json = await enqueue(() => getJson(`${EMAIL_API}/breach-analytics?email=${encodeURIComponent(email)}`));
  const value = { email, checkedAt: new Date().toISOString(), cached: false, ...parseEmailAnalytics(json) };
  memo.set(key, { at: Date.now(), value });
  return value;
}

// Only the 10-character prefix leaves the browser. The full hash and the password stay local.
export async function checkPassword(password, keccak512) {
  if (!password) throw new LookupError('Type a password to check.', { input: true });
  const prefix = passwordPrefix(password, keccak512);
  if (!isValidPrefix(prefix)) throw new LookupError('Could not prepare the password for checking.');

  const key = `pass:${prefix}`;
  const cached = fromMemo(key);
  if (cached) return { ...cached, cached: true };

  const json = await enqueue(() => getJson(`${PASSWORD_API}/pass/anon/${prefix}`, { allowNotFound: true }));
  const value = { prefix, checkedAt: new Date().toISOString(), cached: false, ...parsePasswordResponse(json) };
  memo.set(key, { at: Date.now(), value });
  return value;
}

export async function fetchBreachCatalogue({ fresh = false } = {}) {
  if (!fresh) {
    try {
      const raw = sessionStorage.getItem(CATALOGUE_KEY);
      if (raw) {
        const { at, data } = JSON.parse(raw);
        if (Date.now() - at < CATALOGUE_TTL_MS) return { data, at };
      }
    } catch {
      // Storage can be blocked (private windows, strict settings). The page still works without it.
    }
  }
  const json = await enqueue(() => getJson(`${EMAIL_API}/breaches`));
  const data = parseBreachCatalogue(json);
  const at = Date.now();
  try {
    sessionStorage.setItem(CATALOGUE_KEY, JSON.stringify({ at, data }));
  } catch {
    // Ignored on purpose: caching is a convenience.
  }
  return { data, at };
}
