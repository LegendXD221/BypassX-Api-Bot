import { config } from './config.js';
import { log } from './logger.js';
import { sleep } from './util.js';

/**
 * BypassX API client.
 *
 *   POST /api/owner      { url }          (x-api-key header)
 *   GET  /api/owner      ?url=&oauth=&ref= (OAuth resume, x-api-key header)
 *   GET  /api/supported                   (public service registry)
 *
 * Response shapes (owner API):
 *   ok  → { ok:true, site:{id,name}, destination, note, elapsedMs }
 *   oauth handoff (ok:true, destination:null)
 *       → { ok:true, site, note, action:{ kind:"oauth", provider,
 *             authorizeUrl, ref, expiresInMs }, elapsedMs }
 *   err → { ok:false, error } (400/401/422/429/501/503)
 */
export class ApiError extends Error {
  constructor(message, { status = null, code = 'API_ERROR' } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export const metrics = { apiCalls: 0, apiFailures: 0, cacheHits: 0, lastLatencyMs: null };

const BYPASS_TIMEOUT_MS = 180_000; // paced key chains are slow — Discord defers give us 15 min
const SUPPORTED_TIMEOUT_MS = 10_000;

/* ------------------------------------------------------------------ */
/* Transient-failure retry                                             */
/*                                                                     */
/* Transport resets and 429/5xx answers are retried with a short       */
/* exponential backoff (honoring Retry-After when sane). A pure        */
/* timeout gets exactly one retry — key chains are paced server-side   */
/* and remember their progress, so a rerun waits out the remainder     */
/* proactively instead of failing forever. 4xx client errors never     */
/* retry.                                                              */
/* ------------------------------------------------------------------ */

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const RETRY_DELAYS_MS = [800, 2_200];

async function fetchWithRetry(url, options, { timeoutMs, retries = 2 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      const delay = RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)];
      await sleep(delay);
    }
    try {
      const res = await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
      if (RETRYABLE_STATUS.has(res.status) && attempt < retries) {
        const retryAfter = Number(res.headers.get('retry-after'));
        if (Number.isFinite(retryAfter) && retryAfter > 0 && retryAfter <= 10) {
          await sleep(retryAfter * 1000);
        }
        lastError = new ApiError(`HTTP ${res.status}`, { status: res.status });
        continue;
      }
      return res;
    } catch (e) {
      lastError = e;
      const isTimeout = e?.name === 'TimeoutError' || e?.name === 'AbortError';
      if (attempt >= retries) throw e;
      // Timeouts: at most one retry (attempt 0) — a second 3-minute wait is
      // worse than returning the honest timeout error to the user.
      if (isTimeout && attempt >= 1) throw e;
    }
  }
  throw lastError;
}

/* ------------------------------------------------------------------ */
/* Response handling                                                   */
/* ------------------------------------------------------------------ */

async function parseJson(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function failFromStatus(res, data) {
  const message =
    data?.error ?? data?.message ?? `The BypassX API responded with HTTP ${res.status}.`;
  const code =
    res.status === 401
      ? 'UNAUTHORIZED'
      : res.status === 429
        ? 'RATE_LIMITED'
        : res.status === 503
          ? 'NOT_CONFIGURED'
          : 'API_ERROR';
  throw new ApiError(String(message), { status: res.status, code });
}

function normalize(data) {
  const siteName = data?.site?.name ?? null;

  // Interactive continuation demand (Delta OAuth) — not a failure.
  if (data?.action?.kind === 'oauth') {
    return {
      kind: 'oauth',
      serviceName: siteName,
      note: data.note ?? '',
      action: data.action,
      elapsedMs: data.elapsedMs ?? null,
    };
  }

  const destination = data?.destination ?? null;
  if (!destination) {
    throw new ApiError(data?.error ?? 'The API did not return a destination link.', {
      code: 'BAD_RESPONSE',
    });
  }

  return {
    kind: 'destination',
    url: destination,
    serviceName: siteName,
    note: data?.note ?? null,
    elapsedMs: typeof data?.elapsedMs === 'number' ? data.elapsedMs : null,
    cached: /served from cache|\(cached\)/i.test(String(data?.note ?? '')),
  };
}

/* ------------------------------------------------------------------ */
/* Endpoints                                                           */
/* ------------------------------------------------------------------ */

export async function bypassUrl(url) {
  if (!config.apiKey) {
    throw new ApiError('The bot owner has not configured a BypassX API key yet.', {
      code: 'NO_KEY',
    });
  }
  metrics.apiCalls += 1;

  let res;
  try {
    res = await fetchWithRetry(
      `${config.apiUrl}/api/owner`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': config.apiKey },
        body: JSON.stringify({ url }),
      },
      { timeoutMs: BYPASS_TIMEOUT_MS }
    );
  } catch (e) {
    metrics.apiFailures += 1;
    if (e?.name === 'TimeoutError' || e?.name === 'AbortError') {
      throw new ApiError(
        'The bypass took too long and timed out. Paced key systems can be slow — hit **Try Again** in a minute; a rerun usually picks up where this stopped.',
        { code: 'TIMEOUT' }
      );
    }
    throw new ApiError('Could not reach the BypassX API — it may be down or restarting. Try again shortly.', {
      code: 'NETWORK',
    });
  }

  const data = await parseJson(res);
  if (!res.ok || data?.ok !== true) {
    metrics.apiFailures += 1;
    failFromStatus(res, data);
  }
  return normalize(data);
}

/** Resume a Delta OAuth handoff: `&oauth=<final url>&ref=<ref>`. */
export async function resumeOauth({ url, oauthUrl, ref }) {
  if (!config.apiKey) {
    throw new ApiError('The bot owner has not configured a BypassX API key yet.', {
      code: 'NO_KEY',
    });
  }
  metrics.apiCalls += 1;

  const qs = new URLSearchParams({ url, oauth: oauthUrl, ref });
  let res;
  try {
    res = await fetchWithRetry(
      `${config.apiUrl}/api/owner?${qs.toString()}`,
      { headers: { 'x-api-key': config.apiKey } },
      { timeoutMs: BYPASS_TIMEOUT_MS }
    );
  } catch (e) {
    metrics.apiFailures += 1;
    if (e?.name === 'TimeoutError' || e?.name === 'AbortError') {
      throw new ApiError('Resuming the key chain timed out — try submitting the URL once more.', {
        code: 'TIMEOUT',
      });
    }
    throw new ApiError('Could not reach the BypassX API. Try again shortly.', { code: 'NETWORK' });
  }

  const data = await parseJson(res);
  if (!res.ok || data?.ok !== true) {
    metrics.apiFailures += 1;
    failFromStatus(res, data);
  }
  return normalize(data);
}

/* ------------------------------------------------------------------ */
/* Local result cache (repeat bypasses answer instantly)               */
/* ------------------------------------------------------------------ */

const CACHE_TTL_MS = 10 * 60_000;
const CACHE_MAX = 250;
const cache = new Map();

export function cacheGet(url) {
  const hit = cache.get(url);
  if (!hit) return null;
  if (Date.now() > hit.expires) {
    cache.delete(url);
    return null;
  }
  metrics.cacheHits += 1;
  return hit.result;
}

export function cacheSet(url, result) {
  if (cache.size >= CACHE_MAX) {
    cache.delete(cache.keys().next().value);
  }
  cache.set(url, { result, expires: Date.now() + CACHE_TTL_MS });
}

export function cacheClear() {
  const n = cache.size;
  cache.clear();
  return n;
}

export function cacheStats() {
  return { size: cache.size };
}

/* ------------------------------------------------------------------ */
/* Supported services registry (public, no auth)                       */
/* ------------------------------------------------------------------ */

export const supported = {
  services: [],
  byDomain: new Map(),
  count: 0,
  domainCount: 0,
  fetchedAt: 0,
};

const SUPPORTED_TTL_MS = 6 * 3600_000;

export async function refreshSupported(force = false) {
  if (!force && supported.services.length && Date.now() - supported.fetchedAt < SUPPORTED_TTL_MS) {
    return supported;
  }
  try {
    const res = await fetch(`${config.apiUrl}/api/supported`, {
      signal: AbortSignal.timeout(SUPPORTED_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data?.ok && Array.isArray(data.services)) {
      supported.services = data.services;
      supported.byDomain = new Map();
      for (const svc of data.services) {
        for (const d of svc.domains ?? []) {
          supported.byDomain.set(String(d).toLowerCase(), svc);
        }
      }
      supported.count = data.count ?? data.services.length;
      supported.domainCount = data.domainCount ?? supported.byDomain.size;
      supported.fetchedAt = Date.now();
      log.ok(`Loaded ${supported.count} supported services / ${supported.domainCount} domains.`);
    }
  } catch (e) {
    log.warn(`Could not refresh supported services: ${e.message}`);
  }
  return supported;
}

/** Match a URL against the registry (exact host or subdomain of a known domain). */
export function matchService(url) {
  let host;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  const exact = supported.byDomain.get(host);
  if (exact) return exact;
  for (const [domain, svc] of supported.byDomain) {
    if (host.endsWith(`.${domain}`)) return svc;
  }
  return null;
}

/** Quick reachability + latency probe used by /ping and /owner api. */
export async function measureApi() {
  const started = Date.now();
  try {
    const res = await fetch(`${config.apiUrl}/api/supported`, {
      signal: AbortSignal.timeout(2_500),
    });
    metrics.lastLatencyMs = Date.now() - started;
    return { ok: res.ok, status: res.status, ms: metrics.lastLatencyMs };
  } catch {
    metrics.lastLatencyMs = null;
    return { ok: false, status: 0, ms: Date.now() - started };
  }
}
