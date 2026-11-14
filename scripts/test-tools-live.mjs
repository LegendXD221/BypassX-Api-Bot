/** Live network spot-check for the remaining /tools subs: ip, headers, unshort, qr. */
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
  const calls = { last: null, lastReply: null, lastEdit: null, reply: 0, editReply: 0 };
  return {
    calls,
    options: {
      getSubcommand: () => sub,
      getString: (name) => opts[name] ?? null,
      getInteger: (name) => opts[name] ?? null,
      getBoolean: (name) => opts[name] ?? null,
    },
    user: { id: '42', tag: 'tester' },
    async deferReply() {},
    async reply(p) {
      calls.reply++;
      calls.lastReply = p;
      calls.last = p;
    },
    async editReply(p) {
      calls.editReply++;
      calls.lastEdit = p;
      calls.last = p;
    },
  };
}

async function run(sub, opts) {
  const mod = await import('../src/commands/suites/tools.js');
  const it = fakeInteraction(opts, sub);
  await mod.default.execute(it);
  if (!it.calls.last) throw new Error('no reply');
  return JSON.stringify(it.calls.last);
}

let s = await run('ip', { target: '8.8.8.8' });
s.includes('8.8.8.8') && s.includes('United States') ? ok('tools ip 8.8.8.8 → US/Google') : fail('tools ip: ' + s.slice(0, 300));
s = await run('headers', { url: 'https://example.com' });
s.includes('HTTP 200') && s.includes('content-type') ? ok('tools headers 200 + content-type') : fail('tools headers: ' + s.slice(0, 300));
s = await run('unshort', { url: 'http://github.com' });
s.includes('1 redirect hop') || s.includes('https://github.com') ? ok('tools unshort http→https github') : fail('tools unshort: ' + s.slice(0, 300));
s = await run('qr', { data: 'https://bypassx.de5.net' });
s.includes('create-qr-code') && s.includes('QR code ready') ? ok('tools qr image url live') : fail('tools qr: ' + s.slice(0, 300));

console.log(`\nLIVE PASS — ${passed} checks green`);
