/**
 * Offline smoke test — no Discord login, no API calls.
 * Verifies utilities, token store, persistence, domain matching and every
 * Components V2 container the bot can emit. Run: npm run smoke
 */
process.env.DATA_DIR = 'data-smoke';

import fs from 'node:fs';
import assert from 'node:assert/strict';

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
assert.equal(isOwner('1134757298733064203'), true, 'default owner id present');
assert.match(inviteUrl('123'), /^https:\/\/discord\.com\/oauth2\/authorize\?client_id=123/);
ok('config: owner id + invite url');

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

/* ---------- storage ---------- */
const { store, loadState } = await import('../src/storage.js');
store.autobypassEnable('g1', 'c1');
store.autobypassEnable('g1', 'c2');
store.autobypassEnable('g2', 'c3');
assert.deepEqual(store.autobypassChannels('g1'), ['c1', 'c2']);
assert.equal(store.totalAutobypassChannels(), 3);
store.autobypassDisable('g1', 'c1');
assert.deepEqual(store.autobypassChannels('g1'), ['c2']);
store.blacklistAdd('u9');
assert.equal(store.isBlacklisted('u9'), true);
store.blacklistRemove('u9');
assert.equal(store.isBlacklisted('u9'), false);
store.bump('bypasses');
store.setCooldown('bypass', 12);
assert.equal(store.cooldownCfg.bypass, 12);
store.setCooldown('bypass', 0);
assert.ok(!('bypass' in store.cooldownCfg));
await new Promise((r) => setTimeout(r, 350)); // debounced write
assert.equal(fs.existsSync('data-smoke/state.json'), true, 'state persisted');
loadState(); // reload from disk
assert.equal(store.isBlacklisted('u9'), false);
ok('storage: enable/disable, blacklist, counters, persistence roundtrip');

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
assert.equal(commandData.length, 10, '10 top-level commands');
for (const c of commandData) {
  assert.ok(c.name && c.name.length <= 32 && c.description.length <= 100, `valid ${c.name}`);
  JSON.stringify(c);
}
const names = commandData.map((c) => c.name);
assert.deepEqual(
  ['bypass', 'services', 'stats', 'ping', 'help', 'invite', 'enable-autobypass', 'disable-autobypass', 'autobypass-list', 'owner'].every((n) => names.includes(n)),
  true
);
const ownerCmd = commandData.find((c) => c.name === 'owner');
assert.equal(ownerCmd.options.length, 11, 'owner group has 11 subcommands');
ok(`commands: ${commandData.length} registered, owner group complete`);

/* ---------- done ---------- */
fs.rmSync('data-smoke', { recursive: true, force: true });
console.log(`\nSMOKE PASS — ${passed} check groups, all green.`);
