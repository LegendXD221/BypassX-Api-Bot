/**
 * Neon Postgres persistence (free tier friendly) with a transparent
 * memory-only fallback.
 *
 * Design:
 *   - Postgres is the source of truth; hot reads are served from in-memory
 *     caches that are loaded once at boot and updated on every write.
 *   - Every write updates memory synchronously (commands keep a sync API)
 *     and persists to Postgres fire-and-forget with error logging.
 *   - If DATABASE_URL is missing or the database is unreachable (cold start,
 *     network hiccup, sandbox), the bot keeps running in memory-only mode —
 *     nothing crashes, state simply does not survive restarts.
 *   - Connection budget: pool of 4 against the Neon pooler — well inside
 *     free-tier limits.
 *
 * Tables: autobypass_channels · blacklist · counters · bot_config · bypass_logs
 */
import pg from 'pg';
import { Pool as NeonPool } from '@neondatabase/serverless';
import { config } from './config.js';
import { log } from './logger.js';

/* ------------------------------------------------------------------ */
/* Pool & health                                                       */
/* ------------------------------------------------------------------ */

let pool = null;
let driver = 'tcp'; // 'tcp' = node-postgres · 'ws' = Neon serverless over HTTPS/WebSocket
let dbOk = false;
let reconnectTimer = null;

// Real TLS verification for the Postgres link (a MITM used to be able to
// intercept credentials/queries). If a CA chain genuinely fails, the
// symmetric transport switch below falls to Neon's HTTPS driver loudly.
function getPool() {
  if (!pool) {
    if (driver === 'tcp') {
      pool = new pg.Pool({
        connectionString: config.databaseUrl,
        max: 4,
        connectionTimeoutMillis: 5_000,
        idleTimeoutMillis: 30_000,
        ssl: { rejectUnauthorized: true },
        application_name: 'bypassx-api-bot',
      });
    } else {
      // Some hosts/firewalls block raw Postgres TCP (5432). The Neon serverless
      // driver tunnels the same wire protocol over WebSocket/443 — same SQL,
      // same result shapes, no other code changes needed.
      pool = new NeonPool({ connectionString: config.databaseUrl, max: 4 });
    }
    pool.on('error', (e) => log.warn(`db pool error: ${e.message}`));
  }
  return pool;
}

/** Never let a postgres connection string leak through an error message. */
function scrubConn(msg) {
  return String(msg ?? '').replace(/postgres(?:ql)?:\/\/[^\s]+/gi, 'postgres://<redacted>');
}

/** Single-flight transport switch: two concurrent failing q() calls used to
 *  both flip the driver and shutdownDb() each other's fresh pool (churn
 *  exactly during an outage). All callers now await the same switch. */
let switchInFlight = null;
function switchTransport(to, from, reason) {
  if (!switchInFlight) {
    switchInFlight = (async () => {
      driver = to;
      log.warn(`postgres ${from} transport failing (${reason}) — switching to ${to === 'ws' ? 'Neon WebSocket transport (HTTPS/443)' : 'raw TCP transport'}`);
      await shutdownDb();
    })().finally(() => { switchInFlight = null; });
  }
  return switchInFlight;
}

async function q(text, params = []) {
  if (!config.databaseUrl) return null;
  try {
    const res = await getPool().query(text, params);
    dbOk = true;
    return res;
  } catch (e) {
    dbOk = false;
    // Transport-level failure (blocked port, refused, timeout, dead websocket)
    // → switch transports and retry once. Real SQL errors (syntax, constraints
    // — they carry `severity`) never trigger this. The switch is SYMMETRIC:
    // tcp→ws on TCP trouble, and ws→tcp again when the WebSocket path dies
    // (live-verified on Render: the neon WS transport can hard-fail there —
    // "fetch failed" in 1ms — while raw TCP keeps working; a one-way switch
    // wedged the bot memory-only forever).
    const transportLike =
      !e.severity ||
      ['ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'ERR_SOCKET_CONNECTION_TIMEOUT'].includes(e.code) ||
      /timeout|terminated|connect|fetch failed/i.test(String(e.message ?? ''));
    if (transportLike) {
      const other = driver === 'tcp' ? 'ws' : 'tcp';
      const from = driver;
      await switchTransport(other, from, e.code || scrubConn(e.message) || 'unknown');
      try {
        const res = await getPool().query(text, params);
        dbOk = true;
        log.ok(`Database connected over ${other === 'ws' ? 'WebSocket' : 'raw TCP'} transport.`);
        scheduleReconnect();
        return res;
      } catch (e2) {
        // Both transports failed THIS call. Flip back so the next attempt
        // (60s reconnect loop or the next caller) starts from the transport
        // that worked most recently instead of the one that just died.
        await switchTransport(from, other, scrubConn(e2.message));
        log.warn(`db query failed (${other}): ${scrubConn(e2.message)} — continuing memory-only`);
        scheduleReconnect();
        return null;
      }
    }
    // Real SQL error (syntax/constraint) — it carries `severity`; log it.
    // The old condition (`if (dbOk)`) was dead code: dbOk is always false
    // here, so genuine SQL failures vanished silently while memory diverged
    // from disk. Scrub connection strings from the message while at it.
    log.warn(`db query failed: ${scrubConn(e.message)} — continuing memory-only`);
    scheduleReconnect();
    return null;
  }
}

function scheduleReconnect() {
  if (reconnectTimer || !config.databaseUrl) return;
  reconnectTimer = setInterval(async () => {
    const res = await q('SELECT 1');
    if (res) {
      clearInterval(reconnectTimer);
      reconnectTimer = null;
      // Catch up on anything written by other instances while offline.
      await refreshBlacklist();
      await refreshAutobypass();
      await refreshCounters();
    }
  }, 60_000);
  reconnectTimer.unref();
}

export function dbHealthy() {
  return dbOk;
}

/* ------------------------------------------------------------------ */
/* Schema + boot                                                       */
/* ------------------------------------------------------------------ */

const DDL = `
CREATE TABLE IF NOT EXISTS autobypass_channels (
  guild_id   TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  added_by   TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, channel_id)
);
CREATE TABLE IF NOT EXISTS blacklist (
  type       TEXT NOT NULL CHECK (type IN ('user','guild')),
  target_id  TEXT NOT NULL,
  reason     TEXT,
  added_by   TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (type, target_id)
);
CREATE TABLE IF NOT EXISTS counters (
  key   TEXT PRIMARY KEY,
  value BIGINT NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS bot_config (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS bypass_logs (
  id          BIGSERIAL PRIMARY KEY,
  user_id     TEXT,
  guild_id    TEXT,
  channel_id  TEXT,
  source      TEXT,
  url         TEXT,
  domain      TEXT,
  result_url  TEXT,
  success     BOOLEAN NOT NULL,
  error       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bypass_logs_created_idx ON bypass_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS bypass_logs_user_idx    ON bypass_logs (user_id);
CREATE INDEX IF NOT EXISTS bypass_logs_guild_idx   ON bypass_logs (guild_id);
INSERT INTO counters (key, value) VALUES ('bypasses',0), ('autoBypasses',0), ('failures',0)
  ON CONFLICT (key) DO NOTHING;
`;

export async function initDb() {
  if (!config.databaseUrl) {
    log.warn('DATABASE_URL not set — running memory-only (state will not persist across restarts).');
    return false;
  }
  const res = await q(DDL);
  if (!res) {
    log.err('Database unreachable at boot — running memory-only (will retry every 60s).');
    return false;
  }
  await Promise.all([refreshAutobypass(), refreshBlacklist(), refreshCounters(), store.loadCooldownOverrides()]);
  // URL parsing (split('@') lands mid-password when the password contains @)
  const dbHost = (() => {
    try { return new URL(config.databaseUrl).host || 'database'; } catch { return 'database'; }
  })();
  log.ok(`Neon Postgres ready — ${dbHost} (pool max 4)`);
  return true;
}

export async function shutdownDb() {
  if (pool) {
    await pool.end().catch(() => {});
    pool = null;
  }
}

/* ------------------------------------------------------------------ */
/* In-memory caches (sync reads for hot paths)                         */
/* ------------------------------------------------------------------ */

const autobypassCache = new Map(); // guildId -> Set(channelId)
const blacklistCache = new Set(); // 'user:id' | 'guild:id'
const countersCache = { bypasses: 0, autoBypasses: 0, failures: 0 };
const cooldownCache = new Map(); // name | '*' -> seconds
const configCache = new Map(); // key -> { value, at }
const feedbackMemory = []; // /feedback entries when the DB is unreachable

async function refreshAutobypass() {
  const res = await q('SELECT guild_id, channel_id FROM autobypass_channels');
  if (!res) return;
  autobypassCache.clear();
  for (const row of res.rows) {
    if (!autobypassCache.has(row.guild_id)) autobypassCache.set(row.guild_id, new Set());
    autobypassCache.get(row.guild_id).add(row.channel_id);
  }
}

async function refreshBlacklist() {
  const res = await q('SELECT type, target_id FROM blacklist');
  if (!res) return;
  blacklistCache.clear();
  for (const row of res.rows) blacklistCache.add(`${row.type}:${row.target_id}`);
}

async function refreshCounters() {
  const res = await q('SELECT key, value FROM counters');
  if (!res) return;
  for (const row of res.rows) {
    if (row.key in countersCache) countersCache[row.key] = Number(row.value) || 0;
  }
}

/* ------------------------------------------------------------------ */
/* Store — auto-bypass channels                                        */
/* ------------------------------------------------------------------ */

export const store = {
  /** channelIds armed in a guild (array, sync) */
  autobypassChannels(guildId) {
    return [...(autobypassCache.get(guildId) ?? [])];
  },

  /** every armed channel id across all guilds (Set, sync) — hot path */
  allAutobypassChannelIds() {
    const set = new Set();
    for (const channels of autobypassCache.values()) for (const c of channels) set.add(c);
    return set;
  },

  totalAutobypassChannels() {
    return store.allAutobypassChannelIds().size;
  },

  autobypassGuildCount() {
    return autobypassCache.size;
  },

  autobypassEnable(guildId, channelId, addedBy = null) {
    if (!autobypassCache.has(guildId)) autobypassCache.set(guildId, new Set());
    autobypassCache.get(guildId).add(channelId);
    q(
      `INSERT INTO autobypass_channels (guild_id, channel_id, added_by) VALUES ($1,$2,$3)
       ON CONFLICT (guild_id, channel_id) DO NOTHING`,
      [guildId, channelId, addedBy]
    ).catch(() => {});
  },

  autobypassDisable(guildId, channelId) {
    autobypassCache.get(guildId)?.delete(channelId);
    if (autobypassCache.get(guildId)?.size === 0) autobypassCache.delete(guildId);
    q('DELETE FROM autobypass_channels WHERE guild_id=$1 AND channel_id=$2', [guildId, channelId]).catch(() => {});
  },

  autobypassDisableAll(guildId) {
    autobypassCache.delete(guildId);
    q('DELETE FROM autobypass_channels WHERE guild_id=$1', [guildId]).catch(() => {});
  },

  /* ---------------------------------------------------------------- */
  /* Blacklist (users + guilds)                                        */
  /* ---------------------------------------------------------------- */

  isBlacklisted(userId) {
    return blacklistCache.has(`user:${userId}`);
  },

  isGuildBlacklisted(guildId) {
    return guildId ? blacklistCache.has(`guild:${guildId}`) : false;
  },

  blacklistAdd(type, targetId, reason = null, addedBy = null) {
    blacklistCache.add(`${type}:${targetId}`);
    q(
      `INSERT INTO blacklist (type, target_id, reason, added_by) VALUES ($1,$2,$3,$4)
       ON CONFLICT (type, target_id) DO UPDATE SET reason = EXCLUDED.reason`,
      [type, targetId, reason, addedBy]
    ).catch(() => {});
  },

  blacklistRemove(type, targetId) {
    blacklistCache.delete(`${type}:${targetId}`);
    q('DELETE FROM blacklist WHERE type=$1 AND target_id=$2', [type, targetId]).catch(() => {});
  },

  /** cached list for display; fresh read straight from the DB */
  async blacklistList() {
    const res = await q('SELECT type, target_id, reason, added_by, created_at FROM blacklist ORDER BY created_at DESC LIMIT 50');
    return res ? res.rows : [];
  },

  /* ---------------------------------------------------------------- */
  /* Lifetime counters                                                 */
  /* ---------------------------------------------------------------- */

  get counters() {
    return countersCache;
  },

  bump(metric) {
    countersCache[metric] = (countersCache[metric] ?? 0) + 1;
    q(
      `INSERT INTO counters (key, value) VALUES ($1, 1)
       ON CONFLICT (key) DO UPDATE SET value = counters.value + 1`,
      [metric]
    ).catch(() => {});
  },

  /* ---------------------------------------------------------------- */
  /* Cooldown overrides (owner)                                        */
  /* ---------------------------------------------------------------- */

  cooldownSeconds(commandName, defaultSec) {
    return cooldownCache.get(commandName) ?? cooldownCache.get('*') ?? defaultSec;
  },

  cooldownOverrides() {
    return Object.fromEntries(cooldownCache);
  },

  async loadCooldownOverrides() {
    const res = await q('SELECT key, value FROM bot_config WHERE key = $1', ['cooldowns']);
    if (res?.rows?.[0]) {
      const obj = res.rows[0].value ?? {};
      cooldownCache.clear();
      for (const [k, v] of Object.entries(obj)) cooldownCache.set(k, Number(v) || 0);
    }
  },

  setCooldown(commandName, seconds) {
    if (seconds > 0) cooldownCache.set(commandName, seconds);
    else cooldownCache.delete(commandName);
    q(
      `INSERT INTO bot_config (key, value) VALUES ('cooldowns', $1::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = $1::jsonb, updated_at = now()`,
      [JSON.stringify(store.cooldownOverrides())]
    ).catch(() => {});
  },

  /* ---------------------------------------------------------------- */
  /* Generic key/value config (maintenance mode, …)                    */
  /* ---------------------------------------------------------------- */

  async getConfig(key, fallback = null) {
    const hit = configCache.get(key);
    if (hit && Date.now() - hit.at < 15_000) return hit.value;
    const res = await q('SELECT value FROM bot_config WHERE key = $1', [key]);
    const value = res?.rows?.[0]?.value ?? fallback;
    configCache.set(key, { value, at: Date.now() });
    return value;
  },

  setConfig(key, value) {
    configCache.set(key, { value, at: Date.now() });
    q(
      `INSERT INTO bot_config (key, value) VALUES ($1, $2::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = $2::jsonb, updated_at = now()`,
      [key, JSON.stringify(value)]
    ).catch(() => {});
  },

  /* ---------------------------------------------------------------- */
  /* User feedback (/feedback → owners)                                */
  /* ---------------------------------------------------------------- */

  /** Atomic server-side append to the 'feedback' JSONB array (last 50 kept). */
  appendFeedback(entry) {
    feedbackMemory.push(entry);
    if (feedbackMemory.length > 50) feedbackMemory.shift();
    q(
      `INSERT INTO bot_config (key, value) VALUES ('feedback', $1::jsonb)
       ON CONFLICT (key) DO UPDATE SET
         value = COALESCE((
           SELECT jsonb_agg(elem ORDER BY ord)
           FROM jsonb_array_elements(bot_config.value || $1::jsonb) WITH ORDINALITY AS t(elem, ord)
           WHERE ord > GREATEST(0, jsonb_array_length(bot_config.value || $1::jsonb) - 50)
         ), '[]'::jsonb),
         updated_at = now()`,
      [JSON.stringify([entry])]
    ).catch(() => {});
  },

  /** Newest first. Prefers the database; falls back to in-memory entries. */
  async recentFeedback(limit = 10) {
    const res = await q(`SELECT value FROM bot_config WHERE key = 'feedback'`);
    const rows = res?.rows?.[0]?.value;
    if (Array.isArray(rows) && rows.length) return rows.slice(-limit).reverse();
    return feedbackMemory.slice(-limit).reverse();
  },

  /* ---------------------------------------------------------------- */
  /* Bypass logs (audit trail + public stats)                          */
  /* ---------------------------------------------------------------- */

  logBypass({ userId = null, guildId = null, channelId = null, source = null, url = null, domain = null, resultUrl = null, success = false, error = null }) {
    if (!dbOk) return; // logging is best-effort; never blocks a bypass
    q(
      `INSERT INTO bypass_logs (user_id, guild_id, channel_id, source, url, domain, result_url, success, error)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [userId, guildId, channelId, source, url, domain, resultUrl, Boolean(success), error ? String(error).slice(0, 300) : null]
    ).catch(() => {});
  },

  async recentLogs({ userId = null, guildId = null, limit = 10 } = {}) {
    // 25 for the in-app cards; the dashboard export asks for 1000 and used
    // to silently receive 25 — allow up to 1000 explicitly.
    const cap = Math.min(Math.max(1, limit), 1000);
    let res;
    if (userId) res = await q('SELECT * FROM bypass_logs WHERE user_id=$1 ORDER BY id DESC LIMIT $2', [userId, cap]);
    else if (guildId) res = await q('SELECT * FROM bypass_logs WHERE guild_id=$1 ORDER BY id DESC LIMIT $2', [guildId, cap]);
    else res = await q('SELECT * FROM bypass_logs ORDER BY id DESC LIMIT $1', [cap]);
    return res ? res.rows : [];
  },

  /** The most recent log row for a user (any outcome) — powers /bx last. */
  async lastBypass(userId) {
    const res = await q('SELECT * FROM bypass_logs WHERE user_id=$1 ORDER BY id DESC LIMIT 1', [userId]);
    return res?.rows?.[0] ?? null;
  },

  /** Personal history with optional domain filter — powers /history. */
  async userHistory(userId, { domain = null, limit = 10 } = {}) {
    const cap = Math.min(Math.max(1, limit), 20);
    const res = domain
      ? await q('SELECT * FROM bypass_logs WHERE user_id=$1 AND domain ILIKE $2 ORDER BY id DESC LIMIT $3', [userId, `%${domain}%`, cap])
      : await q('SELECT * FROM bypass_logs WHERE user_id=$1 ORDER BY id DESC LIMIT $2', [userId, cap]);
    return res ? res.rows : [];
  },

  /** Top users by successful bypasses — powers /leaderboard (IDs only; the command resolves names). */
  async topUsers(limit = 10) {
    const cap = Math.min(Math.max(1, limit), 20);
    const res = await q(
      `SELECT user_id, COUNT(*)::int AS n FROM bypass_logs
       WHERE success AND user_id IS NOT NULL
       GROUP BY user_id ORDER BY n DESC LIMIT $1`,
      [cap]
    );
    return res ? res.rows : [];
  },

  /** Per-command usage counters (keys look like cmd:<name>) — dashboard + /commands. */
  async commandCounts() {
    const res = await q("SELECT key, value FROM counters WHERE key LIKE 'cmd:%' ORDER BY value DESC LIMIT 100");
    return res
      ? res.rows.map((r) => ({ name: String(r.key).slice('cmd:'.length), count: Number(r.value) || 0 }))
      : [];
  },

  /** Owner-only raw query passthrough (/owner sql + dashboard sql_query). */
  async rawQuery(text) {
    return q(text);
  },

  /** Aggregated stats for /stats and /owner stats — null fields when DB is off. */
  async publicStats() {
    if (!dbOk) return null;
    const [totals, day, domains, users] = await Promise.all([
      q(`SELECT COUNT(*)::int AS n, COALESCE(SUM(CASE WHEN success THEN 1 ELSE 0 END),0)::int AS ok FROM bypass_logs`),
      q(`SELECT COUNT(*)::int AS n, COALESCE(SUM(CASE WHEN success THEN 1 ELSE 0 END),0)::int AS ok FROM bypass_logs WHERE created_at > now() - interval '24 hours'`),
      q(`SELECT domain, COUNT(*)::int AS n FROM bypass_logs WHERE success AND domain IS NOT NULL AND created_at > now() - interval '30 days' GROUP BY domain ORDER BY n DESC LIMIT 5`),
      q(`SELECT COUNT(DISTINCT user_id)::int AS n FROM bypass_logs WHERE user_id IS NOT NULL`),
    ]);
    const total = totals?.rows?.[0]?.n ?? null;
    if (total == null) return null;
    const dayRow = day?.rows?.[0] ?? {};
    return {
      total,
      successRate: total ? Math.round(((totals?.rows?.[0]?.ok ?? 0) / total) * 100) : 0,
      last24h: dayRow.n ?? 0,
      last24hOk: dayRow.ok ?? 0,
      topDomains: domains?.rows ?? [],
      users: users?.rows?.[0]?.n ?? 0,
    };
  },

  /** Personal usage stats — null when the DB is offline or history is empty. */
  async userStats(userId) {
    if (!dbOk) return null;
    const [tot, day, week, fav] = await Promise.all([
      q(`SELECT COUNT(*)::int AS n, COALESCE(SUM(CASE WHEN success THEN 1 ELSE 0 END),0)::int AS ok FROM bypass_logs WHERE user_id=$1`, [userId]),
      q(`SELECT COUNT(*)::int AS n FROM bypass_logs WHERE user_id=$1 AND created_at > now() - interval '24 hours'`, [userId]),
      q(`SELECT COUNT(*)::int AS n FROM bypass_logs WHERE user_id=$1 AND created_at > now() - interval '7 days'`, [userId]),
      q(`SELECT domain FROM bypass_logs WHERE user_id=$1 AND success AND domain IS NOT NULL GROUP BY domain ORDER BY COUNT(*) DESC LIMIT 1`, [userId]),
    ]);
    const total = tot?.rows?.[0]?.n ?? null;
    if (total == null || total === 0) return null;
    return {
      total,
      successRate: Math.round(((tot?.rows?.[0]?.ok ?? 0) / total) * 100),
      last24h: day?.rows?.[0]?.n ?? 0,
      last7d: week?.rows?.[0]?.n ?? 0,
      favorite: fav?.rows?.[0]?.domain ?? null,
    };
  },

  /** Guild-scoped 30-day activity — null when the DB is offline. */
  async guildStats(guildId) {
    if (!dbOk) return null;
    const [tot, dom, users] = await Promise.all([
      q(`SELECT COUNT(*)::int AS n FROM bypass_logs WHERE guild_id=$1 AND created_at > now() - interval '30 days'`, [guildId]),
      q(`SELECT domain, COUNT(*)::int AS n FROM bypass_logs WHERE guild_id=$1 AND success AND domain IS NOT NULL AND created_at > now() - interval '30 days' GROUP BY domain ORDER BY n DESC LIMIT 3`, [guildId]),
      q(`SELECT COUNT(DISTINCT user_id)::int AS n FROM bypass_logs WHERE guild_id=$1 AND created_at > now() - interval '30 days'`, [guildId]),
    ]);
    if (tot?.rows?.[0]?.n == null) return null;
    const total = tot.rows[0].n;
    if (total === 0) return { total: 0, successRate: 0, users: 0, topDomains: [] };
    const all = await q(`SELECT COALESCE(SUM(CASE WHEN success THEN 1 ELSE 0 END),0)::int AS ok FROM bypass_logs WHERE guild_id=$1`, [guildId]);
    return {
      total,
      successRate: Math.round(((all?.rows?.[0]?.ok ?? 0) / total) * 100),
      users: users?.rows?.[0]?.n ?? 0,
      topDomains: dom?.rows ?? [],
    };
  },

  /** Zero the lifetime counters (dashboard "stats reset"). */
  async resetCounters() {
    for (const k of Object.keys(countersCache)) countersCache[k] = 0;
    await q('UPDATE counters SET value = 0');
  },

  /** Delete bypass logs older than N days — returns rows removed (null when DB off). */
  async pruneLogs(days = 30) {
    const d = Math.max(1, Math.min(365, Number(days) || 30));
    const res = await q('DELETE FROM bypass_logs WHERE created_at < now() - ($1 || \' days\')::interval RETURNING id', [String(d)]);
    return res ? res.rowCount : null;
  },
};
