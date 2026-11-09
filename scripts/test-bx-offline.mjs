/** Offline check for bx cacheinfo + export paths (memory-only store). */
process.env.DATABASE_URL = '';
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

function fakeInteraction(opts, sub) {
  const calls = { last: null, reply: 0, editReply: 0 };
  return {
    calls,
    options: {
      getSubcommand: () => sub,
      getString: (name) => opts[name] ?? null,
      getInteger: (name) => opts[name] ?? null,
      getBoolean: (name) => opts[name] ?? null,
    },
    user: { id: '99901', tag: 'tester' },
    guildId: null,
    channelId: null,
    guild: null,
    async deferReply() {},
    async reply(p) {
      calls.reply++;
      calls.last = p;
    },
    async editReply(p) {
      calls.editReply++;
      calls.last = p;
    },
  };
}

const bx = (await import('../src/commands/suites/bx.js')).default;

// cacheinfo — no url → stats table only
let it = fakeInteraction({}, 'cacheinfo');
await bx.execute(it);
let s = JSON.stringify(it.calls.last);
s.includes('entries') && s.includes('lifetime hits') ? ok('bx cacheinfo stats table') : fail('bx cacheinfo: ' + s.slice(0, 250));

// cacheinfo — with url → verdict line (empty cache → not cached)
it = fakeInteraction({ url: 'https://rekonise.com/whatever' }, 'cacheinfo');
await bx.execute(it);
s = JSON.stringify(it.calls.last);
s.includes('not cached') ? ok('bx cacheinfo verdict: not cached') : fail('bx cacheinfo verdict: ' + s.slice(0, 250));

// export — empty history → friendly error container
it = fakeInteraction({}, 'export');
await bx.execute(it);
s = JSON.stringify(it.calls.last);
s.includes('Nothing to export') ? ok('bx export empty-history guard') : fail('bx export empty: ' + s.slice(0, 250));

console.log(`\nBX OFFLINE PASS — ${passed} checks green`);
