/**
 * Command catalog — one source of truth for command categories.
 * /commands renders it, /help summarizes it, the dashboard surfaces it.
 * Categories are assigned by explicit list (order = display order).
 */

export const CATEGORY_META = {
  bypass: { label: 'Bypass', emoji: '⚡' },
  info: { label: 'Info & stats', emoji: '📊' },
  utility: { label: 'Utility', emoji: '🧰' },
  fun: { label: 'Fun', emoji: '🎲' },
  server: { label: 'Server tools', emoji: '🛠️' },
  meta: { label: 'About', emoji: '🧭' },
  owner: { label: 'Owner', emoji: '👑' },
};

/** Explicit category assignment — anything unlisted lands in 'meta'. */
const ASSIGNMENT = {
  bypass: ['bypass', 'bx', 'check', 'bypass-link'],
  info: ['services', 'serviceinfo', 'randomservice', 'stats', 'status', 'me', 'recent', 'history', 'leaderboard', 'userinfo', 'serverinfo', 'botinfo'],
  utility: ['utility', 'reminder', 'poll', 'commands', 'shortcuts'],
  fun: ['fun'],
  server: ['server', 'autobypass', 'enable-autobypass', 'disable-autobypass'],
  meta: ['help', 'invite', 'support', 'website', 'docs', 'faq', 'privacy', 'changelog', 'tip', 'uptime', 'ping'],
  owner: ['owner'],
};

export function categoryFor(name) {
  for (const [cat, names] of Object.entries(ASSIGNMENT)) {
    if (names.includes(name)) return cat;
  }
  return 'meta';
}

/** Map a discord.js Collection of commands into ordered category groups. */
export function categorize(commands) {
  const groups = new Map();
  for (const cmd of commands.values()) {
    const cat = categoryFor(cmd.data.name);
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat).push({ name: cmd.data.name, description: cmd.data.description });
  }
  return groups;
}

/** Total invokable actions: top-level commands + subcommands + context menus. */
export function countInvokables(commands) {
  let n = 0;
  for (const cmd of commands.values()) {
    const subs = cmd.data.options?.filter((o) => o.toJSON && o.name) ?? [];
    // SlashCommandSubcommandBuilder instances expose .name; treat options
    // with a `type` of SUB_COMMAND as subcommands.
    let subCount = 0;
    for (const opt of cmd.data.options ?? []) {
      try {
        const j = opt.toJSON();
        if (j.type === 1) subCount++; // SUB_COMMAND
      } catch {
        /* non-subcommand option */
      }
    }
    n += 1 + subCount;
  }
  return n;
}
