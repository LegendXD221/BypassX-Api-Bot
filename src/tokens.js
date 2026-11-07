/**
 * Short-lived server-side tokens backing interaction custom IDs.
 *
 * Custom IDs are capped at 100 characters and visible to every client, so
 * raw URLs / OAuth refs never go into them — buttons carry an opaque token
 * and the payload stays in process memory with a TTL.
 */
const tokens = new Map();
let seq = 0;
const MAX_TOKENS = 600;

export function issueToken(payload, ttlMs = 30 * 60_000) {
  const token = `${(++seq).toString(36)}${Math.random().toString(36).slice(2, 8)}`;
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
