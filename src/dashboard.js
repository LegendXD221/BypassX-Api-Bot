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
]);

async function dispatch(body, ctx) {
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
