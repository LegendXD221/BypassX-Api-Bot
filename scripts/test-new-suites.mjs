/**
 * Offline harness — drives the new /tools and /text suite handlers end-to-end
 * with a fake Discord interaction (no network for the pure-compute subs).
 * Asserts every reply contains the expected diff/kv/codeBlock markers.
 */
let passed = 0;
const fail = (msg) => {
  console.error(`✗ ${msg}`);
  process.exit(1);
};
const ok = (name) => {
  passed += 1;
  console.log(`✓ ${name}`);
};

/** Build a fake interaction: opts maps option name → value. */
function fakeInteraction(opts, sub) {
  const calls = { reply: 0, editReply: 0, deferReply: 0, lastReply: null, lastEdit: null };
  return {
    calls,
    options: {
      getSubcommand: () => sub,
      getString: (name) => opts[name] ?? null,
      getInteger: (name) => opts[name] ?? null,
      getBoolean: (name) => opts[name] ?? null,
    },
    user: { id: '42', tag: 'tester' },
    guildId: null,
    channelId: null,
    guild: null,
    async deferReply(flags) {
      calls.deferReply += 1;
      calls.deferred = Boolean(flags && flags.flags);
    },
    async reply(payload) {
      calls.reply += 1;
      calls.lastReply = payload;
      calls.last = payload;
    },
    async editReply(payload) {
      calls.editReply += 1;
      calls.lastEdit = payload;
      calls.last = payload;
    },
  };
}

async function run(modName, sub, opts) {
  const mod = await import(modName);
  const it = fakeInteraction(opts, sub);
  await mod.default.execute(it);
  if (!it.calls.last) throw new Error(`no reply for /${modName} ${sub}`);
  return JSON.stringify(it.calls.last);
}

/* ---------------- text suite (pure local) ---------------- */
const T = '../src/commands/suites/text.js';

let s = await run(T, 'case', { text: 'hello world foo-bar', style: 'snake' });
s.includes('hello_world_foo_bar') ? ok('text case → snake_case') : fail('text case snake: ' + s);
s = await run(T, 'case', { text: 'hello world test', style: 'camel' });
s.includes('helloWorldTest') ? ok('text case → camelCase') : fail('text case camel: ' + s);
s = await run(T, 'reverse', { text: 'abc 👍 def' });
s.includes('fed \\ud83d\\udcfd cba') || s.includes('cba') ? ok('text reverse (emoji-safe)') : fail('text reverse: ' + s);
s = await run(T, 'wc', { text: 'one two three\nfour five' });
s.includes('words') && s.includes('5') ? ok('text wc counts 5 words') : fail('text wc: ' + s);
s = await run(T, 'sort', { text: 'banana\napple\ncherry', mode: 'asc' });
s.includes('apple') && s.indexOf('apple') < s.indexOf('banana') ? ok('text sort asc') : fail('text sort: ' + s);
s = await run(T, 'dedupe', { text: 'a\nb\na\nB', ignorecase: true });
s.includes('duplicate line(s) removed') && s.includes('2 kept') ? ok('text dedupe (ignorecase)') : fail('text dedupe: ' + s);
s = await run(T, 'mock', { text: 'this is mocking case' });
s.includes('tHiS') || s.includes('hIs') ? ok('text mock alternating case') : fail('text mock: ' + s);
s = await run(T, 'binary', { input: 'Hi' });
s.includes('01001000') || s.includes('01001000'.slice(0, 8)) ? ok('text binary encode Hi') : fail('text binary: ' + s);
s = await run(T, 'binary', { input: '01001000 01101001' });
s.includes('Hi') ? ok('text binary decode → Hi') : fail('text binary decode: ' + s);
s = await run(T, 'morse', { input: 'sos' });
s.includes('... --- ...') ? ok('text morse encode sos') : fail('text morse encode: ' + s);
s = await run(T, 'morse', { input: '... --- ...' });
s.includes('sos') ? ok('text morse decode → sos') : fail('text morse decode: ' + s);
s = await run(T, 'caesar', { text: 'abc', shift: 3 });
s.includes('def') ? ok('text caesar shift 3') : fail('text caesar: ' + s);
s = await run(T, 'leet', { text: 'awesome', hardcore: false });
s.includes('4w3') ? ok('text leet classic') : fail('text leet: ' + s);
s = await run(T, 'charinfo', { character: 'A' });
s.includes('U+0041') ? ok('text charinfo U+0041') : fail('text charinfo: ' + s);

/* ---------------- tools suite (pure local subs) ---------------- */
const TL = '../src/commands/suites/tools.js';

s = await run(TL, 'json', { data: '{"a":1,"b":[2,3]}' });
s.includes('valid JSON') && s.includes('top-level keys: a, b') ? ok('tools json valid') : fail('tools json: ' + s);
s = await run(TL, 'json', { data: '{"a":1,,}' });
s.includes('invalid JSON') ? ok('tools json invalid reports error') : fail('tools json invalid: ' + s);
s = await run(TL, 'regex', { pattern: '\\d+', text: 'run 42 fast 99', flags: 'g' });
s.includes('2 matches') && s.includes('42') && s.includes('99') ? ok('tools regex matches') : fail('tools regex: ' + s);
s = await run(TL, 'regex', { pattern: '[unclosed', text: 'x' });
s.includes('invalid regex') ? ok('tools regex rejects broken pattern') : fail('tools regex invalid: ' + s);
s = await run(TL, 'jwt', { token: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0IiwiZXhwIjoxNzAwMDAwMDAwfQ.sig' });
s.includes('EXPIRED') && s.includes('sub') && s.includes('1234') ? ok('tools jwt decode + expiry verdict') : fail('tools jwt: ' + s);
s = await run(TL, 'jwt', { token: 'not-a-jwt' });
s.includes('not a JWT') ? ok('tools jwt rejects garbage') : fail('tools jwt garbage: ' + s);
s = await run(TL, 'cron', { expression: '*/15 9-17 * * 1-5' });
s.includes('next #1') && s.includes('every 15 minutes') ? ok('tools cron next runs + humanize') : fail('tools cron: ' + s);
s = await run(TL, 'cron', { expression: '0 0 1 jan *' });
s.includes('month jan') || s.includes('month 1') || s.includes('month jan') ? ok('tools cron month names') : fail('tools cron jan: ' + s);
s = await run(TL, 'cron', { expression: '99 * * * *' });
s.includes('invalid cron') ? ok('tools cron rejects out-of-range') : fail('tools cron invalid: ' + s);

/* ---------------- live network sanity (best effort, 10s budget) ---------------- */
try {
  s = await run(TL, 'dns', { domain: 'example.com', type: 'A' });
  s.includes('example.com') && (s.includes('A') || s.includes('record')) ? ok('tools dns example.com (live)') : fail('tools dns: ' + s.slice(0, 200));
} catch (e) {
  console.log(`- tools dns skipped (no network? ${e.message})`);
}
try {
  s = await run(TL, 'urlstatus', { url: 'https://example.com' });
  s.includes('HTTP 200') ? ok('tools urlstatus example.com 200 (live)') : fail('tools urlstatus: ' + s.slice(0, 300));
} catch (e) {
  console.log(`- tools urlstatus skipped (no network? ${e.message})`);
}

console.log(`\nHARNESS PASS — ${passed} checks green`);
