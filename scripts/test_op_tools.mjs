/**
 * Functional test — v4 OP TOOLS dashboard actions driven through dispatch()
 * with a mocked Discord client (no network, no DB — store runs memory-only).
 * Verifies REAL behavior: hierarchy guards, danger confirm gates, mass-op
 * accounting, purge scoping, voice disconnect, emoji options-object, audit
 * formatting. Run: node scripts/test_op_tools.mjs
 */
import assert from 'node:assert/strict';
import { Collection, ChannelType } from 'discord.js';

delete process.env.DATABASE_URL;

let passed = 0;
const ok = (name) => { passed += 1; console.log(`✓ ${name}`); };

const dash = await import('../src/dashboard.js');
const { ACTIONS, DANGER, dispatch } = dash;

/* ---------- mocks ---------- */
function collection(items = []) {
  const c = new Collection();
  for (const it of items) c.set(it.id, it);
  return c;
}

function makeRole({ id, name, position = 5, color = '#000000' }) {
  return {
    id, name, position, hexColor: color,
    hoist: false, mentionable: false,
    createdTimestamp: Date.now() - 86400_000,
    members: collection(),
    permissions: { toArray: () => ['SendMessages', 'ViewChannel'] },
    setName: async (n) => { roleState[id].name = n; return roleState[id]; },
    setColor: async (c2) => { roleState[id].hexColor = `#${c2.toString(16).padStart(6, '0')}`; return roleState[id]; },
    setPosition: async (p) => { roleState[id].position = p; return roleState[id]; },
    clone: async (opts) => { const nr = makeRole({ id: '666' + String(id).replace(/\D/g, '').padStart(12, '1'), name: opts?.name ?? `${name} copy`, position }); roleState[nr.id] = nr; return nr; },
    delete: async () => { delete roleState[id]; return roleState[id]; },
  };
}
const roleState = {}; // id -> role object (mutable for setName/setColor assertions)

function makeMember({ id, tag, bot = false, roleIds = [], nickname = null, joinedAt = 1 }) {
  const m = { id };
  const liveCache = collection(roleIds.map((rid) => roleState[rid]));
  m.user = { tag, bot, id };
  m.displayName = nickname ?? tag.split('#')[0];
  m.nickname = nickname;
  m.joinedTimestamp = joinedAt;
  m.roles = {
    cache: liveCache,
    add: async (rid) => { m.roleIds.add(rid); if (roleState[rid]) liveCache.set(rid, roleState[rid]); },
    remove: async (rid) => { m.roleIds.delete(rid); liveCache.delete(rid); },
  };
  m.roleIds = new Set(roleIds);
  m.permissions = { toArray: () => (id === '333333333333333301' ? ['Administrator', 'ManageRoles'] : ['ViewChannel']) };
  m.timeout = async (ms, reason) => { m.timedOut = ms; m.timeoutReason = reason; };
  m.setNickname = async (n) => { m.nickname = n; m.displayName = n ?? tag.split('#')[0]; };
  m.kick = async () => { m.kicked = true; };
  m.send = async (payload) => { globalThis.dmLog.push({ to: id, content: payload?.content }); return {}; };
  m.voice = null;
  return m;
}

const guildId = '111111111111111111';
const roleMod = makeRole({ id: '222222222222222201', name: 'Mod', position: 10, color: '#ff0000' });
const roleHigh = makeRole({ id: '222222222222222202', name: 'AboveBot', position: 99 });
const roleEmpty = makeRole({ id: '222222222222222203', name: 'Empty', position: 3 });
roleState['222222222222222201'] = roleMod; roleState['222222222222222202'] = roleHigh; roleState['222222222222222203'] = roleEmpty;

const members = [
  makeMember({ id: '333333333333333301', tag: 'admin#0001', roleIds: ['222222222222222201'] }),
  makeMember({ id: '333333333333333302', tag: 'alice#0002', roleIds: [] }),
  makeMember({ id: '333333333333333303', tag: 'bob#0003', roleIds: ['222222222222222201'], nickname: 'bobby' }),
  makeMember({ id: '333333333333333304', tag: 'helper#0004', bot: true, roleIds: [] }),
];
for (const m of members) roleState['222222222222222201'].members.set(m.id, m);
const memberById = Object.fromEntries(members.map((m) => [m.id, m]));

const me = {
  id: '333333333333333300',
  roles: { highest: { position: 50, name: 'BotRole' } },
  permissions: { toArray: () => ['Administrator', 'ManageRoles', 'ManageChannels', 'KickMembers', 'BanMembers', 'ManageWebhooks', 'ViewAuditLog'] },
};

const textChannel = {
  id: '444444444444444401', name: 'general', type: ChannelType.GuildText,
  guild: null,
  permissionOverwrites: { edit: async (who, over, opts) => { globalThis.overwrites.push({ who: who?.id ?? who, over, reason: opts?.reason }); } },
  setTopic: async (t) => { textChannel.topic = t; },
  setRateLimitPerUser: async (s) => { textChannel.rateLimitPerUser = s; },
  setNSFW: async (b) => { textChannel.nsfw = b; },
  setParent: async (p) => { textChannel.parentId = p; },
  clone: async () => ({ id: '444444444444444403', name: 'general-clone' }),
  fetchWebhooks: async () => collection([{ id: 'w1', name: 'logger', owner: { tag: 'me#0000' } }]),
  bulkDelete: async (n, filterOld) => { globalThis.purges.push({ n, filterOld }); return collection(Array.from({ length: Math.min(n, 3) }, (_, i) => ({ id: `m${i}` }))); },
  messages: {
    fetch: async (opts) => {
      if (typeof opts === 'string') return msgById[opts];
      return collection(globalThis.recentMessages);
    },
    delete: async (mid) => { globalThis.deleted.push(mid); },
    edit: async (mid, payload) => { globalThis.edits.push({ mid, content: payload?.content }); return msgById[mid]; },
    pin: async (mid) => { globalThis.pins.push(mid); },
    unpin: async (mid) => { globalThis.unpins.push(mid); },
  },
  permissionsFor: () => ({ toArray: () => ['SendMessages', 'ViewChannel'] }),
};

const voiceChannel = { id: '444444444444444402', name: 'lounge', type: ChannelType.GuildVoice };

const guild = {
  id: guildId,
  name: 'Test Guild',
  memberCount: members.length,
  ownerId: '333333333333333301',
  members: {
    cache: collection(members),
    me,
    fetch: async (id) => (id ? memberById[id] : members),
    ban: async () => {},
  },
  roles: {
    cache: collection([roleMod, roleHigh, roleEmpty]),
    everyone: { id: '222222222222222299' },
  },
  channels: {
    cache: collection([textChannel, voiceChannel]),
    create: async (opts) => (opts?.type === ChannelType.GuildCategory
      ? { id: '444444444444444404', name: opts.name, type: ChannelType.GuildCategory }
      : { id: '444444444444444405', name: opts.name }),
  },
  bans: {
    remove: async (uid) => { globalThis.unbans.push(uid); },
    fetch: async () => collection(),
  },
  emojis: {
    cache: collection([{ id: '555555555555555501', name: 'old' }]),
    create: async (opts) => { globalThis.emojiCreates.push(opts); return { id: '555555555555555502', name: opts.name }; },
    delete: async (eid) => { globalThis.emojiDeletes.push(eid); },
  },
  invites: { fetch: async () => collection(), create: async () => ({ url: 'https://discord.gg/x' }) },
  fetchAuditLogs: async () => ({
    entries: collection([{
      actionType: 'Delete', target: { name: 'deleted-channel' }, executor: { tag: 'me#0000' }, createdTimestamp: Date.now(),
    }]),
  }),
  fetchVanityData: async () => ({ code: 'bypassx', uses: 12 }),
  commands: { set: async (data) => { globalThis.guildSync = (data ?? []).length; } },
  setName: async (n) => { guild.name = n; },
  setIcon: async () => {},
  setBanner: async () => {},
};
textChannel.guild = guild;

const client = {
  user: { id: '333333333333333300', tag: 'BypassX#0000' },
  guilds: { cache: collection([guild]) },
  channels: { fetch: async (id) => ({ '444444444444444401': textChannel, '444444444444444402': voiceChannel }[id] ?? null) },
};

const ctx = {
  getClient: () => client,
  reconnect: () => {},
  shutdown: () => {},
};

/* per-test scratch */
globalThis.dmLog = []; globalThis.overwrites = []; globalThis.purges = [];
globalThis.deleted = []; globalThis.edits = []; globalThis.pins = []; globalThis.unpins = [];
globalThis.emojiCreates = []; globalThis.emojiDeletes = []; globalThis.unbans = [];
globalThis.recentMessages = [
  { id: '777777777777777701', author: { id: '333333333333333302' }, content: 'hi', react: async () => ({}) },
  { id: '777777777777777702', author: { id: '333333333333333303' }, content: 'yo', react: async () => ({}) },
  { id: '777777777777777703', author: { id: '333333333333333302' }, content: 'brb', react: async () => ({}) },
];
const msgById = { '777777777777777701': globalThis.recentMessages[0], '777777777777777702': globalThis.recentMessages[1], '777777777777777703': globalThis.recentMessages[2] };
const run = (action, args = {}, confirm = true) => dispatch({ action, args, confirm }, ctx);

/* ---------- 1. registry shape ---------- */
const opIds = Object.keys(ACTIONS).filter((n) => n.startsWith('op_'));
assert.equal(opIds.length, 44, `44 op actions registered (got ${opIds.length})`);
ok('registry: 44 op_ actions present');

for (const d of ['op_role_give_all', 'op_role_remove_all', 'op_dm_all_guild', 'op_purge_messages', 'op_purge_user', 'op_delete_message', 'op_emoji_delete', 'op_guild_name_set']) {
  assert.ok(DANGER.has(d), `danger gate: ${d}`);
}
ok('registry: 8 new danger gates set');

/* ---------- 2. danger confirm gate ---------- */
const gated = await run('op_guild_name_set', { guildId, name: 'New Name' }, false);
assert.equal(gated.confirm, true, 'danger action asks for confirm first');
ok('danger: op_guild_name_set confirm-gated');

/* ---------- 3. role ops ---------- */
let r = await run('op_role_give', { guildId, userId: '333333333333333302', roleId: '222222222222222201' });
assert.match(r.message, /gave \*\*Mod\*\* to \*\*alice/);
assert.ok(memberById['333333333333333302'].roleIds.has('222222222222222201'));
ok('op_role_give grants + reports');

r = await run('op_role_give', { guildId, userId: '333333333333333302', roleId: '222222222222222201' });
assert.match(r.message, /already has/);
ok('op_role_give idempotent message');

await assert.rejects(() => run('op_role_give', { guildId, userId: '333333333333333302', roleId: '222222222222222202' }), /above my highest role/);
ok('op_role_give hierarchy guard refuses above-bot roles');

r = await run('op_role_remove', { guildId, userId: '333333333333333302', roleId: '222222222222222201' });
assert.match(r.message, /removed \*\*Mod\*\* from \*\*alice/);
ok('op_role_remove revokes');

r = await run('op_role_give_all', { guildId, roleId: '222222222222222203' });
assert.match(r.message, /mass grant → \*\*\d+\*\*/);
ok(`op_role_give_all mass accounting (${r.message})`);

r = await run('op_role_remove_all', { guildId, roleId: '222222222222222203' });
assert.match(r.message, /mass revoke → \*\*\d+\*\*/);
ok('op_role_remove_all mass accounting');

r = await run('op_role_rename', { guildId, roleId: '222222222222222203', name: 'Renamed' });
assert.match(r.message, /renamed → \*\*Renamed\*\*/);
assert.equal(roleState['222222222222222203'].name, 'Renamed');
ok('op_role_rename mutates + reports');

r = await run('op_role_color', { guildId, roleId: '222222222222222203', color: '#ef2b2b' });
assert.match(r.message, /#ef2b2b/);
ok('op_role_color hex parse');

await assert.rejects(() => run('op_role_color', { guildId, roleId: '222222222222222203', color: 'red' }), /hex code/);
ok('op_role_color rejects non-hex');

r = await run('op_role_info', { guildId, roleId: '222222222222222201' });
assert.match(r.message, /permissions \(\d+\)/);
ok('op_role_info renders permissions');

r = await run('op_role_members', { guildId, roleId: '222222222222222201' });
assert.match(r.message, /holder\(s\)/);
ok('op_role_members lists holders');

r = await run('op_role_position', { guildId, roleId: '222222222222222203', position: 7 });
assert.match(r.message, /position \*\*\d+\*\*/);
ok('op_role_position moves');

r = await run('op_role_clone', { guildId, roleId: '222222222222222201', name: 'Mod Clone' });
assert.match(r.message, /cloned \*\*Mod\*\* → \*\*Mod Clone\*\*/);
ok('op_role_clone');

/* ---------- 4. member ops ---------- */
r = await run('op_member_nickname', { guildId, userId: '333333333333333303', nickname: 'Bobby G' });
assert.match(r.message, /Bobby G/);
assert.equal(memberById['333333333333333303'].nickname, 'Bobby G');
ok('op_member_nickname');

r = await run('op_member_nickname_reset', { guildId, userId: '333333333333333303' });
assert.equal(memberById['333333333333333303'].nickname, null);
ok('op_member_nickname_reset');

r = await run('op_member_timeout_clear', { guildId, userId: '333333333333333303' });
assert.equal(memberById['333333333333333303'].timedOut, null);
ok('op_member_timeout_clear');

r = await run('op_member_unban', { guildId, userId: '999999999999999' });
assert.deepEqual(globalThis.unbans, ['999999999999999']);
ok('op_member_unban');

await assert.rejects(() => run('op_member_voice_move', { guildId, userId: '333333333333333302', channelId: 'disconnect' }), /not connected to any voice/);
ok('op_member_voice_move without voice → honest error');
memberById['333333333333333302'].voice = { channel: { id: '444444444444444402', name: 'lounge' }, setChannel: async (c) => {}, disconnect: async () => { memberById['333333333333333302'].disconnected = true; } };
r = await run('op_member_voice_move', { guildId, userId: '333333333333333302', channelId: 'disconnect' });
assert.equal(memberById['333333333333333302'].disconnected, true);
ok('op_member_voice_move disconnect branch');

memberById['333333333333333303'].voice = { channel: { id: 'v0', name: 'old' }, setChannel: async (c) => { memberById['333333333333333303'].movedTo = c?.id ?? null; }, disconnect: async () => {} };
r = await run('op_member_voice_move', { guildId, userId: '333333333333333303', channelId: '444444444444444402' });
assert.equal(memberById['333333333333333303'].movedTo, '444444444444444402');
ok('op_member_voice_move move branch');

r = await run('op_member_permissions', { guildId, userId: '333333333333333301' });
assert.match(r.message, /Administrator/);
ok('op_member_permissions critical flags');

globalThis.dmLog = [];
r = await run('op_dm_all_guild', { guildId, message: 'hello everyone', cap: '10' });
assert.equal(globalThis.dmLog.length, 3, 'DMs go to humans only (3 humans, 1 bot excluded)');
assert.match(r.message, /\*\*3\*\* delivered/);
ok('op_dm_all_guild humans-only + accounting');

/* ---------- 5. channel ops ---------- */
r = await run('op_channel_lock', { channelId: '444444444444444401' });
assert.deepEqual(globalThis.overwrites.at(-1).over, { SendMessages: false });
ok('op_channel_lock denies SendMessages for @everyone');

r = await run('op_channel_unlock', { channelId: '444444444444444401' });
assert.deepEqual(globalThis.overwrites.at(-1).over, { SendMessages: null });
ok('op_channel_unlock restores default');

r = await run('op_channel_slowmode', { channelId: '444444444444444401', seconds: '15' });
assert.equal(textChannel.rateLimitPerUser, 15);
ok('op_channel_slowmode');

r = await run('op_channel_topic', { channelId: '444444444444444401', topic: 'welcome' });
assert.equal(textChannel.topic, 'welcome');
ok('op_channel_topic');

r = await run('op_channel_nsfw', { channelId: '444444444444444401', enabled: 'true' });
assert.equal(textChannel.nsfw, true);
ok('op_channel_nsfw');

r = await run('op_channel_category_set', { channelId: '444444444444444401', categoryId: 'none' });
assert.equal(textChannel.parentId, null);
ok('op_channel_category_set root branch');

r = await run('op_channel_clone', { channelId: '444444444444444401' });
assert.match(r.message, /cloned \*\*#general\*\* → \*\*#general-clone\*\*/);
ok('op_channel_clone');

r = await run('op_create_category', { guildId, name: 'Ops' });
assert.match(r.message, /created category \*\*Ops\*\*/);
ok('op_create_category');

r = await run('op_channel_info', { channelId: '444444444444444401' });
assert.match(r.message, /"name": "general"/);
ok('op_channel_info JSON');

r = await run('op_webhooks_list', { channelId: '444444444444444401' });
assert.match(r.message, /1 webhook\(s\)/);
ok('op_webhooks_list');

/* ---------- 6. message ops ---------- */
r = await run('op_purge_messages', { channelId: '444444444444444401', count: '25' });
assert.deepEqual(globalThis.purges.at(-1), { n: 25, filterOld: true });
assert.match(r.message, /purged \*\*3\*\*/);
ok('op_purge_messages bulkDelete(25, true)');

globalThis.purges = [];
r = await run('op_purge_user', { channelId: '444444444444444401', userId: '333333333333333302', count: '5' });
const purgeBatch = globalThis.purges.at(-1).n;
assert.equal(Array.isArray(purgeBatch) ? purgeBatch.length : purgeBatch, 2, 'only alice messages in the purge batch');
ok('op_purge_user scopes to the author');

r = await run('op_delete_message', { channelId: '444444444444444401', messageId: '777777777777777701' });
assert.deepEqual(globalThis.deleted, ['777777777777777701']);
ok('op_delete_message');

r = await run('op_edit_message', { channelId: '444444444444444401', messageId: '777777777777777701', content: 'edited' });
assert.deepEqual(globalThis.edits.at(-1), { mid: '777777777777777701', content: 'edited' });
ok('op_edit_message');

r = await run('op_react_message', { channelId: '444444444444444401', messageId: '777777777777777701', emoji: '🔥' });
ok('op_react_message');

r = await run('op_pin_message', { channelId: '444444444444444401', messageId: '777777777777777701' });
assert.deepEqual(globalThis.pins, ['777777777777777701']);
ok('op_pin_message');

r = await run('op_unpin_message', { channelId: '444444444444444401', messageId: '777777777777777701' });
assert.deepEqual(globalThis.unpins, ['777777777777777701']);
ok('op_unpin_message');

/* ---------- 7. server ops ---------- */
r = await run('op_guild_name_set', { guildId, name: 'Renamed Guild' }, true);
assert.equal(guild.name, 'Renamed Guild');
ok('op_guild_name_set (confirmed) renames');

r = await run('op_guild_icon_set', { guildId, url: 'https://example.com/i.png' });
ok('op_guild_icon_set');

r = await run('op_emoji_add', { guildId, name: 'bolt', url: 'https://example.com/e.png' });
assert.deepEqual(globalThis.emojiCreates.at(-1), { attachment: 'https://example.com/e.png', name: 'bolt', reason: 'op-tools: emoji upload' });
ok('op_emoji_add options-object create');

r = await run('op_emoji_delete', { guildId, emojiId: '555555555555555501' });
assert.deepEqual(globalThis.emojiDeletes, ['555555555555555501']);
ok('op_emoji_delete');

r = await run('op_audit_recent', { guildId, count: '5' });
assert.match(r.message, /last 1 audit entr/);
ok('op_audit_recent');

r = await run('op_guild_vanity', { guildId });
assert.match(r.message, /discord\.gg\/bypassx/);
ok('op_guild_vanity');

/* ---------- 8. power ops ---------- */
r = await run('op_sync_guild_commands', { guildId });
assert.equal(typeof globalThis.guildSync, 'number');
ok('op_sync_guild_commands (guild commands.set called)');

r = await run('op_bot_permissions', { guildId, channelId: '444444444444444401' });
assert.match(r.message, /highest role: \*\*BotRole\*\*/);
assert.match(r.message, /Administrator/);
ok('op_bot_permissions');

/* ---------- 9. honest failures ---------- */
await assert.rejects(() => run('op_role_give', { guildId, userId: '333333333333333399', roleId: '222222222222222201' }), /member not found/);
ok('missing member → honest error');

await assert.rejects(() => run('op_role_give', { guildId, userId: '333333333333333302', roleId: '222222222222222298' }), /role not found/);
ok('missing role → honest error');

await assert.rejects(() => run('op_member_voice_move', { guildId, userId: '333333333333333304', channelId: 'disconnect' }), /not connected to any voice/);
ok('voice move without voice → honest error');

console.log(`\nOP TOOLS FUNCTIONAL PASS — ${passed} checks, all green.`);
