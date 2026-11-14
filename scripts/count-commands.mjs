/**
 * Static command counter — loads the command collection without touching
 * Discord, Postgres or the API (mocks env + modules that connect).
 * Prints top-level count, subcommand count and total invokables.
 */
process.env.BOT_TOKEN ??= 'x';
process.env.DATABASE_URL ??= 'postgres://x:x@localhost:5432/x';

const { commands, commandData } = await import('../src/commands/index.js');

let top = 0;
let subs = 0;
const perCmd = [];
for (const cmd of commands.values()) {
  top += 1;
  let n = 0;
  const names = [];
  for (const opt of cmd.data.options ?? []) {
    try {
      const j = opt.toJSON();
      if (j.type === 1) {
        subs += 1;
        n += 1;
        names.push(j.name);
      }
    } catch {
      /* plain option */
    }
  }
  perCmd.push(`  /${cmd.data.name}${n ? ` (${n}: ${names.join(', ')})` : ''}`);
}

console.log(`top-level commands : ${top}`);
console.log(`subcommands        : ${subs}`);
console.log(`TOTAL INVOKABLES   : ${top + subs}`);
console.log('--- roster ---');
console.log(perCmd.join('\n'));

// Sanity: every command JSON serializes (catches invalid builders)
let jsonOk = 0;
for (const d of commandData) {
  JSON.stringify(d);
  jsonOk += 1;
}
console.log(`toJSON serialized  : ${jsonOk}/${commandData.length} OK`);

// Sanity: options per command under Discord's 25 limit
let optsOk = true;
for (const d of commandData) {
  if ((d.options ?? []).length > 25) {
    console.log(`LIMIT VIOLATION: /${d.name} has ${(d.options ?? []).length} options`);
    optsOk = false;
  }
}
console.log(`option limits      : ${optsOk ? 'OK (≤25 per command)' : 'FAIL'}`);
