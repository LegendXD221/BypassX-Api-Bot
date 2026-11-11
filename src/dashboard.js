import crypto from 'node:crypto';
import util from 'node:util';
import { PermissionsBitField, ChannelType } from 'discord.js';
import { config } from './config.js';
import { store, dbHealthy } from './db.js';
import { cacheClear, cacheStats, measureApi, refreshSupported, metrics, bypassUrl } from './api.js';
import { apiHealth } from './watchdog.js';
import { log } from './logger.js';
import { dashboardHtml, dashboardLoginHtml } from './dashboard-page.js';
import { diffBlock, codeBlock } from './format.js';
import { countInvokables } from './commands/catalog.js';

/* ------------------------------------------------------------------ */
/* Auth — timing-safe token compare, header (?Authorization: Bearer)   */
/* or query (?token=). Dashboard is fully disabled when DASHBOARD_TOKEN*/
/* is not configured — every route answers 404 like it doesn't exist.  */
/* ------------------------------------------------------------------ */

function tokenOk(req, url) {
  const expected = config.dashboardToken;
  if (!expected) return false;
  const header = String(req.headers?.authorization ?? '');
  const bearer = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const query = String(url.searchParams.get('token') ?? '');
  const given = bearer || query;
  if (!given || given.length > 256) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function sendJson(res, code, body, extraHeaders = {}) {
  const raw = JSON.stringify(body);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extraHeaders });
  res.end(raw);
}

function sendHtml(res, code, html) {
  res.writeHead(code, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
  });
  res.end(html);
}

async function readJsonBody(req, cap = 64 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > cap) throw new Error('payload too large');
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8') || '{}';
  return JSON.parse(raw);
}

/* ------------------------------------------------------------------ */
/* Overview payload                                                    */
/* ------------------------------------------------------------------ */

const PRESENCE_TYPES = { playing: 0, streaming: 1, listening: 2, watching: 3, competing: 5 };

async function buildOverview(ctx) {
  const client = ctx.getClient();
  const guilds = client
    ? client.guilds.cache.map((g) => ({
        id: g.id,
        name: g.name,
        icon: typeof g.iconURL === 'function' ? g.iconURL({ size: 64 }) : null,
        members: g.memberCount ?? null,
        channels: g.channels?.cache?.size ?? 0,
        ownerId: g.ownerId,
        joined: g.joinedTimestamp ?? null,
        autobypass: [...(store.autobypassChannels(g.id) ?? [])],
        blacklisted: store.isGuildBlacklisted(g.id),
      }))
    : [];
  guilds.sort((a, b) => (b.members ?? 0) - (a.members ?? 0));

  const [maintenance, disabledCommands, logs, blacklists, feedback, stats] = await Promise.all([
    store.getConfig('maintenance', false),
    store.getConfig('disabledCommands', []),
    store.recentLogs({ limit: 15 }),
    store.blacklistList(),
    store.recentFeedback(5),
    store.publicStats(),
  ]);

  const counters = { ...store.counters };
  const totalBypass = (counters.bypasses ?? 0) + (counters.failures ?? 0);

  return {
    ts: Date.now(),
    bot: {
      version: config.version,
      tag: client?.user?.tag ?? null,
      id: client?.user?.id ?? null,
      avatar: client?.user?.displayAvatarURL?.({ size: 64 }) ?? null,
      uptimeSec: Math.floor(process.uptime()),
      wsPingMs: Number.isFinite(client?.ws?.ping) ? client.ws.ping : null,
      memoryMB: Math.round(process.memoryUsage().rss / 1048576),
      node: process.version,
      commandCount: client?.commands?.size ?? client?.commands?.length ?? 0,
      invokableCount: countInvokables(client?.commands),
      presence:
        client?.presence?.activities?.length
          ? client.presence.activities.map((a) => `${a.name}`).join(', ')
          : null,
      autobypassDisabled: Boolean(client?.autobypassDisabled),
    },
    guilds: {
      count: guilds.length,
      totalMembers: guilds.reduce((n, g) => n + (g.members ?? 0), 0),
      list: guilds,
    },
    counters,
    successRate: totalBypass ? Math.round(((counters.bypasses ?? 0) / totalBypass) * 100) : null,
    metrics: { ...metrics },
    cache: cacheStats(),
    apiHealth: apiHealth(),
    db: { healthy: dbHealthy() },
    flags: { maintenance, disabledCommands },
    blacklists,
    feedback,
    stats,
    logs,
  };
}

/* ------------------------------------------------------------------ */
/* Actions — the owner arsenal                                         */
/* ------------------------------------------------------------------ */

function needClient(ctx) {
  const client = ctx.getClient();
  if (!client?.user) throw new Error('bot client not ready yet');
  return client;
}

function reqId(v, name) {
  const s = String(v ?? '').trim();
  if (!/^\d{5,25}$/.test(s)) throw new Error(`${name} must be a Discord ID (digits)`);
  return s;
}

function reqText(v, name, max = 1900) {
  const s = String(v ?? '');
  // VERBATIM passthrough: `.trim()` used to strip leading/trailing blank
  // lines — real content for ```diff```/quote compositions. The trimmed
  // copy is used only for the required-check and the length check (the
  // length check on the raw string is the safe direction: UTF-16 length
  // >= code points, so it can never under-count Discord's cap).
  if (!s.trim()) throw new Error(`${name} is required`);
  if (s.length > max) throw new Error(`${name} too long (max ${max})`);
  return s;
}

/* ---- op-tools resolvers (shared by the OP TOOLS arsenal) ---- */

function needGuild(ctx, guildId) {
  const g = needClient(ctx).guilds.cache.get(reqId(guildId, 'guildId'));
  if (!g) throw new Error('guild not found');
  return g;
}

async function needMember(g, userId) {
  const m = await g.members.fetch(reqId(userId, 'userId')).catch(() => null);
  if (!m) throw new Error('member not found in that guild');
  return m;
}

function needRole(g, roleId) {
  const r = g.roles.cache.get(reqId(roleId, 'roleId'));
  if (!r) throw new Error('role not found in that guild');
  return r;
}

/** Hierarchy guard — I can never assign/edit a role at or above my peak. */
function guardRoleHierarchy(g, role) {
  const me = g.members.me;
  if (me && role.position >= me.roles.highest.position) {
    throw new Error(`role **${role.name}** is at/above my highest role — move my role higher first`);
  }
}

function needGuildChannel(ctx, channelId) {
  return needClient(ctx).channels.fetch(reqId(channelId, 'channelId'));
}

export const ACTIONS = {
  /* ---------------- messaging ---------------- */
  async dm_user({ userId, message }, ctx) {
    const client = needClient(ctx);
    const user = await client.users.fetch(reqId(userId, 'userId'));
    await user.send({ content: reqText(message, 'message') });
    return `DM delivered to **${user.tag}**`;
  },

  async channel_send({ channelId, message }, ctx) {
    const client = needClient(ctx);
    const ch = await client.channels.fetch(reqId(channelId, 'channelId'));
    if (!ch?.send) throw new Error('channel not found or not text-based');
    await ch.send({ content: reqText(message, 'message'), allowedMentions: { parse: [] } });
    return `message sent to **#${ch.name ?? channelId}**`;
  },

  async broadcast_all({ message }, ctx) {
    const client = needClient(ctx);
    const ids = [...store.allAutobypassChannelIds()];
    if (!ids.length) return 'no armed auto-bypass channels to broadcast to';
    const text = reqText(message, 'message');
    let sent = 0;
    let failed = 0;
    for (const id of ids.slice(0, 60)) {
      const ch = await client.channels.fetch(id).catch(() => null);
      if (!ch?.send) { failed++; continue; }
      const ok = await ch.send({ content: text, allowedMentions: { parse: [] } }).then(() => true).catch(() => false);
      ok ? sent++ : failed++;
    }
    return `broadcast → ${sent} delivered, ${failed} failed (${ids.length} armed channels)`;
  },

  async broadcast_guild({ guildId, message }, ctx) {
    const client = needClient(ctx);
    const g = client.guilds.cache.get(reqId(guildId, 'guildId'));
    if (!g) throw new Error('guild not found');
    const ch =
      g.systemChannel ??
      g.channels.cache.find((c) => c.type === ChannelType.GuildText && c.permissionsFor(g.members.me)?.has(PermissionsBitField.Flags.SendMessages));
    if (!ch?.send) throw new Error('no sendable text channel in that guild');
    await ch.send({ content: reqText(message, 'message'), allowedMentions: { parse: [] } });
    return `broadcast posted in **${g.name}** → #${ch.name}`;
  },

  /* ---------------- guilds ---------------- */
  async guild_details({ guildId }, ctx) {
    const client = needClient(ctx);
    const g = client.guilds.cache.get(reqId(guildId, 'guildId'));
    if (!g) throw new Error('guild not found');
    const detail = {
      id: g.id,
      name: g.name,
      members: g.memberCount ?? null,
      ownerId: g.ownerId,
      createdAt: g.createdTimestamp ? new Date(g.createdTimestamp).toISOString() : null,
      joinedAt: g.joinedTimestamp ? new Date(g.joinedTimestamp).toISOString() : null,
      channels: g.channels?.cache?.size ?? 0,
      roles: g.roles?.cache?.size ?? 0,
      emojis: g.emojis?.cache?.size ?? 0,
      boosts: g.premiumSubscriptionCount ?? 0,
      large: Boolean(g.large),
      icon: typeof g.iconURL === 'function' ? g.iconURL({ size: 128 }) : null,
      autobypass: [...(store.autobypassChannels(g.id) ?? [])],
      blacklisted: store.isGuildBlacklisted(g.id),
    };
    return '```json\n' + JSON.stringify(detail, null, 2).slice(0, 1800) + '\n```';
  },

  async guild_channels({ guildId }, ctx) {
    const client = needClient(ctx);
    const g = client.guilds.cache.get(reqId(guildId, 'guildId'));
    if (!g) throw new Error('guild not found');
    const lines = g.channels.cache
      .sort((a, b) => a.rawPosition - b.rawPosition)
      .map((c) => `\`${c.id}\` ${c.type === ChannelType.GuildVoice ? '🔊' : '#'} ${c.name}`)
      .slice(0, 40);
    return `**${g.name}** — ${g.channels.cache.size} channels:\n${lines.join('\n')}`;
  },

  async guild_invite({ guildId }, ctx) {
    const client = needClient(ctx);
    const g = client.guilds.cache.get(reqId(guildId, 'guildId'));
    if (!g) throw new Error('guild not found');
    const me = g.members.me;
    const ch = g.channels.cache.find(
      (c) => c.type === ChannelType.GuildText && c.permissionsFor(me)?.has(PermissionsBitField.Flags.CreateInstantInvite)
    );
    if (!ch) return 'no text channel where I hold **Create Invite** — cannot create one';
    const inv = await g.invites.create(ch, { maxAge: 86400, maxUses: 25, unique: true });
    return `invite for **${g.name}** (24h · 25 uses): ${inv.url}`;
  },

  async leave_guild({ guildId }, ctx) {
    const client = needClient(ctx);
    const g = client.guilds.cache.get(reqId(guildId, 'guildId'));
    if (!g) throw new Error('guild not found');
    const name = g.name;
    await g.leave();
    return `left **${name}** (${guildId})`;
  },

  async find_user({ userId }, ctx) {
    const client = needClient(ctx);
    const u = await client.users.fetch(reqId(userId, 'userId'));
    const mutuals = [];
    for (const g of client.guilds.cache.values()) {
      if (mutuals.length >= 15) break;
      const m = await g.members.fetch(u.id).catch(() => null);
      if (m) mutuals.push(`${g.name}${m.displayName ? ` (as ${m.displayName})` : ''}`);
    }
    return [
      `**${u.tag}**${u.bot ? ' 🤖' : ''} — \`${u.id}\``,
      `created <t:${Math.floor(u.createdTimestamp / 1000)}:R> · avatar: ${u.displayAvatarURL({ size: 128 })}`,
      mutuals.length ? `shared servers: ${mutuals.join(', ')}` : 'no shared servers (or members cache empty)',
    ].join('\n');
  },

  /* ---------------- bot control ---------------- */
  async set_maintenance({ enabled }) {
    const on = Boolean(enabled);
    await store.setConfig('maintenance', on);
    return on ? '🛠️ maintenance **ON** — non-owner commands now pause' : '✅ maintenance **OFF** — bot is fully public again';
  },

  async set_presence({ type = 'watching', text }, ctx) {
    const client = needClient(ctx);
    const t = PRESENCE_TYPES[String(type).toLowerCase()] ?? 3;
    const name = reqText(text, 'activity text', 80);
    client.user.setPresence({ activities: [{ name, type: t }], status: 'online' });
    return `presence set → **${type} ${name}**`;
  },

  async clear_presence(args, ctx) {
    const client = needClient(ctx);
    client.user.setPresence({ activities: [] });
    return 'presence cleared — no activity shown';
  },

  async set_avatar({ url }, ctx) {
    const client = needClient(ctx);
    await client.user.setAvatar(reqText(url, 'image url', 500));
    return 'avatar updated (may take a few minutes to propagate everywhere)';
  },

  async set_username({ name }, ctx) {
    const client = needClient(ctx);
    await client.user.setUsername(reqText(name, 'username', 32));
    return `username changed to **${name}** — Discord allows this only twice per hour`;
  },

  async reconnect_gateway(args, ctx) {
    ctx.reconnect(); // fire-and-forget — respond before the gateway bounces
    return 'reconnect scheduled — gateway drops and re-logins in ~2s (dashboard blips once)';
  },

  async shutdown(args, ctx) {
    setTimeout(() => ctx.shutdown(), 300).unref();
    return 'shutdown in 300ms — Render will restart the service automatically';
  },

  /* ---------------- moderation ---------------- */
  async blacklist_user({ userId, reason }) {
    await store.blacklistAdd('user', reqId(userId, 'userId'), reason ? reqText(reason, 'reason', 200) : null, 'dashboard');
    return `user \`${userId}\` blacklisted`;
  },

  async unblacklist_user({ userId }) {
    await store.blacklistRemove('user', reqId(userId, 'userId'));
    return `user \`${userId}\` removed from blacklist`;
  },

  async blacklist_guild({ guildId, reason }) {
    await store.blacklistAdd('guild', reqId(guildId, 'guildId'), reason ? reqText(reason, 'reason', 200) : null, 'dashboard');
    return `guild \`${guildId}\` blacklisted`;
  },

  async unblacklist_guild({ guildId }) {
    await store.blacklistRemove('guild', reqId(guildId, 'guildId'));
    return `guild \`${guildId}\` removed from blacklist`;
  },

  async blacklist_list() {
    const list = await store.blacklistList();
    if (!list.length) return 'blacklist is empty';
    return list
      .slice(0, 50)
      .map((b) => `${b.type === 'guild' ? '🏠' : '👤'} \`${b.target_id ?? b.targetId}\`${b.reason ? ` — ${b.reason}` : ''}`)
      .join('\n');
  },

  async set_cooldown({ command, seconds }) {
    const name = reqText(command, 'command', 32).replace(/^\//, '');
    const sec = Math.max(0, Math.min(3600, Number(seconds) || 0));
    await store.setCooldown(name, sec);
    return sec === 0 ? `cooldown for \`${name}\` reset to default` : `cooldown for \`${name}\` → ${sec}s`;
  },

  async disable_command({ command }) {
    const name = reqText(command, 'command', 32).replace(/^\//, '');
    const cur = await store.getConfig('disabledCommands', []);
    if (cur.includes(name)) return `\`${name}\` is already disabled`;
    await store.setConfig('disabledCommands', [...cur, name]);
    return `\`/${name}\` disabled for everyone except you`;
  },

  async enable_command({ command }) {
    const name = reqText(command, 'command', 32).replace(/^\//, '');
    const cur = await store.getConfig('disabledCommands', []);
    const next = cur.filter((c) => c !== name);
    await store.setConfig('disabledCommands', next);
    return next.length === cur.length ? `\`${name}\` was not disabled` : `\`/${name}\` re-enabled`;
  },

  async toggle_autobypass({ enabled }, ctx) {
    const client = needClient(ctx);
    client.autobypassDisabled = !Boolean(enabled);
    return client.autobypassDisabled
      ? 'auto-bypass **globally disabled** (armed channels stay armed but idle)'
      : 'auto-bypass **globally enabled** — armed channels are live again';
  },

  /* ---------------- data & api ---------------- */
  async clear_cache() {
    const n = cacheClear();
    return `result cache cleared — ${n} entr${n === 1 ? 'y' : 'ies'} dropped`;
  },

  async refresh_services() {
    await refreshSupported(true);
    return 'supported-services registry refreshed from the API';
  },

  async stats_reset() {
    await store.resetCounters();
    return 'lifetime counters zeroed';
  },

  async prune_logs({ days = 30 }) {
    const n = await store.pruneLogs(days);
    return n == null ? 'database offline — nothing pruned' : `pruned ${n} bypass log(s) older than ${days} day(s)`;
  },

  async eval_js({ code }, ctx) {
    const client = needClient(ctx);
    const src = reqText(code, 'code', 4000);
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const fn = new AsyncFunction('client', 'config', 'store', 'ctx', src);
    const result = await Promise.race([
      fn(client, config, store, ctx),
      new Promise((_, rej) => setTimeout(() => rej(new Error('eval timeout (8s)')), 8000)),
    ]);
    return '```js\n' + util.inspect(result, { depth: 2, maxArrayLength: 20 }).slice(0, 1800) + '\n```';
  },

  async test_api() {
    const m = await measureApi();
    return `API probe → ${m?.ok ? '✅ reachable' : '❌ failed'} · ${m?.latencyMs ?? '?'}ms${m?.status ? ` · HTTP ${m.status}` : ''}`;
  },

  /* ═══════════════════ v2.0 additions ═══════════════════ */

  /* ---------------- messaging ---------------- */

  async send_embed({ channelId, json }, ctx) {
    const client = needClient(ctx);
    const ch = await client.channels.fetch(reqId(channelId, 'channelId'));
    if (!ch?.send) throw new Error('channel not found or not text-based');
    let payload;
    try {
      payload = JSON.parse(String(json ?? '{}'));
    } catch {
      throw new Error('embed JSON did not parse');
    }
    await ch.send({ embeds: [payload], allowedMentions: { parse: [] } });
    return `embed delivered to **#${ch.name ?? channelId}**`;
  },

  async dm_guild_owner({ guildId, message }, ctx) {
    const client = needClient(ctx);
    const g = client.guilds.cache.get(reqId(guildId, 'guildId'));
    if (!g) throw new Error('guild not found');
    const owner = await g.fetchOwner();
    await owner.send({ content: reqText(message, 'message') });
    return `DM delivered to **${owner.user?.tag ?? owner.id}** (owner of **${g.name}**)`;
  },

  async fetch_message({ channelId, messageId }, ctx) {
    const client = needClient(ctx);
    const ch = await client.channels.fetch(reqId(channelId, 'channelId'));
    const m = await ch?.messages?.fetch(reqId(messageId, 'messageId'));
    if (!m) throw new Error('message not found');
    return [
      `**${m.author?.tag ?? '?'}** in **#${ch.name ?? channelId}** <t:${Math.floor(m.createdTimestamp / 1000)}:R>`,
      codeBlock('', (m.content ?? '(no text content)').slice(0, 1500)),
    ].join('\n');
  },

  /* ---------------- guilds ---------------- */

  async guild_roles({ guildId }, ctx) {
    const client = needClient(ctx);
    const g = client.guilds.cache.get(reqId(guildId, 'guildId'));
    if (!g) throw new Error('guild not found');
    const lines = g.roles.cache
      .sort((a, b) => b.position - a.position)
      .first(30)
      .map((r) => `\`${r.hexColor === '#000000' ? 'default ' : r.hexColor}\` **${r.name}** — ${r.members?.size ?? '?'} members`);
    return `**${g.name}** — ${g.roles.cache.size} roles:\n${lines.join('\n')}`;
  },

  async guild_emojis({ guildId }, ctx) {
    const client = needClient(ctx);
    const g = client.guilds.cache.get(reqId(guildId, 'guildId'));
    if (!g) throw new Error('guild not found');
    const list = [...g.emojis.cache.values()].slice(0, 40).map((e) => `${e.animated ? '🎞️' : '🧩'} \`:${e.name}:\``);
    return `**${g.name}** — ${g.emojis.cache.size} emojis:\n${list.join(' ') || 'none'}`;
  },

  async guild_invites({ guildId }, ctx) {
    const client = needClient(ctx);
    const g = client.guilds.cache.get(reqId(guildId, 'guildId'));
    if (!g) throw new Error('guild not found');
    const invites = await g.invites.fetch().catch(() => null);
    if (!invites) return 'could not fetch invites (missing permission)';
    return `**${g.name}** — ${invites.size} active invite(s):\n${invites
      .first(20)
      .map((i) => `\`${i.code}\` · #${i.channel?.name ?? '?'} · ${i.uses ?? 0}/${i.maxUses ?? '∞'} uses${i.expiresTimestamp ? ` · expires <t:${Math.floor(i.expiresTimestamp / 1000)}:R>` : ''}`)
      .join('\n') || 'none'}`;
  },

  async guild_bans({ guildId }, ctx) {
    const client = needClient(ctx);
    const g = client.guilds.cache.get(reqId(guildId, 'guildId'));
    if (!g) throw new Error('guild not found');
    const bans = await g.bans.fetch().catch(() => null);
    if (!bans) return 'could not fetch bans (missing permission)';
    return `**${g.name}** — ${bans.size} ban(s):\n${bans
      .first(30)
      .map((b) => `👤 **${b.user?.tag ?? b.user?.id}**${b.reason ? ` — ${b.reason.slice(0, 80)}` : ''}`)
      .join('\n') || 'none'}`;
  },

  async guild_members({ guildId, query = '' }, ctx) {
    const client = needClient(ctx);
    const g = client.guilds.cache.get(reqId(guildId, 'guildId'));
    if (!g) throw new Error('guild not found');
    await g.members.fetch().catch(() => {});
    const term = String(query ?? '').toLowerCase();
    const list = [...g.members.cache.values()]
      .filter((m) => !term || m.user?.username?.toLowerCase().includes(term) || m.displayName?.toLowerCase().includes(term))
      .sort((a, b) => (b.joinedTimestamp ?? 0) - (a.joinedTimestamp ?? 0))
      .slice(0, 30)
      .map((m) => `**${m.user?.tag ?? m.id}**${m.user?.bot ? ' 🤖' : ''} — joined <t:${Math.floor((m.joinedTimestamp ?? Date.now()) / 1000)}:R>`);
    return `**${g.name}** — ${g.memberCount ?? g.members.cache.size} members${term ? ` matching “${term}”` : ''}:\n${list.join('\n') || 'none matched'}`;
  },

  async member_info({ guildId, userId }, ctx) {
    const client = needClient(ctx);
    const g = client.guilds.cache.get(reqId(guildId, 'guildId'));
    if (!g) throw new Error('guild not found');
    const m = await g.members.fetch(reqId(userId, 'userId')).catch(() => null);
    if (!m) throw new Error('member not found in that guild');
    const roles = m.roles.cache.filter((r) => r.id !== g.id).map((r) => r.name).slice(0, 20);
    return [
      `**${m.user?.tag}**${m.user?.bot ? ' 🤖' : ''} — \`${m.id}\``,
      `joined <t:${Math.floor((m.joinedTimestamp ?? 0) / 1000)}:R> · nickname: ${m.nickname ?? '—'}`,
      `roles (${m.roles.cache.size - 1}): ${roles.join(', ') || 'none'}`,
      `avatar: ${m.displayAvatarURL({ size: 128 })}`,
    ].join('\n');
  },

  async member_kick({ guildId, userId, reason }, ctx) {
    const client = needClient(ctx);
    const g = client.guilds.cache.get(reqId(guildId, 'guildId'));
    if (!g) throw new Error('guild not found');
    const m = await g.members.fetch(reqId(userId, 'userId')).catch(() => null);
    if (!m) throw new Error('member not found');
    await m.kick(reason ? reqText(reason, 'reason', 200) : undefined);
    return `kicked **${m.user?.tag ?? userId}** from **${g.name}**`;
  },

  async member_ban({ guildId, userId, reason }, ctx) {
    const client = needClient(ctx);
    const g = client.guilds.cache.get(reqId(guildId, 'guildId'));
    if (!g) throw new Error('guild not found');
    const m = await g.members.fetch(reqId(userId, 'userId')).catch(() => null);
    await g.members.ban(reqId(userId, 'userId'), { reason: reason ? reqText(reason, 'reason', 200) : 'banned via dashboard' });
    return `banned **${m?.user?.tag ?? userId}** from **${g.name}**${reason ? ` — ${reason}` : ''}`;
  },

  async member_timeout({ guildId, userId, minutes }, ctx) {
    const client = needClient(ctx);
    const g = client.guilds.cache.get(reqId(guildId, 'guildId'));
    if (!g) throw new Error('guild not found');
    const m = await g.members.fetch(reqId(userId, 'userId')).catch(() => null);
    if (!m) throw new Error('member not found');
    const mins = Math.max(1, Math.min(40320, Number(minutes) || 10));
    await m.timeout(mins * 60_000, 'timed out via dashboard');
    return `timed out **${m.user?.tag ?? userId}** for **${mins} min** in **${g.name}**`;
  },

  async create_channel({ guildId, name, type }, ctx) {
    const client = needClient(ctx);
    const g = client.guilds.cache.get(reqId(guildId, 'guildId'));
    if (!g) throw new Error('guild not found');
    const kind = String(type ?? 'text').toLowerCase() === 'voice' ? ChannelType.GuildVoice : ChannelType.GuildText;
    const ch = await g.channels.create({ name: reqText(name, 'name', 90), type: kind });
    return `created ${kind === ChannelType.GuildVoice ? 'voice' : 'text'} channel **#${ch.name}** in **${g.name}**`;
  },

  async delete_channel({ channelId }, ctx) {
    const client = needClient(ctx);
    const ch = await client.channels.fetch(reqId(channelId, 'channelId'));
    const name = ch?.name ?? channelId;
    await ch?.delete('deleted via owner dashboard');
    return `deleted channel **#${name}** (${channelId})`;
  },

  async create_role({ guildId, name, color }, ctx) {
    const client = needClient(ctx);
    const g = client.guilds.cache.get(reqId(guildId, 'guildId'));
    if (!g) throw new Error('guild not found');
    const data = { name: reqText(name, 'name', 90) };
    const m = /^#?([0-9a-f]{6})$/i.exec(String(color ?? '').trim());
    if (m) data.color = parseInt(m[1], 16);
    const role = await g.roles.create(data);
    return `created role **${role.name}** in **${g.name}**${color ? ` (${color})` : ''}`;
  },

  async delete_role({ guildId, roleId }, ctx) {
    const client = needClient(ctx);
    const g = client.guilds.cache.get(reqId(guildId, 'guildId'));
    if (!g) throw new Error('guild not found');
    const role = g.roles.cache.get(reqId(roleId, 'roleId'));
    if (!role) throw new Error('role not found');
    const name = role.name;
    await role.delete('deleted via owner dashboard');
    return `deleted role **${name}** from **${g.name}**`;
  },

  /* ---------------- bot control ---------------- */

  async set_status({ status }, ctx) {
    const client = needClient(ctx);
    const map = { online: 'online', idle: 'idle', dnd: 'dnd', invisible: 'invisible' };
    const s = map[String(status ?? 'online').toLowerCase()];
    if (!s) throw new Error('status must be online/idle/dnd/invisible');
    client.user.setStatus(s);
    return `status → **${s}**`;
  },

  async reload_commands(args, ctx) {
    const client = needClient(ctx);
    const { commandData } = await import('./commands/index.js');
    await client.application.commands.set(commandData);
    return `re-registered **${commandData.length}** global slash commands (guild-level sync happens on the gateway too)`;
  },

  async dump_env() {
    const names = Object.keys(process.env)
      .filter((k) => /DISCORD|CLIENT|OWNER|BX_|DATABASE|DASHBOARD|NODE_ENV|RENDER/i.test(k))
      .sort();
    return codeBlock('ml', names.map((n) => `${n}=${n.endsWith('TOKEN') || n.includes('KEY') || n.includes('DATABASE') ? '<redacted>' : 'set'}`).join('\n'));
  },

  /* ---------------- data & api ---------------- */

  async sql_query({ query }) {
    const sql = String(query ?? '').trim();
    if (!/^(select|with|show|explain|table)\b/i.test(sql)) {
      throw new Error('read-only enforced — only SELECT/WITH/SHOW/EXPLAIN/TABLE');
    }
    if (sql.includes(';')) {
      throw new Error('read-only enforced — single statement only (no ;)');
    }
    // The old guard only scanned AFTER a ';' — `WITH d AS (DELETE …) SELECT`
    // sailed through. The data-modifying keyword must appear literally
    // somewhere in the statement, so scan the WHOLE string. Owner-gated
    // tool: a false positive (a column named "created") just errors and the
    // owner rephrases — a false negative used to destroy data.
    if (/\b(delete|insert|update|drop|alter|truncate|create|grant|revoke|copy|vacuum|call|do|listen|notify|reindex|cluster|comment|lock|move|fetch|refresh|import|security|procedure|function)\b/i.test(sql.replace(/^\s*(with|select|show|explain|table)\b/i, ''))) {
      throw new Error('read-only enforced — data-modifying statements are rejected');
    }
    const res = await store.rawQuery(sql);
    const rows = res?.rows ?? [];
    return codeBlock('json', JSON.stringify(rows, null, 1).slice(0, 1800) || '[]');
  },

  async bypass_url({ url }, ctx) {
    const result = await bypassUrl(String(url ?? '').trim());
    if (result.kind === 'oauth') {
      return `⚠️ **${result.serviceName ?? 'key system'}** paused for a sign-in — run it in Discord with /bypass for the interactive handoff.`;
    }
    return [
      `**${result.serviceName ?? 'bypassed'}**${result.elapsedMs ? ` · ${(result.elapsedMs / 1000).toFixed(1)}s` : ''}${result.cached ? ' · cached' : ''}`,
      diffBlock({ add: [result.url] }),
    ].join('\n');
  },

  async feedback_list() {
    const rows = await store.recentFeedback(15);
    if (!rows.length) return 'no feedback yet';
    return rows
      .map((r) => `📝 **${r.from ?? '?'}**${r.guild ? ` · ${r.guild}` : ''}\n> ${(r.message ?? '').slice(0, 160)}`)
      .join('\n\n');
  },

  async feedback_clear() {
    await store.setConfig('feedback', []);
    return 'feedback inbox cleared (last 50 kept in DB history — this resets the active inbox)';
  },

  async command_counts() {
    const counts = await store.commandCounts();
    if (!counts.length) return 'no per-command counters recorded yet — they fill as commands run';
    const total = counts.reduce((n, c) => n + c.count, 0);
    return codeBlock(
      'ml',
      counts.slice(0, 25).map((c) => `/${c.name}`.padEnd(24) + String(c.count).padStart(6) + `  (${Math.round((c.count / total) * 100)}%)`).join('\n') + `\n${'—'.repeat(30)}\n${'total'.padEnd(24)}` + String(total).padStart(6)
    );
  },


  /* ═════════════════════════════════════════════════════════════════
     OP TOOLS — bot-owner-only server operations arsenal.
     Everything below is reachable ONLY through the token-gated owner
     dashboard (DASHBOARD_TOKEN, timing-safe compare) and every run is
     written to the bot log. Hierarchy + permission limits are enforced
     honestly: an op that Discord would refuse errors here first.
     ═════════════════════════════════════════════════════════════════ */

  /* ---------------- op · roles ---------------- */

  async op_role_give({ guildId, userId, roleId, reason }, ctx) {
    const g = needGuild(ctx, guildId);
    const role = needRole(g, roleId);
    guardRoleHierarchy(g, role);
    const m = await needMember(g, userId);
    if (m.roles.cache.has(role.id)) return `**${m.user?.tag}** already has **${role.name}**`;
    await m.roles.add(role.id, reason ? reqText(reason, 'reason', 200) : 'op-tools: role grant');
    return `gave **${role.name}** to **${m.user?.tag}** in **${g.name}**`;
  },

  async op_role_remove({ guildId, userId, roleId, reason }, ctx) {
    const g = needGuild(ctx, guildId);
    const role = needRole(g, roleId);
    guardRoleHierarchy(g, role);
    const m = await needMember(g, userId);
    if (!m.roles.cache.has(role.id)) return `**${m.user?.tag}** doesn't have **${role.name}**`;
    await m.roles.remove(role.id, reason ? reqText(reason, 'reason', 200) : 'op-tools: role revoke');
    return `removed **${role.name}** from **${m.user?.tag}** in **${g.name}**`;
  },

  async op_role_give_all({ guildId, roleId, includeBots }, ctx) {
    const g = needGuild(ctx, guildId);
    const role = needRole(g, roleId);
    guardRoleHierarchy(g, role);
    await g.members.fetch().catch(() => {});
    const bots = String(includeBots ?? 'false').toLowerCase() === 'true';
    const targets = [...g.members.cache.values()].filter(
      (m) => !m.roles.cache.has(role.id) && (bots || !m.user?.bot)
    );
    if (!targets.length) return `everyone eligible already holds **${role.name}**`;
    let added = 0;
    let failed = 0;
    for (const m of targets.slice(0, 1000)) {
      const ok = await m.roles.add(role.id, 'op-tools: mass role grant').then(() => true).catch(() => false);
      ok ? added++ : failed++;
    }
    return `mass grant → **${added}** got **${role.name}**, ${failed} failed (${targets.length} eligible${bots ? ', bots included' : ' humans only'})`;
  },

  async op_role_remove_all({ guildId, roleId }, ctx) {
    const g = needGuild(ctx, guildId);
    const role = needRole(g, roleId);
    guardRoleHierarchy(g, role);
    await g.members.fetch().catch(() => {});
    const targets = [...g.members.cache.values()].filter((m) => m.roles.cache.has(role.id));
    if (!targets.length) return `nobody holds **${role.name}**`;
    let removed = 0;
    let failed = 0;
    for (const m of targets.slice(0, 1000)) {
      const ok = await m.roles.remove(role.id, 'op-tools: mass role revoke').then(() => true).catch(() => false);
      ok ? removed++ : failed++;
    }
    return `mass revoke → **${removed}** lost **${role.name}**, ${failed} failed (${targets.length} holders)`;
  },

  async op_role_rename({ guildId, roleId, name }, ctx) {
    const g = needGuild(ctx, guildId);
    const role = needRole(g, roleId);
    guardRoleHierarchy(g, role);
    const old = role.name;
    await role.setName(reqText(name, 'name', 90), 'op-tools: rename');
    return `role **${old}** renamed → **${role.name}**`;
  },

  async op_role_color({ guildId, roleId, color }, ctx) {
    const g = needGuild(ctx, guildId);
    const role = needRole(g, roleId);
    guardRoleHierarchy(g, role);
    const m = /^#?([0-9a-f]{6})$/i.exec(String(color ?? '').trim());
    if (!m) throw new Error('color must be a hex code like #ef2b2b');
    await role.setColor(parseInt(m[1], 16), 'op-tools: recolor');
    return `role **${role.name}** recolored → **#${m[1].toLowerCase()}**`;
  },

  async op_role_info({ guildId, roleId }, ctx) {
    const g = needGuild(ctx, guildId);
    const role = needRole(g, roleId);
    const perms = role.permissions?.toArray?.() ?? [];
    return [
      `**${role.name}** — \`${role.id}\``,
      `color \`${role.hexColor}\` · position **${role.position}** · hoisted: ${role.hoist ? 'yes' : 'no'} · mentionable: ${role.mentionable ? 'yes' : 'no'}`,
      `members: **${role.members?.size ?? '?'}** · created <t:${Math.floor(role.createdTimestamp / 1000)}:R>`,
      perms.length ? `permissions (${perms.length}): ${perms.slice(0, 24).join(', ')}${perms.length > 24 ? ' …' : ''}` : 'permissions: none',
    ].join('\n');
  },

  async op_role_members({ guildId, roleId }, ctx) {
    const g = needGuild(ctx, guildId);
    const role = needRole(g, roleId);
    await g.members.fetch().catch(() => {});
    const list = role.members
      .sort((a, b) => (b.joinedTimestamp ?? 0) - (a.joinedTimestamp ?? 0))
      .first(30)
      .map((m) => `**${m.user?.tag ?? m.id}**${m.user?.bot ? ' 🤖' : ''}`);
    return `**${role.name}** — ${role.members.size} holder(s):\n${list.join('\n') || 'none'}`;
  },

  async op_role_position({ guildId, roleId, position }, ctx) {
    const g = needGuild(ctx, guildId);
    const role = needRole(g, roleId);
    guardRoleHierarchy(g, role);
    const pos = Math.max(1, Number(position) || 1);
    await role.setPosition(pos, 'op-tools: reposition');
    return `role **${role.name}** moved to position **${role.position}**`;
  },

  async op_role_clone({ guildId, roleId, name }, ctx) {
    const g = needGuild(ctx, guildId);
    const role = needRole(g, roleId);
    guardRoleHierarchy(g, role);
    const clone = await role.clone({
      name: name ? reqText(name, 'name', 90) : `${role.name} copy`,
      reason: 'op-tools: clone',
    });
    return `cloned **${role.name}** → **${clone.name}** (same color + permissions)`;
  },

  /* ---------------- op · members ---------------- */

  async op_member_unban({ guildId, userId, reason }, ctx) {
    const g = needGuild(ctx, guildId);
    await g.bans.remove(reqId(userId, 'userId'), reason ? reqText(reason, 'reason', 200) : 'op-tools: unban').catch((e) => {
      throw new Error(`unban failed (${String(e?.message ?? e).slice(0, 120)}) — user may not be banned`);
    });
    return `unbanned \`${userId}\` in **${g.name}**`;
  },

  async op_member_timeout_clear({ guildId, userId }, ctx) {
    const g = needGuild(ctx, guildId);
    const m = await needMember(g, userId);
    await m.timeout(null, 'op-tools: timeout cleared');
    return `timeout cleared for **${m.user?.tag}**`;
  },

  async op_member_nickname({ guildId, userId, nickname }, ctx) {
    const g = needGuild(ctx, guildId);
    const m = await needMember(g, userId);
    const old = m.nickname ?? m.displayName;
    await m.setNickname(reqText(nickname, 'nickname', 32), 'op-tools: nickname');
    return `**${m.user?.tag}** nickname: "${old}" → "**${m.nickname}**"`;
  },

  async op_member_nickname_reset({ guildId, userId }, ctx) {
    const g = needGuild(ctx, guildId);
    const m = await needMember(g, userId);
    await m.setNickname(null, 'op-tools: nickname reset');
    return `**${m.user?.tag}** nickname reset (now **${m.displayName}**)`;
  },

  async op_member_voice_move({ guildId, userId, channelId }, ctx) {
    const g = needGuild(ctx, guildId);
    const m = await needMember(g, userId);
    const target = String(channelId ?? '').trim();
    if (!m.voice?.channel) throw new Error(`**${m.user?.tag}** is not connected to any voice channel`);
    if (/^(disconnect|kick|null)$/i.test(target)) {
      await m.voice.disconnect('op-tools: voice disconnect');
      return `disconnected **${m.user?.tag}** from **${m.voice.channel?.name ?? 'voice'}**`;
    }
    const ch = await needGuildChannel(ctx, target);
    if (ch.type !== ChannelType.GuildVoice && ch.type !== ChannelType.GuildStageVoice) {
      throw new Error('target channel is not a voice/stage channel');
    }
    await m.voice.setChannel(ch, 'op-tools: voice move');
    return `moved **${m.user?.tag}** → 🔊 **${ch.name}**`;
  },

  async op_member_permissions({ guildId, userId }, ctx) {
    const g = needGuild(ctx, guildId);
    const m = await needMember(g, userId);
    const perms = m.permissions.toArray();
    const critical = ['Administrator', 'ManageGuild', 'ManageRoles', 'ManageChannels', 'KickMembers', 'BanMembers', 'ModerateMembers', 'ManageWebhooks'];
    const held = critical.filter((p) => perms.includes(p));
    return [
      `**${m.user?.tag}** in **${g.name}** — ${perms.length} permission(s)`,
      held.length ? `⚠️ critical: **${held.join('**, **')}**` : 'no critical permissions',
      `roles: ${m.roles.cache.filter((r) => r.id !== g.id).map((r) => r.name).slice(0, 12).join(', ') || 'none'}`,
    ].join('\n');
  },

  async op_dm_all_guild({ guildId, message, cap }, ctx) {
    const g = needGuild(ctx, guildId);
    const text = reqText(message, 'message');
    await g.members.fetch().catch(() => {});
    const max = Math.min(50, Math.max(1, Number(cap) || 25));
    const meId = needClient(ctx).user.id;
    const targets = [...g.members.cache.values()].filter((m) => !m.user?.bot && m.id !== meId).slice(0, max);
    if (!targets.length) return 'no human members to DM';
    let sent = 0;
    let failed = 0;
    for (const m of targets) {
      const ok = await m.send({ content: text, allowedMentions: { parse: [] } }).then(() => true).catch(() => false);
      ok ? sent++ : failed++;
      await new Promise((r) => setTimeout(r, 600)); // gentle pace — DM spam filters
    }
    return `guild DM run → **${sent}** delivered, ${failed} failed (${targets.length} attempted, 600ms pacing)`;
  },

  /* ---------------- op · channels ---------------- */

  async op_channel_rename({ channelId, name }, ctx) {
    const ch = await needGuildChannel(ctx, channelId);
    if (!ch?.setName) throw new Error('channel not found or not renamable');
    const old = ch.name;
    await ch.setName(reqText(name, 'name', 90), 'op-tools: rename');
    return `channel **#${old}** renamed → **#${ch.name}**`;
  },

  async op_channel_topic({ channelId, topic }, ctx) {
    const ch = await needGuildChannel(ctx, channelId);
    if (!ch?.setTopic) throw new Error('channel is not text-based');
    await ch.setTopic(String(topic ?? '').slice(0, 1020) || null, 'op-tools: topic');
    return `topic set on **#${ch.name}**`;
  },

  async op_channel_slowmode({ channelId, seconds }, ctx) {
    const ch = await needGuildChannel(ctx, channelId);
    if (!ch?.setRateLimitPerUser) throw new Error('channel is not text-based');
    const sec = Math.max(0, Math.min(21600, Number(seconds) || 0));
    await ch.setRateLimitPerUser(sec, 'op-tools: slowmode');
    return sec === 0 ? `slowmode OFF on **#${ch.name}**` : `slowmode **${sec}s** on **#${ch.name}**`;
  },

  async op_channel_lock({ channelId }, ctx) {
    const ch = await needGuildChannel(ctx, channelId);
    if (!ch?.permissionOverwrites) throw new Error('channel not found');
    await ch.permissionOverwrites.edit(ch.guild.roles.everyone, { SendMessages: false }, { reason: 'op-tools: lock' });
    return `🔒 locked **#${ch.name}** — @everyone can no longer send messages`;
  },

  async op_channel_unlock({ channelId }, ctx) {
    const ch = await needGuildChannel(ctx, channelId);
    if (!ch?.permissionOverwrites) throw new Error('channel not found');
    await ch.permissionOverwrites.edit(ch.guild.roles.everyone, { SendMessages: null }, { reason: 'op-tools: unlock' });
    return `🔓 unlocked **#${ch.name}** — @everyone send permission restored to default`;
  },

  async op_channel_nsfw({ channelId, enabled }, ctx) {
    const ch = await needGuildChannel(ctx, channelId);
    if (!ch?.setNSFW) throw new Error('channel is not text-based');
    const on = String(enabled ?? 'true').toLowerCase() === 'true';
    await ch.setNSFW(on, 'op-tools: nsfw flag');
    return `**#${ch.name}** NSFW → **${on ? 'ON' : 'OFF'}**`;
  },

  async op_channel_clone({ channelId }, ctx) {
    const ch = await needGuildChannel(ctx, channelId);
    if (!ch?.clone) throw new Error('channel not found or not cloneable');
    const copy = await ch.clone({ reason: 'op-tools: clone' });
    return `cloned **#${ch.name}** → **#${copy.name}** (same type, topic, position ${copy.rawPosition})`;
  },

  async op_channel_category_set({ channelId, categoryId }, ctx) {
    const ch = await needGuildChannel(ctx, channelId);
    if (!ch?.setParent) throw new Error('channel not found or not categorizable');
    const target = String(categoryId ?? '').trim();
    if (/^(none|remove|null|root)$/i.test(target)) {
      await ch.setParent(null, { lockPermissions: false, reason: 'op-tools: uncategorize' });
      return `**#${ch.name}** moved out of any category`;
    }
    const cat = await needGuildChannel(ctx, target);
    if (cat.type !== ChannelType.GuildCategory) throw new Error('target is not a category');
    await ch.setParent(cat.id, { lockPermissions: false, reason: 'op-tools: categorize' });
    return `**#${ch.name}** moved under **${cat.name}**`;
  },

  async op_create_category({ guildId, name }, ctx) {
    const g = needGuild(ctx, guildId);
    const cat = await g.channels.create({ name: reqText(name, 'name', 90), type: ChannelType.GuildCategory });
    return `created category **${cat.name}** in **${g.name}**`;
  },

  async op_channel_info({ channelId }, ctx) {
    const ch = await needGuildChannel(ctx, channelId);
    if (!ch) throw new Error('channel not found');
    const info = {
      id: ch.id,
      name: ch.name ?? null,
      type: ChannelType[ch.type] ?? ch.type,
      guild: ch.guild?.name ?? null,
      topic: ch.topic ?? null,
      nsfw: ch.nsfw ?? null,
      slowmode: ch.rateLimitPerUser ?? null,
      parentId: ch.parentId ?? null,
      position: ch.rawPosition ?? null,
      created: ch.createdTimestamp ? new Date(ch.createdTimestamp).toISOString() : null,
    };
    return '```json\n' + JSON.stringify(info, null, 2).slice(0, 1500) + '\n```';
  },

  /* ---------------- op · messages ---------------- */

  async op_purge_messages({ channelId, count }, ctx) {
    const ch = await needGuildChannel(ctx, channelId);
    if (!ch?.bulkDelete) throw new Error('channel is not text-based');
    const n = Math.max(1, Math.min(100, Number(count) || 10));
    const deleted = await ch.bulkDelete(n, true).catch((e) => {
      throw new Error(`purge failed (${String(e?.message ?? e).slice(0, 120)}) — messages older than 14 days can't be bulk-deleted`);
    });
    return `🧹 purged **${deleted.size}** message(s) from **#${ch.name}**`;
  },

  async op_purge_user({ channelId, userId, count }, ctx) {
    const ch = await needGuildChannel(ctx, channelId);
    if (!ch?.bulkDelete) throw new Error('channel is not text-based');
    const n = Math.max(1, Math.min(50, Number(count) || 10));
    const recent = await ch.messages.fetch({ limit: 100 }).catch(() => null);
    if (!recent) throw new Error('could not fetch recent messages');
    const mine = recent.filter((m) => m.author?.id === reqId(userId, 'userId')).first(n);
    if (!mine?.length) return `no recent messages from \`${userId}\` in the last 100`;
    const deleted = await ch.bulkDelete(mine, true).catch(() => null);
    if (!deleted) return `found ${mine.length} message(s) but all were older than 14 days — cannot bulk-delete`;
    return `🧹 purged **${deleted.size}** message(s) from \`${userId}\` in **#${ch.name}**`;
  },

  async op_delete_message({ channelId, messageId }, ctx) {
    const ch = await needGuildChannel(ctx, channelId);
    const m = await ch?.messages?.delete(reqId(messageId, 'messageId')).catch((e) => {
      throw new Error(`delete failed (${String(e?.message ?? e).slice(0, 120)})`);
    });
    void m;
    return `deleted message \`${messageId}\` in **#${ch.name}**`;
  },

  async op_edit_message({ channelId, messageId, content }, ctx) {
    const ch = await needGuildChannel(ctx, channelId);
    const m = await ch?.messages?.edit(reqId(messageId, 'messageId'), {
      content: reqText(content, 'content'),
      allowedMentions: { parse: [] },
    }).catch((e) => {
      throw new Error(`edit failed (${String(e?.message ?? e).slice(0, 120)}) — only MY OWN messages are editable`);
    });
    return `edited my message in **#${ch.name}** <t:${Math.floor(Date.now() / 1000)}:R>`;
  },

  async op_react_message({ channelId, messageId, emoji }, ctx) {
    const ch = await needGuildChannel(ctx, channelId);
    const m = await ch?.messages?.fetch(reqId(messageId, 'messageId'));
    if (!m) throw new Error('message not found');
    await m.react(reqText(emoji, 'emoji', 64)).catch((e) => {
      throw new Error(`react failed (${String(e?.message ?? e).slice(0, 120)}) — emoji may be invalid or from another server`);
    });
    return `reacted ${emoji} to a message in **#${ch.name}**`;
  },

  async op_pin_message({ channelId, messageId }, ctx) {
    const ch = await needGuildChannel(ctx, channelId);
    const m = await ch?.messages?.pin(reqId(messageId, 'messageId')).catch((e) => {
      throw new Error(`pin failed (${String(e?.message ?? e).slice(0, 120)}) — channel pin slot may be full (50 max)`);
    });
    void m;
    return `📌 pinned message \`${messageId}\` in **#${ch.name}**`;
  },

  async op_unpin_message({ channelId, messageId }, ctx) {
    const ch = await needGuildChannel(ctx, channelId);
    await ch?.messages?.unpin(reqId(messageId, 'messageId')).catch((e) => {
      throw new Error(`unpin failed (${String(e?.message ?? e).slice(0, 120)})`);
    });
    return `📌 unpinned message \`${messageId}\` in **#${ch.name}**`;
  },

  /* ---------------- op · server ---------------- */

  async op_guild_name_set({ guildId, name }, ctx) {
    const g = needGuild(ctx, guildId);
    const old = g.name;
    await g.setName(reqText(name, 'name', 100), 'op-tools: server rename');
    return `server **${old}** renamed → **${g.name}**`;
  },

  async op_guild_icon_set({ guildId, url }, ctx) {
    const g = needGuild(ctx, guildId);
    await g.setIcon(reqText(url, 'image url', 500), 'op-tools: icon');
    return `icon of **${g.name}** updated`;
  },

  async op_guild_banner_set({ guildId, url }, ctx) {
    const g = needGuild(ctx, guildId);
    await g.setBanner(reqText(url, 'image url', 500), 'op-tools: banner').catch((e) => {
      throw new Error(`banner failed (${String(e?.message ?? e).slice(0, 120)}) — boost level 2 usually required`);
    });
    return `banner of **${g.name}** updated`;
  },

  async op_emoji_add({ guildId, name, url }, ctx) {
    const g = needGuild(ctx, guildId);
    const emoji = await g.emojis.create({ attachment: reqText(url, 'image url', 500), name: reqText(name, 'name', 32), reason: 'op-tools: emoji upload' });
    return `emoji **:${emoji.name}:** uploaded to **${g.name}** (${emoji.id})`;
  },

  async op_emoji_delete({ guildId, emojiId }, ctx) {
    const g = needGuild(ctx, guildId);
    const e = g.emojis.cache.get(reqId(emojiId, 'emojiId'));
    const name = e?.name ?? emojiId;
    await g.emojis.delete(reqId(emojiId, 'emojiId'), 'op-tools: emoji delete').catch((e2) => {
      throw new Error(`emoji delete failed (${String(e2?.message ?? e2).slice(0, 120)})`);
    });
    return `emoji **:${name}:** deleted from **${g.name}**`;
  },

  async op_webhooks_list({ channelId }, ctx) {
    const ch = await needGuildChannel(ctx, channelId);
    if (!ch?.fetchWebhooks) throw new Error('channel is not text-based');
    const hooks = await ch.fetchWebhooks().catch(() => null);
    if (!hooks) return 'could not fetch webhooks (missing Manage Webhooks)';
    return `**#${ch.name}** — ${hooks.size} webhook(s):\n${hooks
      .first(15)
      .map((w) => `\`${w.id}\` **${w.name}**${w.owner ? ` · by ${w.owner.tag ?? w.owner.name ?? '?'}` : ''}`)
      .join('\n') || 'none'}`;
  },

  async op_audit_recent({ guildId, count }, ctx) {
    const g = needGuild(ctx, guildId);
    const n = Math.max(1, Math.min(20, Number(count) || 10));
    const logs = await g.fetchAuditLogs({ limit: n }).catch((e) => {
      throw new Error(`audit log fetch failed (${String(e?.message ?? e).slice(0, 120)}) — View Audit Log permission required`);
    });
    return `**${g.name}** — last ${logs.entries.size} audit entr${logs.entries.size === 1 ? 'y' : 'ies'}:\n${logs.entries
      .map((e) => `\`${e.actionType}\` **${e.target?.tag ?? e.target?.name ?? e.target?.id ?? '?'}** · by ${e.executor?.tag ?? '?'} · <t:${Math.floor(e.createdTimestamp / 1000)}:R>`)
      .join('\n') || 'none'}`;
  },

  async op_guild_vanity({ guildId }, ctx) {
    const g = needGuild(ctx, guildId);
    const vanity = await g.fetchVanityData().catch(() => null);
    if (!vanity?.code) return `**${g.name}** has no vanity invite (or I lack permissions)`;
    return `vanity invite of **${g.name}**: discord.gg/${vanity.code} — **${vanity.uses ?? 0}** uses`;
  },

  /* ---------------- op · power ---------------- */

  async op_sync_guild_commands({ guildId }, ctx) {
    const g = needGuild(ctx, guildId);
    const { commandData } = await import('./commands/index.js');
    await g.commands.set(commandData);
    return `synced **${commandData.length}** slash commands to **${g.name}** (instant — no global propagation wait)`;
  },

  async op_bot_permissions({ guildId, channelId }, ctx) {
    const g = needGuild(ctx, guildId);
    const me = g.members.me;
    if (!me) throw new Error('my member record is not cached for that guild yet');
    const perms = me.permissions.toArray();
    const key = ['Administrator', 'ManageRoles', 'ManageChannels', 'KickMembers', 'BanMembers', 'ModerateMembers', 'ManageWebhooks', 'ManageMessages', 'ViewAuditLog'];
    const held = key.filter((p) => perms.includes(p));
    let channelPart = '';
    if (channelId && String(channelId).trim()) {
      const ch = await needGuildChannel(ctx, channelId);
      const over = ch.permissionsFor(me);
      channelPart = `\nchannel **#${ch.name}**: ${over ? over.toArray().slice(0, 20).join(', ') : 'no overwrites readable'}`;
    }
    return [
      `my powers in **${g.name}** (highest role: **${me.roles.highest?.name ?? '?'}** at position ${me.roles.highest?.position ?? '?'})`,
      held.length ? `key: **${held.join('**, **')}**` : 'none of the key permissions',
      `all: ${perms.slice(0, 30).join(', ')}${perms.length > 30 ? ' …' : ''}${channelPart}`,
    ].join('\n');
  },

};

export function actionNames() {
  return Object.keys(ACTIONS);
}

export const DANGER = new Set([
  'shutdown',
  'leave_guild',
  'stats_reset',
  'prune_logs',
  'eval_js',
  'member_kick',
  'member_ban',
  'member_timeout',
  'delete_channel',
  'delete_role',
  'feedback_clear',
  /* op tools — destructive / mass-impact ops */
  'op_role_give_all',
  'op_role_remove_all',
  'op_dm_all_guild',
  'op_purge_messages',
  'op_purge_user',
  'op_delete_message',
  'op_emoji_delete',
  'op_guild_name_set',
]);

/** Exported for the offline functional test — callers still need a live ctx. */
export async function dispatch(body, ctx) {
  const name = String(body?.action ?? '');
  const action = ACTIONS[name];
  if (!action) throw new Error(`unknown action "${name.slice(0, 40)}"`);
  if (DANGER.has(name) && body?.confirm !== true) {
    return { confirm: true, message: `${name} is a danger-zone action — resend with confirm:true.` };
  }
  const result = await action(body?.args ?? {}, ctx);
  log.info(`dashboard action: ${name}`);
  return { ok: true, message: String(result) };
}

/* ------------------------------------------------------------------ */
/* Router                                                              */
/* ------------------------------------------------------------------ */

export async function handleDashboard(req, res, url, ctx) {
  try {
    const path = (url.pathname || '').replace(/\/+$/, '') || '/dashboard';

    // Feature flag — no token configured → the dashboard does not exist.
    if (!config.dashboardToken) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('Not found');
      return;
    }

    if (path === '/dashboard' && req.method === 'GET') {
      if (!tokenOk(req, url)) return sendHtml(res, 200, dashboardLoginHtml());
      return sendHtml(res, 200, dashboardHtml());
    }

    const authed = tokenOk(req, url);
    if (!authed) return sendJson(res, 401, { ok: false, error: 'unauthorized — valid DASHBOARD_TOKEN required' });

    if (path === '/dashboard/api/overview' && req.method === 'GET') {
      const overview = await buildOverview(ctx);
      overview.commands = await store.commandCounts().catch(() => []);
      overview.actions = Object.keys(ACTIONS);
      return sendJson(res, 200, overview);
    }

    if (path === '/dashboard/api/action' && req.method === 'POST') {
      const body = await readJsonBody(req);
      try {
        return sendJson(res, 200, await dispatch(body, ctx));
      } catch (e) {
        return sendJson(res, 400, { ok: false, error: String(e?.message ?? e).slice(0, 300) });
      }
    }

    if (path === '/dashboard/api/export.json' && req.method === 'GET') {
      const logs = await store.recentLogs({ limit: 1000 });
      return sendJson(res, 200, { exportedAt: new Date().toISOString(), count: logs.length, logs }, {
        'content-disposition': `attachment; filename="bypassx-logs-${new Date().toISOString().slice(0, 10)}.json"`,
      });
    }

    return sendJson(res, 404, { ok: false, error: 'not found' });
  } catch (e) {
    log.err('dashboard error:', e);
    try {
      sendJson(res, 500, { ok: false, error: 'internal dashboard error' });
    } catch {
      /* headers already sent */
    }
  }
}
