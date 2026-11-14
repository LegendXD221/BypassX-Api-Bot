/**
 * Functional test — auto-bypass self-cleaning + enable announcement.
 * Mocked Discord objects (no network, no DB — store runs memory-only).
 * Verifies REAL behavior:
 *   1. destination success (cache hit) → result card sent; after 60s BOTH the
 *      card and the user's link message are deleted (fake timers)
 *   2. oauth success (stubbed API) → oauth card carries the self-delete note,
 *      same 60s cleanup
 *   3. failure → ❌ reaction + a short error card (honest reason, no retry
 *      button); card + user message self-delete at 60s
 *   4. /enable-autobypass posts an announcement in each NEWLY armed channel
 *      (silent on re-arm), with a Manage-Messages hint when the permission
 *      is missing; the card footers advertise the self-delete
 * Run: node scripts/test_autobypass_cleanup.mjs
 */
import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { Collection, ChannelType, MessageFlags, PermissionsBitField } from 'discord.js';

delete process.env.DATABASE_URL;

let passed = 0;
const ok = (name) => { passed += 1; console.log(`✓ ${name}`); };

const { config } = await import('../src/config.js');
config.apiKey = 'test-key';
config.apiUrl = 'http://127.0.0.1:9'; // unreachable — anything unstubbed fails fast, offline

const { supported, cacheSet } = await import('../src/api.js');
const { store } = await import('../src/db.js');
const { resultContainer, oauthContainer, V2 } = await import('../src/components.js');
const { onMessage } = await import('../src/events/messageCreate.js');
const enableCmd = (await import('../src/commands/owner/enable-autobypass.js')).default;

/* ---------- discord mocks ---------- */

const sentMessages = []; // every message the bot "sends" in channels

function makeSentMessage(payload, into = sentMessages) {
  const sent = {
    payload,
    deleteCalls: 0,
    deleted: false,
    delete: async () => { sent.deleteCalls += 1; sent.deleted = true; return sent; },
  };
  into.push(sent);
  return sent;
}

function makeMessage({ content, authorId = '222', channelId, guildId = 'g1' }) {
  const state = { deleted: false, deleteCalls: 0, reactions: [] };
  const msg = {
    id: `usermsg-${channelId}`,
    guild: { id: guildId, ownerId: 'admin-1' },
    author: { bot: false, id: authorId, toString: () => `<@${authorId}>` },
    channelId,
    channel: {
      id: channelId,
      sendTyping: async () => {},
      send: async (payload) => makeSentMessage(payload),
    },
    content,
    client: {},
    react: async (emoji) => { state.reactions.push(emoji); },
    delete: async () => {
      state.deleteCalls += 1;
      if (state.deleted) throw Object.assign(new Error('Unknown Message'), { code: 10008 });
      state.deleted = true;
      return msg;
    },
  };
  return { msg, state };
}

/** Stub fetch: /api/owner → canned answer; everything else → HTTP 500 (fails fast, offline). */
let ownerApiAnswer = null;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  const target = String(url);
  if (target.includes('/api/owner')) {
    if (ownerApiAnswer instanceof Error) throw ownerApiAnswer;
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ownerApiAnswer,
    };
  }
  return { ok: false, status: 500, headers: { get: () => null }, json: async () => ({}) };
};

/* Seed the supported registry directly (offline, deterministic). */
supported.byDomain.set('linkvertise.com', { name: 'Linkvertise', domains: ['linkvertise.com'] });
supported.byDomain.set('pandadevelopment.net', { name: 'Delta', domains: ['pandadevelopment.net'] });

/* ---------- 1. destination success (cache hit) → 60s self-clean ---------- */

test('auto-bypass destination: result card + user message deleted after 60s', async (t) => {
  store.autobypassEnable('g1', 'ch-dest', 'admin-1');
  cacheSet('https://linkvertise.com/1/testdest', {
    kind: 'destination',
    url: 'https://dest.example/final-link',
    serviceName: 'Linkvertise',
    note: null,
    elapsedMs: 123,
  });

  const { msg, state } = makeMessage({ content: 'grab https://linkvertise.com/1/testdest pls', channelId: 'ch-dest' });
  const before = sentMessages.length;

  t.mock.timers.enable({ apis: ['setTimeout'] });
  await onMessage(msg);

  assert.equal(sentMessages.length, before + 1, 'exactly one result card sent');
  const card = sentMessages[sentMessages.length - 1];
  const flat = JSON.stringify(card.payload);
  assert.match(flat, /Link Bypassed/, 'result card rendered');
  assert.match(flat, /self-deletes in 60s/, 'card advertises the self-delete');
  assert.equal(state.deleted, false, 'user message alive immediately after the result');

  t.mock.timers.tick(60_000);
  assert.equal(card.deleted, true, 'result card deleted at 60s');
  assert.equal(state.deleted, true, 'user link message deleted at 60s');
  t.mock.timers.reset();
  ok('destination result: card + user message self-delete at 60s');
});

/* ---------- 2. oauth success → same cleanup, card says finish now ---------- */

test('auto-bypass oauth: handoff card self-deletes at 60s too', async (t) => {
  ownerApiAnswer = {
    ok: true,
    site: { name: 'Delta' },
    note: 'one human step needed',
    action: {
      kind: 'oauth',
      provider: 'discord',
      ref: 'ref-1',
      expiresInMs: 600_000,
      authorizeUrl: 'https://discord.com/oauth2/authorize?client_id=1',
    },
    elapsedMs: 5,
  };

  store.autobypassEnable('g1', 'ch-oauth', 'admin-1');
  const { msg, state } = makeMessage({ content: 'https://pandadevelopment.net/service/key/x', channelId: 'ch-oauth' });
  const before = sentMessages.length;

  t.mock.timers.enable({ apis: ['setTimeout'] });
  await onMessage(msg);

  assert.equal(sentMessages.length, before + 2, 'ack + oauth card sent');
  const ack = sentMessages[before];
  assert.match(String(ack.payload.content), /bypassing your link/, 'ack pinged the author first');
  assert.equal(ack.deleted, true, 'ack removed once the oauth card lands');
  const card = sentMessages[before + 1];
  const flat = JSON.stringify(card.payload);
  assert.match(flat, /One sign-in needed/, 'oauth card rendered');
  assert.match(flat, /card self-deletes in 60s/, 'auto oauth card warns to finish now');
  assert.equal(state.deleted, false, 'nothing deleted yet');

  t.mock.timers.tick(60_000);
  assert.equal(card.deleted, true, 'oauth card deleted at 60s');
  assert.equal(state.deleted, true, 'user link message deleted at 60s');
  t.mock.timers.reset();
  ownerApiAnswer = null;
  ok('oauth handoff: card + user message self-delete at 60s');
});

/* ---------- 3. failure → error card + ❌, everything self-cleans ---------- */

test('auto-bypass failure: error card speaks, card + user message deleted at 60s', async (t) => {
  ownerApiAnswer = { ok: false, error: 'no route for this url' };

  store.autobypassEnable('g1', 'ch-fail', 'admin-1');
  const { msg, state } = makeMessage({ content: 'https://linkvertise.com/1/willfail', channelId: 'ch-fail' });
  const before = sentMessages.length;

  t.mock.timers.enable({ apis: ['setTimeout'] });
  await onMessage(msg);

  assert.equal(sentMessages.length, before + 2, 'ack + failure card sent');
  const ack = sentMessages[before];
  assert.match(String(ack.payload.content), /bypassing your link/, 'ack pinged the author');
  assert.equal(ack.deleted, true, 'ack cleaned up after the failure');
  assert.deepEqual(state.reactions, ['❌'], 'failure still reacts ❌');
  const failCard = sentMessages[before + 1];
  const flat = JSON.stringify(failCard.payload);
  assert.match(flat, /Couldn.t bypass this link/, 'failure card speaks — never silence-only');
  assert.match(flat, /no route for this url/, 'card carries the honest reason');
  assert.match(flat, /self-delete in 60s/, 'card announces its own cleanup');
  assert.doesNotMatch(flat, /Try Again/, 'no retry button — the card self-deletes; re-posting is the retry');
  assert.equal(state.deleted, false, 'nothing deleted while the card is up');

  t.mock.timers.tick(60_000);
  assert.equal(failCard.deleted, true, 'failure card deleted at 60s');
  assert.equal(state.deleted, true, 'user link message deleted at 60s too');
  t.mock.timers.reset();
  ownerApiAnswer = null;
  ok('failure path: error card + ❌, card + link message self-clean at 60s');
});

/* ---------- 4. container footers ---------- */

test('card footers: auto cards advertise self-delete, manual oauth unchanged', async () => {
  const dest = resultContainer({
    sourceUrl: 'https://linkvertise.com/1/x',
    result: { kind: 'destination', url: 'https://dest.example/2', serviceName: 'Linkvertise' },
    auto: true,
  });
  assert.match(JSON.stringify(dest.toJSON()), /self-deletes in 60s — copy what you need/);

  const action = { kind: 'oauth', ref: 'r', expiresInMs: 600_000, authorizeUrl: 'https://discord.com/oauth2/authorize?client_id=1' };
  const oauthAuto = oauthContainer({ siteName: 'Delta', action, note: 'n', sourceUrl: 'https://x.com/1', userId: 'u', auto: true });
  const autoJson = JSON.stringify(oauthAuto.toJSON());
  assert.match(autoJson, /card self-deletes in 60s — finish the sign-in now/);

  const oauthManual = oauthContainer({ siteName: 'Delta', action, note: 'n', sourceUrl: 'https://x.com/1', userId: 'u' });
  const manualJson = JSON.stringify(oauthManual.toJSON());
  assert.match(manualJson, /handoff expires soon — finish it in one go/);
  assert.doesNotMatch(manualJson, /self-deletes/);
  ok('footers: auto self-delete notes on, manual oauth note untouched');
});

/* ---------- 5. /enable-autobypass announcement ---------- */

function makeGuildChannel({ id, manageMessages }) {
  const sends = [];
  return {
    id,
    type: ChannelType.GuildText,
    sends,
    permissionsFor: () => ({
      has: (req) => {
        const bits = typeof req === 'bigint' ? req : BigInt(req);
        if (manageMessages) return true;
        return (bits & (PermissionsBitField.Flags.ViewChannel | PermissionsBitField.Flags.SendMessages)) === bits;
      },
    }),
    send: async (payload) => makeSentMessage(payload, sends),
  };
}

function makeEnableInteraction({ channel, adminId = 'admin-1' }) {
  return {
    inGuild: () => true,
    guild: {
      id: 'g1',
      ownerId: adminId,
      channels: {
        cache: new Collection([[channel.id, channel]]),
        fetch: async () => channel,
      },
      members: { me: { id: 'bot1' } },
    },
    user: { id: adminId },
    channelId: channel.id,
    member: { permissions: { has: () => true } },
    options: { getChannel: () => null, getString: () => null, getBoolean: () => null },
    replies: [],
    async reply(payload) { this.replies.push(payload); },
  };
}

test('enable-autobypass: announcement posted in newly armed channel, not on re-arm', async () => {
  const ch = makeGuildChannel({ id: 'ch-announce', manageMessages: true });
  const interaction = makeEnableInteraction({ channel: ch });

  await enableCmd.execute(interaction);

  assert.equal(ch.sends.length, 1, 'exactly one announcement in the channel');
  const ann = ch.sends[0].payload;
  assert.equal(Boolean(ann.flags & MessageFlags.IsComponentsV2), true, 'announcement is a V2 message');
  assert.deepEqual(ann.allowedMentions, { parse: [] }, 'announcement never pings anyone');
  const flat = JSON.stringify(ann.payload ?? ann.components ?? ann);
  assert.match(flat, /Auto-bypass enabled in this channel/);
  assert.match(flat, /self-delete/, 'announcement explains the 60s cleanup');
  assert.match(flat, /Armed by/, 'announcement credits the arming admin');
  assert.equal(interaction.replies.length, 1, 'admin still gets the private confirmation');
  ok('enable: announcement posted in newly armed channel');
});

test('enable-autobypass: re-arm is silent (no duplicate announcement)', async () => {
  const ch = makeGuildChannel({ id: 'ch-announce', manageMessages: true });
  const interaction = makeEnableInteraction({ channel: ch });

  await enableCmd.execute(interaction); // already armed in the previous test

  assert.equal(ch.sends.length, 0, 'no announcement when nothing is newly armed');
  assert.equal(interaction.replies.length, 1, 'confirmation still replies privately');
  ok('re-arm: silent, no duplicate announcement');
});

test('enable-autobypass: missing Manage Messages → hint in the announcement', async () => {
  const ch = makeGuildChannel({ id: 'ch-nomanage', manageMessages: false });
  const interaction = makeEnableInteraction({ channel: ch });

  await enableCmd.execute(interaction);

  assert.equal(ch.sends.length, 1, 'announcement posted');
  const flat = JSON.stringify(ch.sends[0].payload);
  assert.match(flat, /Manage Messages/, 'hint names the missing permission');
  assert.match(flat, /result cards will still self-delete/, 'hint explains degraded mode');
  ok('enable: Manage-Messages hint when the permission is missing');
});

/* ---------- summary ---------- */

process.on('exit', () => {
  globalThis.fetch = realFetch;
  console.log(`\nAUTOBYPASS CLEANUP TEST — ${passed} scenario groups, all green`);
});
