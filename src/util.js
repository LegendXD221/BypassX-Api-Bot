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

/**
 * Hosts the bot must never submit to the API — loopback, private ranges,
 * link-local (cloud metadata) and lookalike internal suffixes.
 */
export function isBlockedHost(hostname) {
  let host = String(hostname ?? '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return true;
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.localdomain') || host.endsWith('.lan') || host.endsWith('.home')) return true;
  if (!host.includes('.')) return true; // bare hostnames — nothing public lives there

  // IPv4-mapped or plain IPv4 literals
  let v4 = host;
  const mapped = /^::ffff:(.+)$/i.exec(host);
  if (mapped) v4 = mapped[1];
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(v4)) {
    const [a, b] = v4.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true; // link-local incl. cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
    if (a >= 224) return true; // multicast + reserved
    return false;
  }

  // IPv6 literals: loopback, unspecified, unique-local (fc00::/7), link-local (fe80::/10)
  if (host.includes(':')) {
    const bare = host.toLowerCase();
    if (bare === '::1' || bare === '::') return true;
    if (/^f[cd][0-9a-f]{2}:/.test(bare)) return true;
    if (/^fe[89ab][0-9a-f]:/.test(bare)) return true;
    return false;
  }
  return false;
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

/** Human "time ago" from a Date, ISO string or epoch ms — for history lists. */
export function ago(input) {
  const t = input instanceof Date ? input.getTime() : Date.parse(input);
  if (!Number.isFinite(t)) return 'unknown';
  const s = Math.max(1, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

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
