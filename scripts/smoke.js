/**
 * Offline smoke test — no Discord login, no API calls, no database required
 * (the store runs in memory-only mode when DATABASE_URL is unset).
 * Verifies utilities, token store, the Postgres store fallback, domain
 * matching and every Components V2 container the bot can emit.
 * Run: npm run smoke
 */
import assert from 'node:assert/strict';

// Force memory-only mode BEFORE any module reads the environment — the smoke
// test must never require (or wait on) a database, locally or in CI.
delete process.env.DATABASE_URL;

let passed = 0;
const fail = (msg) => {
  console.error(`✗ ${msg}`);
  process.exit(1);
};
const ok = (name) => {
  passed += 1;
  console.log(`✓ ${name}`);
};

/* ---------- config ---------- */
const { config, isOwner, inviteUrl } = await import('../src/config.js');
// Force memory-only mode for the store tests, even if a local .env provides a
// DATABASE_URL (dotenv re-adds it) — the smoke test never touches a database.
config.databaseUrl = '';
assert.equal(isOwner('1134757298733064203'), true, 'default owner id present');
assert.match(inviteUrl('123'), /^https:\/\/discord\.com\/oauth2\/authorize\?client_id=123/);
ok('config: owner id, invite url');

/* ---------- util ---------- */
const { extractUrls, isHttpUrl, truncate, formatRate, formatUptime, cooldowns } = await import('../src/util.js');
assert.deepEqual(
  extractUrls('see https://linkvertise.com/1/abc, then http://a.b/c. end'),
  ['https://linkvertise.com/1/abc', 'http://a.b/c'],
  'url extraction trims punctuation'
);
assert.equal(extractUrls('no links here').length, 0);
assert.equal(isHttpUrl('https://x.com/a'), true);
assert.equal(isHttpUrl('javascript:alert(1)'), false);
assert.equal(isHttpUrl('not a url'), false);
assert.equal(truncate('abcdefghij', 5).length <= 5, true);
assert.equal(formatRate(100), '100%');
assert.equal(formatRate(0.97), '97%');
assert.equal(formatRate(null), '—');
assert.equal(formatUptime(90061), '1d 1h 1m 1s');
assert.equal(cooldowns.hit('k', 1000), 0);
assert.ok(cooldowns.hit('k', 1000) >= 1, 'cooldown holds');
ok('util: urls, formats, cooldowns');

/* ---------- tokens ---------- */
const { issueToken, takeToken, tokenStats } = await import('../src/tokens.js');
const t1 = issueToken({ url: 'https://example.com' });
assert.deepEqual(takeToken(t1).url, 'https://example.com');
assert.equal(takeToken('nope'), null);
const t2 = issueToken({ url: 'x' }, 1);
await new Promise((r) => setTimeout(r, 10));
assert.equal(takeToken(t2), null, 'expired token rejected');
assert.ok(tokenStats() >= 1);
ok('tokens: issue / peek / expiry');

/* ---------- store (memory-only fallback, config.databaseUrl forced off) ---------- */
const { store, dbHealthy, initDb, shutdownDb } = await import('../src/db.js');
assert.equal(await initDb(), false, 'initDb without DATABASE_URL reports memory-only');
assert.equal(dbHealthy(), false);

store.autobypassEnable('g1', 'c1', 'u1');
store.autobypassEnable('g1', 'c2', 'u1');
store.autobypassEnable('g2', 'c3', 'u2');
assert.deepEqual(store.autobypassChannels('g1'), ['c1', 'c2']);
assert.deepEqual([...store.allAutobypassChannelIds()].sort(), ['c1', 'c2', 'c3']);
assert.equal(store.totalAutobypassChannels(), 3);
assert.equal(store.autobypassGuildCount(), 2);
store.autobypassDisable('g1', 'c1');
assert.deepEqual(store.autobypassChannels('g1'), ['c2']);
store.autobypassDisableAll('g1');
assert.deepEqual(store.autobypassChannels('g1'), []);

store.blacklistAdd('user', 'u9', 'spam', 'owner');
assert.equal(store.isBlacklisted('u9'), true);
assert.equal(store.isGuildBlacklisted('g9'), false);
store.blacklistAdd('guild', 'g9', 'raid', 'owner');
assert.equal(store.isGuildBlacklisted('g9'), true);
store.blacklistRemove('user', 'u9');
assert.equal(store.isBlacklisted('u9'), false);
assert.equal((await store.blacklistList()).length, 0, 'memory-only list is empty');

store.bump('bypasses');
assert.equal(store.counters.bypasses, 1);

store.setCooldown('bypass', 12);
assert.equal(store.cooldownSeconds('bypass', 4), 12);
store.setCooldown('bypass', 0);
assert.equal(store.cooldownSeconds('bypass', 4), 4);
store.setCooldown('*', 7);
assert.equal(store.cooldownSeconds('help', 2), 7, 'global override applies');

store.setConfig('maintenance', true);
assert.equal(await store.getConfig('maintenance', false), true);

assert.deepEqual(await store.publicStats(), null, 'stats null in memory-only mode');
assert.deepEqual(await store.recentLogs({ limit: 5 }), []);
store.logBypass({ url: 'https://x.test/a', success: true }); // must not throw
await shutdownDb();
ok('store: autobypass, blacklist, counters, cooldowns, config (memory fallback)');

/* ---------- api registry ---------- */
const { supported, matchService, cacheSet, cacheGet, cacheClear } = await import('../src/api.js');
supported.services = [
  { id: 'linkvertise', name: 'Linkvertise', domains: ['linkvertise.com'], successRate: 97 },
  { id: 'delta', name: 'Delta Key System', domains: ['platoboost.com'], successRate: 100 },
];
supported.byDomain = new Map([
  ['linkvertise.com', supported.services[0]],
  ['platoboost.com', supported.services[1]],
]);
assert.equal(matchService('https://linkvertise.com/1/x')?.id, 'linkvertise');
assert.equal(matchService('https://sub.linkvertise.com/1/x')?.id, 'linkvertise');
assert.equal(matchService('https://linkvertise.com.evil.io/x'), null, 'suffix spoof rejected');
assert.equal(matchService('https://unknown.example/x'), null);
cacheSet('u', { kind: 'destination', url: 'd' });
assert.equal(cacheGet('u').url, 'd');
assert.equal(cacheClear(), 1);
ok('api: domain matching + result cache');

/* ---------- bypass-core url validation ---------- */
const { normalizeBypassUrl } = await import('../src/commands/public/bypass-core.js');
assert.equal(normalizeBypassUrl('https://linkvertise.com/1/x'), 'https://linkvertise.com/1/x');
assert.equal(normalizeBypassUrl('<https://linkvertise.com/1/x>'), 'https://linkvertise.com/1/x', 'angle-bracketed links unwrapped');
assert.equal(normalizeBypassUrl('linkvertise.com/1/x'), 'https://linkvertise.com/1/x', 'scheme added');
assert.equal(normalizeBypassUrl('javascript:alert(1)'), null, 'dangerous scheme rejected');
assert.equal(normalizeBypassUrl('ftp://x.com'), null, 'non-http scheme rejected');
assert.equal(normalizeBypassUrl('https://user:pass@linkvertise.com/1/x'), null, 'embedded credentials rejected');
ok('bypass-core: URL normalization');

/* ---------- private / internal host blocking ---------- */
const { isBlockedHost } = await import('../src/util.js');
for (const host of [
  'localhost', 'foo.localhost', '127.0.0.1', '10.1.2.3', '192.168.1.1',
  '172.16.0.9', '172.31.255.1', '169.254.169.254', '0.0.0.0', '100.64.0.1',
  '224.0.0.1', 'printer.local', 'nas.internal', 'box.lan', 'intranet',
  '[::1]', '::1', 'fd00::1', 'fe80::1', '[::ffff:192.168.0.1]',
]) {
  assert.equal(isBlockedHost(host), true, `blocked host: ${host}`);
}
for (const host of ['linkvertise.com', 'sub.linkvertise.com', 'mega.nz', '8.8.8.8', '1.1.1.1']) {
  assert.equal(isBlockedHost(host), false, `public host allowed: ${host}`);
}
for (const raw of [
  'http://localhost/x', 'http://127.0.0.1/x', 'http://169.254.169.254/latest/meta-data',
  'http://192.168.1.1/admin', 'http://intranet/x', 'http://[::1]/x',
]) {
  assert.equal(normalizeBypassUrl(raw), null, `SSRF target rejected: ${raw}`);
}
ok('security: private/internal host blocking (SSRF)');

/* ---------- components v2 ---------- */
const djs = await import('discord.js');
assert.ok(djs.MessageFlags.IsComponentsV2, 'IsComponentsV2 flag exists');
const {
  card,
  resultContainer,
  resultButtons,
  oauthContainer,
  errorContainer,
  copyContainer,
  servicesContainer,
  broadcastContainer,
  V2,
} = await import('../src/components.js');
assert.equal(V2, djs.MessageFlags.IsComponentsV2);

const destResult = {
  kind: 'destination',
  url: 'https://mega.nz/file/abc123',
  serviceName: 'LootLabs',
  note: 'LootLabs released server-side (remote release).',
  elapsedMs: 4200,
  cached: false,
};
const rc1 = resultContainer({ sourceUrl: 'https://lootlabs.gg/l/abc', result: destResult });
const j1 = rc1.toJSON();
assert.equal(j1.type, 17, 'result container type');
const ids1 = JSON.stringify(j1);
assert.ok(ids1.includes('Mobile Copy') && ids1.includes('PC Copy') && ids1.includes('Open Result'));

const keyResult = { ...destResult, url: 'KEY-4F2A-9917', note: 'the destination is the KEY string' };
const btnsKey = resultButtons(keyResult.url).toJSON();
assert.equal(btnsKey.components.length, 2, 'non-https result: no Open button');
assert.ok(btnsKey.components.every((b) => (b.custom_id ?? '').length <= 100), 'custom ids ≤100 chars');

const btnsUrl = resultButtons('https://mega.nz/file/abc123').toJSON();
assert.equal(btnsUrl.components.length, 3, 'https result: 3 buttons');
assert.equal(btnsUrl.components[2].style, 5, 'Open Result is a link button');

// v2.2.0 regression: >512-char destination URLs must NOT produce a link button
// (Discord 50035 BASE_TYPE_MAX_LENGTH killed the whole auto-bypass message).
const longUrl = `https://dest.example/a?${'x'.repeat(600)}`;
assert.ok(longUrl.length > 512, 'long url fixture is actually long');
const btnsLong = resultButtons(longUrl).toJSON();
assert.equal(btnsLong.components.length, 2, '>512-char url: no Open button (50035 guard)');
const longCard = resultContainer({
  sourceUrl: 'https://lootlabs.gg/l/abc',
  result: { kind: 'destination', url: longUrl, serviceName: 'LootLabs', note: null, elapsedMs: 1, cached: false },
  auto: true,
});
const jl = JSON.stringify(longCard.toJSON());
assert.ok(jl.includes('512-char'), '>512 result card explains the hidden button');
const linkButtons = [];
for (const comp of longCard.toJSON().components ?? []) {
  for (const inner of comp.components ?? []) {
    for (const b of inner.components ?? []) if (b.style === 5) linkButtons.push(b);
  }
}
assert.equal(linkButtons.length, 0, 'no link-style button anywhere on a >512 card');

const oc = oauthContainer({
  siteName: 'Delta',
  action: { kind: 'oauth', provider: 'discord', authorizeUrl: 'https://discord.com/oauth2/authorize?x=1', ref: 'a1b2c3', expiresInMs: 600000 },
  note: 'Delta now needs a one-time Discord sign-in for this key.',
  sourceUrl: 'https://auth.platorelay.com/t/xyz',
  userId: '1134757298733064203',
});
const jo = oc.toJSON();
assert.ok(JSON.stringify(jo).includes('discord.com/oauth2/authorize'));
assert.ok(JSON.stringify(jo).includes('I signed in'));

const ec = errorContainer({ title: 'Bypass failed', description: 'pace enforced', retryUrl: 'https://x.com/1', retryUserId: 'u1' });
assert.ok(JSON.stringify(ec.toJSON()).includes('bxretry:'));
const ec2 = errorContainer({ title: 'x', description: 'y' });
assert.ok(!JSON.stringify(ec2.toJSON()).includes('bxretry:'));

assert.ok(copyContainer({ url: 'https://a.b/c', mode: 'm' }).toJSON().type === 17);
assert.ok(copyContainer({ url: 'https://a.b/c', mode: 'p' }).toJSON().type === 17);

const svc = servicesContainer({
  pageItems: supported.services,
  page: 0,
  totalPages: 5,
  query: '',
  count: 48,
  domainCount: 86,
  token: 'tok123',
});
const js = svc.toJSON();
assert.ok(JSON.stringify(js).includes('Page 1/5'));
assert.ok(JSON.stringify(js).includes('Previous') && JSON.stringify(js).includes('Next'));

assert.ok(card({ title: 'T', body: ['b'] }).toJSON().type === 17);
assert.ok(broadcastContainer({ message: 'hello', requesterTag: 'owner#1' }).toJSON().type === 17);
ok('components: all V2 containers + button rules');

/* ---------- command registry ---------- */
const { commandData } = await import('../src/commands/index.js');
assert.equal(commandData.length, 42, '42 top-level commands (v3 catalog: +tools, +text)');
for (const c of commandData) {
  assert.ok(c.name && c.name.length <= 32, `valid name: ${c.name}`);
  // chat-input commands carry a description (≤100 chars); context menus don't have one
  if (c.description !== undefined) assert.ok(c.description.length <= 100, `valid description: ${c.name}`);
  JSON.stringify(c);
}
const names = commandData.map((c) => c.name);
for (const expected of [
  'bypass',
  'Bypass Link',
  'services',
  'stats',
  'ping',
  'help',
  'invite',
  'support',
  'autobypass',
  'check',
  'feedback',
  'userinfo',
  'botinfo',
  'serverinfo',
  'me',
  'website',
  'enable-autobypass',
  'disable-autobypass',
  'owner',
  // v2.0 catalog
  'bx', 'utility', 'fun', 'server', 'info',
  // v3 catalog
  'tools', 'text',
  'leaderboard', 'history', 'serviceinfo', 'randomservice', 'docs',
  'changelog', 'privacy', 'reminder', 'poll', 'faq',
  'shortcuts', 'uptime', 'tip', 'commands',
]) {
  assert.ok(names.includes(expected), `command registered: ${expected}`);
}
const enableCmd = commandData.find((c) => c.name === 'enable-autobypass');
assert.equal(enableCmd.default_member_permissions, '8', 'enable-autobypass is admin-gated at Discord level');
assert.deepEqual(enableCmd.contexts, [0], 'enable-autobypass is GUILD-scoped (0 = Guild, never BotDM)');
const disableCmd = commandData.find((c) => c.name === 'disable-autobypass');
assert.equal(disableCmd.default_member_permissions, '8', 'disable-autobypass is admin-gated at Discord level');
assert.deepEqual(disableCmd.contexts, [0], 'disable-autobypass is GUILD-scoped');
const abCmd = commandData.find((c) => c.name === 'autobypass');
assert.deepEqual(abCmd.contexts, [0], 'autobypass status is GUILD-scoped');
const siCmd = commandData.find((c) => c.name === 'serverinfo');
assert.deepEqual(siCmd.contexts, [0], 'serverinfo is GUILD-scoped');
const bypassCmd = commandData.find((c) => c.name === 'bypass');
assert.ok(bypassCmd.options.some((o) => o.name === 'hidden'), 'bypass has the hidden option');
const contextCmd = commandData.find((c) => c.name === 'Bypass Link');
assert.equal(contextCmd.type, 3, 'Bypass Link is a message context command');
const ownerCmd = commandData.find((c) => c.name === 'owner');
assert.equal(ownerCmd.options.length, 22, 'owner group has 22 subcommands (17 legacy + sql/avatar/username/cmdstats/prune/config)');
const cooldownOpt = ownerCmd.options.find((o) => o.name === 'cooldown').options.find((o) => o.name === 'command');
assert.equal(cooldownOpt.autocomplete, true, 'owner cooldown command uses autocomplete');

// Unique names + subcommand count — the "100+ commands" contract.
assert.equal(new Set(names).size, names.length, 'no duplicate command names');
let invokables = 0;
for (const c of commandData) {
  invokables += 1;
  if (c.type === 1 && Array.isArray(c.options)) {
    invokables += c.options.filter((o) => o.type === 1).length;
  }
}
assert.ok(invokables >= 100, `invokable commands >= 100 (got ${invokables})`);
ok(`commands: ${commandData.length} top-level · ${invokables} invokable actions, owner group complete`);

/* ---------- no GitHub links anywhere in the bot surface ---------- */
const surface = JSON.stringify(commandData);
assert.ok(!/github\.com/i.test(surface), 'command payloads carry no GitHub links');
const keyResultForHygiene = { kind: 'destination', url: 'https://mega.nz/file/abc123', serviceName: 'LootLabs', note: null, elapsedMs: 1, cached: false };
for (const [label, container] of [
  ['result', resultContainer({ sourceUrl: 'https://lootlabs.gg/l/abc', result: keyResultForHygiene })],
  ['error', errorContainer({ title: 'x', description: 'y' })],
  ['copy', copyContainer({ url: 'https://a.b/c', mode: 'm' })],
  ['services', servicesContainer({ pageItems: [], page: 0, totalPages: 1, query: '', count: 0, domainCount: 0, token: 't' })],
  ['broadcast', broadcastContainer({ message: 'hi', requesterTag: 'o#1' })],
  ['oauth', oauthContainer({ siteName: 'Delta', action: { kind: 'oauth', provider: 'discord', authorizeUrl: 'https://discord.com/oauth2/authorize?x=1', ref: 'r', expiresInMs: 600000 }, note: 'n', sourceUrl: 'https://a.b/c', userId: '1' })],
]) {
  assert.ok(!/github\.com/i.test(JSON.stringify(container.toJSON())), `${label} card carries no GitHub links`);
}
ok('hygiene: zero GitHub links in every bot surface');

/* ---------- autobypass permission helpers ---------- */
const { canManageAutobypass } = await import('../src/commands/owner/enable-autobypass.js');
assert.equal(typeof canManageAutobypass, 'function');
ok('autobypass: permission helper exported');

/* ---------- v1.3.0: /status + /recent + time-ago ---------- */
const statusCmd = commandData.find((c) => c.name === 'status');
assert.ok(statusCmd, '/status is registered');
assert.match(statusCmd.description, /System status/i, '/status describes diagnostics');
const recentCmd = commandData.find((c) => c.name === 'recent');
assert.ok(recentCmd, '/recent is registered');
const { ago } = await import('../src/util.js');
assert.equal(ago(new Date(Date.now() - 30_000)), '30s ago');
assert.equal(ago(new Date(Date.now() - 5 * 60_000)), '5m ago');
assert.equal(ago(new Date(Date.now() - 3 * 3600_000)), '3h ago');
assert.equal(ago(new Date(Date.now() - 2 * 86400_000)), '2d ago');
assert.equal(ago('not-a-date'), 'unknown');
const { apiHealth } = await import('../src/watchdog.js');
assert.deepEqual(apiHealth(), { consecutiveFailures: 0, lastOkAt: 0, lastRunAt: 0, lastStatus: null, degraded: false }, 'watchdog state starts clean');
const buttonsModule = await import('../src/events/buttons.js');
assert.equal(typeof buttonsModule.handleButton, 'function', 'rerun/copy button router exports');
ok('v1.3.0: /status, /recent, ago(), watchdog state');

/* ---------- v1.4.0: "bypassing your link…" acknowledgement ---------- */
const { readFileSync } = await import('node:fs');
const url = (p) => new URL(p, import.meta.url);
const coreSrc = readFileSync(url('../src/commands/public/bypass-core.js'), 'utf8');
assert.match(coreSrc, /bypassing your link/, 'runBypass sends the ack after defer');
assert.match(coreSrc, /allowedMentions: \{ users: \[requester\] \}/, 'ack mention scoped to the requester');
assert.match(coreSrc, /content: '',/, 'final cards clear the ack text');
const autoSrc = readFileSync(url('../src/events/messageCreate.js'), 'utf8');
assert.match(autoSrc, /bypassing your link/, 'auto-bypass sends the ack');
assert.match(autoSrc, /ack\.delete\(\)/, 'auto-bypass removes the ack after the outcome');
ok('v1.4.0: bypassing-your-link ack on /bypass + auto-bypass');

/* ---------- v1.5.0: owner dashboard ---------- */
const dash = await import('../src/dashboard.js');
assert.equal(typeof dash.handleDashboard, 'function');
const EXPECTED_ACTIONS = [
  'dm_user', 'channel_send', 'broadcast_all', 'broadcast_guild',
  'guild_details', 'guild_channels', 'guild_invite', 'leave_guild', 'find_user',
  'set_maintenance', 'set_presence', 'clear_presence', 'set_avatar', 'set_username',
  'reconnect_gateway', 'shutdown',
  'blacklist_user', 'unblacklist_user', 'blacklist_guild', 'unblacklist_guild',
  'blacklist_list', 'set_cooldown', 'disable_command', 'enable_command', 'toggle_autobypass',
  'clear_cache', 'refresh_services', 'stats_reset', 'prune_logs', 'eval_js', 'test_api',
];
for (const a of EXPECTED_ACTIONS) assert.equal(typeof dash.ACTIONS[a], 'function', `action exists: ${a}`);
assert.ok(dash.actionNames().length >= 55, `dashboard exposes ${dash.actionNames().length} actions (>= 55, v2)`);

// v2.0 action registry additions
for (const a of [
  'send_embed', 'dm_guild_owner', 'fetch_message',
  'guild_roles', 'guild_emojis', 'guild_invites', 'guild_bans', 'guild_members', 'member_info',
  'member_kick', 'member_ban', 'member_timeout', 'create_channel', 'delete_channel',
  'create_role', 'delete_role', 'set_status', 'reload_commands', 'dump_env',
  'sql_query', 'bypass_url', 'feedback_list', 'feedback_clear', 'command_counts',
]) {
  assert.equal(typeof dash.ACTIONS[a], 'function', `v2 action exists: ${a}`);
}

// danger-zone set grew with the new destructive actions
for (const a of ['member_kick', 'member_ban', 'delete_channel', 'delete_role', 'feedback_clear']) {
  assert.ok(Array.isArray(dash.DANGER) ? dash.DANGER.includes(a) : dash.DANGER.has(a), `danger-zoned: ${a}`);
}

const page = await import('../src/dashboard-page.js');
const dashHtml = page.dashboardHtml();
assert.match(dashHtml, /Owner Console v3/, 'v3 dashboard title');
assert.match(dashHtml, /heroStrip/, 'v3 hero strip present');
assert.match(dashHtml, /Mission Control/, 'v3 hero heading');
assert.match(dashHtml, /Owner Console/, 'dashboard title');
assert.match(page.dashboardLoginHtml(), /DASHBOARD_TOKEN/);
// v2 UI: sidebar tabs + action palette + command usage table + console drawer
for (const marker of ['tab-overview', 'tab-guilds', 'tab-actions', 'tab-commands', 'tab-logs', 'tab-config', 'actFilter', 'id="commands"', 'id="console"']) {
  assert.ok(dashHtml.includes(marker), `v2 dashboard surface contains: ${marker}`);
}
// every registered action id must appear in the palette UI metadata
for (const a of dash.actionNames()) {
  assert.ok(dashHtml.includes(`'${a}'`) || dashHtml.includes(`"${a}"`), `palette lists action: ${a}`);
}
// the unprompted format-preview demo action stays removed (owner ask 2026-11-10)
assert.equal(dash.ACTIONS.preview_diff, undefined, 'preview_diff removed from the registry');
assert.ok(!dashHtml.includes("'preview_diff'"), 'palette no longer lists preview_diff');
// messaging actions are multi-line textareas so owner-typed formats (```diff```) work
for (const marker of ["TA = { message:1, json:1, text:1", "createElement(TA[key] ? 'textarea' : 'input')"]) {
  assert.ok(dashHtml.includes(marker), `multi-line format input support in palette: ${marker}`);
}

// Route/auth behaviour with mocked req/res.
const cfg = (await import('../src/config.js')).config;
function mockRes() {
  return {
    code: 0, body: '',
    writeHead(c) { this.code = c; },
    end(b) { this.body = b == null ? '' : String(b); },
  };
}
function mockReq(body) {
  const buf = [Buffer.from(body == null ? '' : body)];
  return {
    method: body == null ? 'GET' : 'POST',
    headers: {},
    async *[Symbol.asyncIterator]() { yield* buf; },
  };
}
const ctx = { getClient: () => null, restart() {}, shutdown() {} };
const u = (s) => new URL(`http://x${s}`);

cfg.dashboardToken = 'test-tok-123';
let r = mockRes();
await dash.handleDashboard(mockReq(), r, u('/dashboard'), ctx);
assert.equal(r.code, 200);
assert.match(r.body, /Owner Console/, 'no token → login page');

r = mockRes();
await dash.handleDashboard(mockReq(), r, u('/dashboard/api/overview?token=wrong'), ctx);
assert.equal(r.code, 401, 'wrong token → 401');

r = mockRes();
await dash.handleDashboard(mockReq(), r, u('/dashboard/api/overview?token=test-tok-123'), ctx);
assert.equal(r.code, 200, 'correct token → 200');
const ov = JSON.parse(r.body);
assert.ok(Array.isArray(ov.guilds.list) && typeof ov.bot.version === 'string', 'overview payload shaped');

r = mockRes();
await dash.handleDashboard(mockReq('{"action":"nope"}'), r, u('/dashboard/api/action?token=test-tok-123'), ctx);
assert.equal(r.code, 400, 'unknown action → 400');

r = mockRes();
await dash.handleDashboard(mockReq(''), r, u('/dashboard/api/action?token=test-tok-123'), ctx);
assert.equal(r.code, 400, 'action without body → 400');

cfg.dashboardToken = '';
r = mockRes();
await dash.handleDashboard(mockReq(), r, u('/dashboard'), ctx);
assert.equal(r.code, 404, 'token unset → whole dashboard 404s');

ok(`v2.0: dashboard online — ${dash.actionNames().length} owner actions, auth verified`);

/* ---------- v2.0: rich message formats (diff / ansi) ---------- */
const fmt = await import('../src/format.js');
const diffOkOut = fmt.diffOk('boostylink fixed');
assert.match(diffOkOut, /^```diff\n\+ boostylink fixed\n```$/, 'diffOk renders a green diff block');
const db = fmt.diffBlock({ add: ['ok1'], del: ['bad1'], warn: ['warn1'], info: ['hdr'] });
assert.match(db, /\+ ok1/, 'diff block + line');
assert.match(db, /- bad1/, 'diff block - line');
assert.match(db, /! warn1/, 'diff block ! line');
assert.match(db, /@@ hdr @@/, 'diff block @@ header');
assert.ok(!fmt.codeBlock('txt', 'has ``` inside').includes('``` inside'), 'codeBlock escapes inner fences');
const kvt = fmt.kvTable([['key1', 'v1'], ['longer-key', 'v2']], { title: 'T' });
assert.match(kvt, /key1\s+│ v1/, 'kvTable aligns pipes');
assert.match(kvt, /── T /, 'kvTable renders title rule');
assert.match(fmt.bar(50), /▰{5}▱{5} 50%/, 'bar renders half full');
const ansiPanel = fmt.ansiBlock([fmt.ansi.green('ok'), fmt.ansi.red('bad')]);
assert.ok(ansiPanel.includes('\u001b[0;32m') && ansiPanel.includes('\u001b[0;31m'), 'ansiBlock carries ANSI colors');
assert.equal(fmt.cut('abcdef', 4).length, 4, 'cut trims with ellipsis');
ok('v2.0: format engine — diff/ansi/kvTable/bar/codeBlock all verified');

/* ---------- v2.0: formats actually reach the cards ---------- */
const resultJson = JSON.stringify(resultContainer({ sourceUrl: 'https://boostylink.com/x', result: keyResultForHygiene }).toJSON());
assert.match(resultJson, /```diff/, 'result card renders the result in a diff block');
assert.match(resultJson, /\+ https:\/\/mega\.nz/, 'result card diff line is a green + destination');
const errJson = JSON.stringify(errorContainer({ title: 'Bypass failed', description: 'wall hit' }).toJSON());
assert.match(errJson, /```diff\\n- wall hit/, 'error card renders a red diff line');
const pingCmd2 = await import('../src/commands/public/ping.js');
assert.ok(pingCmd2.default, 'ping imports clean with statusPanel');

/* ---------- v2.0: poll button router + catalog ---------- */
const pollMod = await import('../src/commands/public/poll.js');
assert.equal(typeof pollMod.handlePollButton, 'function', 'poll exposes its button handler');
const { categorize, countInvokables, categoryFor, CATEGORY_META } = await import('../src/commands/catalog.js');
const { commands: coll } = await import('../src/commands/index.js');
assert.equal(coll.size, 42, 'collection holds all 42 (v3 catalog)');
assert.equal(categoryFor('tools'), 'utility', 'tools categorized as utility');
assert.equal(categoryFor('text'), 'utility', 'text categorized as utility');
assert.ok(countInvokables(coll) >= 130, '100+ invokable actions guaranteed');
assert.equal(categoryFor('bx'), 'bypass', 'bx categorized as bypass');
assert.equal(categoryFor('utility'), 'utility', 'utility categorized');
assert.equal(categoryFor('nonexistent-cmd'), 'meta', 'unknown falls to meta');
const groups = categorize(coll);
assert.equal(countInvokables(coll), invokables, 'catalog invokable count matches smoke count');
for (const cat of Object.keys(CATEGORY_META)) {
  assert.ok(groups.has(cat) || cat === 'owner', `category populated: ${cat}`);
}
assert.ok(groups.get('owner').some((c) => c.name === 'owner'), 'owner group lists the owner suite');
ok('v2.0: poll router + command catalog wiring verified');

/* ---------- done ---------- */
console.log(`\nSMOKE PASS — ${passed} check groups, all green.`);
