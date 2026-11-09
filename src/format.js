/**
 * Rich message formats — the visual voice of the bot.
 *
 * Discord renders fenced code blocks with syntax highlighting. The two stars:
 *   ```diff  → lines starting with `+` render GREEN, `-` RED, `!` ORANGE,
 *              `@@ … @@` headers render CYAN
 *   ```ansi  → full ANSI escape support (colors, bold, underline)
 *
 * Everything here is pure string shaping — no Discord.js, so the dashboard,
 * commands and components can all share one format voice.
 *
 * Sizes: a plain message is capped at 2000 chars; one Components V2
 * TextDisplay at 4000; code block content stays below that through `cut`.
 */

const ANSI = {
  reset: '\u001b[0m',
  bold: (s) => `\u001b[1m${s}\u001b[0m`,
  dim: (s) => `\u001b[2m${s}\u001b[0m`,
  underline: (s) => `\u001b[4m${s}\u001b[0m`,
  grey: (s) => `\u001b[0;30m${s}\u001b[0m`,
  red: (s) => `\u001b[0;31m${s}\u001b[0m`,
  green: (s) => `\u001b[0;32m${s}\u001b[0m`,
  yellow: (s) => `\u001b[0;33m${s}\u001b[0m`,
  blue: (s) => `\u001b[0;34m${s}\u001b[0m`,
  magenta: (s) => `\u001b[0;35m${s}\u001b[0m`,
  cyan: (s) => `\u001b[0;36m${s}\u001b[0m`,
  white: (s) => `\u001b[0;37m${s}\u001b[0m`,
  bgRed: (s) => `\u001b[0;41m${s}\u001b[0m`,
  bgGreen: (s) => `\u001b[0;42m${s}\u001b[0m`,
};

export { ANSI as ansi };

/** Trim a string to `max` visible characters with an ellipsis. */
export function cut(value, max = 1800) {
  const s = String(value ?? '');
  if (s.length <= max) return s;
  return `${s.slice(0, Math.max(0, max - 1))}…`;
}

/** Escape backticks so a string can safely sit inside a code fence. */
function fenceSafe(body) {
  return String(body ?? '').replace(/```/g, '``\u200b`');
}

/** A fenced code block with a language hint (```lang\n…\n```). */
export function codeBlock(lang, body, max = 1800) {
  return `\`\`\`${lang || ''}\n${cut(fenceSafe(body), max)}\n\`\`\``;
}

/**
 * A ```diff block — Discord's native green/red status renderer.
 *   + green line  (additions, success rows)
 *   - red line    (removals, errors)
 *   ! orange line (warnings)
 *   @@ cyan line  (section headers)
 * Pass arrays of strings; each is prefixed automatically.
 */
export function diffBlock({ add = [], del = [], warn = [], info = [], max = 1800 } = {}) {
  const lines = [];
  for (const l of info) lines.push(`@@ ${l} @@`);
  for (const l of add) lines.push(`+ ${l}`);
  for (const l of warn) lines.push(`! ${l}`);
  for (const l of del) lines.push(`- ${l}`);
  if (!lines.length) lines.push('+ all systems operational');
  return codeBlock('diff', lines.join('\n'), max);
}

/** Shorthand: green `+` lines (the "+ boostylink fixed" style). */
export function diffOk(...lines) {
  return diffBlock({ add: lines });
}

/** Shorthand: a single red `-` line (error style). */
export function diffFail(...lines) {
  return diffBlock({ del: lines });
}

/** Green success rows + optional red/orange rows in one diff block. */
export function diffStatus({ ok = [], fail = [], warn = [], title = null, max = 1800 } = {}) {
  return diffBlock({ add: ok, del: fail, warn, info: title, max });
}

/**
 * An ```ansi block — for dashboard-style live panels.
 * Pass an array of already-colored lines built from the `ansi` helpers.
 */
export function ansiBlock(lines, max = 1800) {
  return codeBlock('ansi', lines.filter(Boolean).join('\n'), max);
}

/** ASCII meter bar — `▰▰▰▱▱ 62%` (10 chars wide). */
export function bar(pct, width = 10) {
  const v = Math.max(0, Math.min(100, Number(pct) || 0));
  const filled = Math.round((v / 100) * width);
  return `${'▰'.repeat(filled)}${'▱'.repeat(width - filled)} ${Math.round(v)}%`;
}

/**
 * Key/value list with aligned pipes — reads like a terminal table inside
 * a code fence. `rows` = [['key', 'value'], …]; keys padded to the widest.
 */
export function kvTable(rows, { title = null, lang = 'ml' } = {}) {
  const lines = rows.map(([k, v]) => [String(k), String(v)]);
  const width = Math.max(0, ...lines.map(([k]) => k.length));
  const body = [];
  if (title) body.push(`── ${title} ${'─'.repeat(Math.max(0, 24 - title.length))}`);
  for (const [k, v] of lines) body.push(`${k.padEnd(width)} │ ${v}`);
  return codeBlock(lang, body.join('\n'), 1800);
}

/** Inline code, backtick-safe. */
export function inline(value) {
  const s = String(value ?? '');
  return /`/.test(s) ? `\`\u200b${s.replace(/`/g, 'ʼ')}\`` : `\`${s}\``;
}

/** Bulleted list (max N bullets). */
export function bullets(items, { max = 20 } = {}) {
  return items
    .slice(0, max)
    .map((it) => `• ${typeof it === 'string' ? it : String(it)}`)
    .join('\n');
}
