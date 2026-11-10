/**
 * Short-lived server-side tokens backing interaction custom IDs.
 *
 * Custom IDs are capped at 100 characters and visible to every client, so
 * raw URLs / OAuth refs never go into them — buttons carry an opaque token
 * and the payload stays in process memory with a TTL.
 */
import crypto from 'node:crypto';

const tokens = new Map();
const MAX_TOKENS = 600;

export function issueToken(payload, ttlMs = 30 * 60_000) {
  // CSPRNG — custom IDs are visible to the whole channel and the old
  // (seq + Math.random) scheme was sequence-guessable, which mattered for
  // owner-scoped payloads (e.g. ephemeral copy content).
  const token = crypto.randomBytes(12).toString('base64url');
  tokens.set(token, { ...payload, expires: Date.now() + ttlMs });
  if (tokens.size > MAX_TOKENS) {
    const now = Date.now();
    for (const [key, value] of tokens) if (value.expires < now) tokens.delete(key);
    while (tokens.size > MAX_TOKENS) tokens.delete(tokens.keys().next().value);
  }
  return token;
}

/** Peek (does NOT consume — copy buttons stay usable by several people). */
export function takeToken(token) {
  const t = tokens.get(token);
  if (!t) return null;
  if (Date.now() > t.expires) {
    tokens.delete(token);
    return null;
  }
  return t;
}

export function cleanupTokens() {
  const now = Date.now();
  for (const [key, value] of tokens) if (value.expires < now) tokens.delete(key);
}

export function tokenStats() {
  return tokens.size;
}
