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
assert.equal(config.minGuildMembers, 150, 'auto-leave threshold defaults to 150');
ok('config: owner id, invite url, auto-leave threshold');

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
ok('bypass-core: URL normalization');

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
  leaveCard,
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
const lc = leaveCard({ name: 'Test Guild', id: '123', memberCount: 42 });
assert.ok(JSON.stringify(lc.toJSON()).includes('150+ members'), 'leave card explains the threshold');
ok('components: all V2 containers + button rules');

/* ---------- command registry ---------- */
const { commandData } = await import('../src/commands/index.js');
assert.equal(commandData.length, 12, '12 top-level commands');
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
  'enable-autobypass',
  'disable-autobypass',
  'owner',
]) {
  assert.ok(names.includes(expected), `command registered: ${expected}`);
}
const enableCmd = commandData.find((c) => c.name === 'enable-autobypass');
assert.equal(enableCmd.default_member_permissions, '8', 'enable-autobypass is admin-gated at Discord level');
const disableCmd = commandData.find((c) => c.name === 'disable-autobypass');
assert.equal(disableCmd.default_member_permissions, '8', 'disable-autobypass is admin-gated at Discord level');
const contextCmd = commandData.find((c) => c.name === 'Bypass Link');
assert.equal(contextCmd.type, 3, 'Bypass Link is a message context command');
const ownerCmd = commandData.find((c) => c.name === 'owner');
assert.equal(ownerCmd.options.length, 14, 'owner group has 14 subcommands');
ok(`commands: ${commandData.length} registered, owner group complete`);

/* ---------- autobypass permission helpers ---------- */
const { canManageAutobypass } = await import('../src/commands/owner/enable-autobypass.js');
assert.equal(typeof canManageAutobypass, 'function');
ok('autobypass: permission helper exported');

/* ---------- done ---------- */
console.log(`\nSMOKE PASS — ${passed} check groups, all green.`);
