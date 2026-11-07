/**
 * Shared helpers: URL handling, formatting, cooldown bookkeeping.
 */

export function isHttpUrl(value) {
  try {
    const u = new URL(String(value));
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

/** Pull every http(s) URL out of a message, trimmed of trailing punctuation, deduped. */
export function extractUrls(text) {
  const matches = String(text ?? '').match(/https?:\/\/[^\s<>"'`)\]}]+/gi) ?? [];
  return [...new Set(matches.map((m) => m.replace(/[.,;:!?!'"”’)\]}>]+$/, '')))];
}

export function truncate(value, max) {
  const s = String(value ?? '');
  return s.length > max ? `${s.slice(0, Math.max(0, max - 1))}…` : s;
}

/** successRate comes as a 0–100 number from the API; tolerate 0–1 fractions too. */
export function formatRate(rate) {
  const v = Number(rate);
  if (rate == null || Number.isNaN(v)) return '—';
  return `${Math.round(v > 0 && v <= 1 ? v * 100 : v)}%`;
}

export function formatUptime(seconds) {
  let s = Math.floor(seconds);
  const d = Math.floor(s / 86400);
  s %= 86400;
  const h = Math.floor(s / 3600);
  s %= 3600;
  const m = Math.floor(s / 60);
  s %= 60;
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(' ');
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Simple per-key cooldown: `hit` arms the key and reports remaining seconds. */
export class Cooldowns {
  #map = new Map();

  hit(key, ms) {
    const now = Date.now();
    const until = this.#map.get(key) ?? 0;
    if (now < until) return Math.ceil((until - now) / 1000);
    this.#map.set(key, now + ms);
    return 0;
  }

  clear() {
    this.#map.clear();
  }
}

export const cooldowns = new Cooldowns();
