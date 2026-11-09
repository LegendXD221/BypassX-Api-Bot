import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import crypto from 'node:crypto';
import { config } from '../../config.js';
import { V2, card, errorContainer } from '../../components.js';
import { kvTable, codeBlock, cut } from '../../format.js';

/* ------------------------------------------------------------------ */
/* /utility — dev & power-user pocket tools                            */
/* encode · decode · hash · uuid · password · timestamp · snowflake    */
/* math · color · baseconvert                                          */
/* ------------------------------------------------------------------ */

export default {
  data: new SlashCommandBuilder()
    .setName('utility')
    .setDescription('Dev & power-user pocket tools — encode, hash, snowflakes, colors…')
    .addSubcommand((sc) =>
      sc
        .setName('encode')
        .setDescription('Encode text — base64, hex or URL-safe')
        .addStringOption((o) => o.setName('text').setDescription('Text to encode').setRequired(true).setMaxLength(1500))
        .addStringOption((o) =>
          o
            .setName('flavor')
            .setDescription('Encoding flavor')
            .addChoices({ name: 'base64', value: 'base64' }, { name: 'hex', value: 'hex' }, { name: 'url', value: 'url' })
        )
    )
    .addSubcommand((sc) =>
      sc
        .setName('decode')
        .setDescription('Decode base64, hex or URL-encoded text')
        .addStringOption((o) => o.setName('text').setDescription('Text to decode').setRequired(true).setMaxLength(2000))
        .addStringOption((o) =>
          o
            .setName('flavor')
            .setDescription('Encoding flavor (default: auto)')
            .addChoices({ name: 'base64', value: 'base64' }, { name: 'hex', value: 'hex' }, { name: 'url', value: 'url' }, { name: 'auto', value: 'auto' })
        )
    )
    .addSubcommand((sc) =>
      sc
        .setName('hash')
        .setDescription('Hash text — sha256, sha1 or md5')
        .addStringOption((o) => o.setName('text').setDescription('Text to hash').setRequired(true).setMaxLength(1500))
        .addStringOption((o) =>
          o
            .setName('algorithm')
            .setDescription('Algorithm (default sha256)')
            .addChoices({ name: 'sha256', value: 'sha256' }, { name: 'sha512', value: 'sha512' }, { name: 'sha1', value: 'sha1' }, { name: 'md5', value: 'md5' })
        )
    )
    .addSubcommand((sc) => sc.setName('uuid').setDescription('Generate a fresh UUID v4 (plus 4 more)'))
    .addSubcommand((sc) =>
      sc
        .setName('password')
        .setDescription('Generate a strong random password')
        .addIntegerOption((o) => o.setName('length').setDescription('Length 8-96 (default 20)').setMinValue(8).setMaxValue(96))
        .addBooleanOption((o) => o.setName('symbols').setDescription('Include symbols (default on)'))
    )
    .addSubcommand((sc) =>
      sc
        .setName('timestamp')
        .setDescription('Build a live-updating Discord timestamp from a date/time')
        .addStringOption((o) => o.setName('when').setDescription('Date/time — "2026-12-25 20:00", "tomorrow", "in 2h", "now"').setRequired(true).setMaxLength(120))
        .addStringOption((o) =>
          o
            .setName('style')
            .setDescription('Display style')
            .addChoices(
              { name: 'relative (X minutes ago)', value: 'R' },
              { name: 'short date', value: 'd' },
              { name: 'short time', value: 't' },
              { name: 'full date+time', value: 'f' },
              { name: 'full long', value: 'F' }
            )
        )
    )
    .addSubcommand((sc) =>
      sc
        .setName('snowflake')
        .setDescription('Decode any Discord ID — creation date, epoch, worker')
        .addStringOption((o) => o.setName('id').setDescription('The Discord ID to decode').setRequired(true).setMaxLength(25))
    )
    .addSubcommand((sc) =>
      sc
        .setName('math')
        .setDescription('Evaluate a math expression (digits, + - * / % ^ and parens)')
        .addStringOption((o) => o.setName('expression').setDescription('e.g. 2^10 / (3+5)').setRequired(true).setMaxLength(200))
    )
    .addSubcommand((sc) =>
      sc
        .setName('color')
        .setDescription('Inspect a hex color — RGB, HSL, Discord int, a swatch')
        .addStringOption((o) => o.setName('hex').setDescription('#RRGGBB (with or without #)').setRequired(true).setMaxLength(9))
    )
    .addSubcommand((sc) =>
      sc
        .setName('baseconvert')
        .setDescription('Convert a number between bases (2-36)')
        .addStringOption((o) => o.setName('number').setDescription('The number to convert').setRequired(true).setMaxLength(64))
        .addIntegerOption((o) => o.setName('from').setDescription('Input base 2-36 (default 10)').setMinValue(2).setMaxValue(36))
        .addIntegerOption((o) => o.setName('to').setDescription('Output base 2-36 (default 16)').setMinValue(2).setMaxValue(36))
    ),
  meta: { cooldownMs: 2000 },

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const ephemeral = true;
    switch (sub) {
      case 'encode':
        return runEncode(interaction);
      case 'decode':
        return runDecode(interaction);
      case 'hash':
        return runHash(interaction);
      case 'uuid':
        return runUuid(interaction);
      case 'password':
        return runPassword(interaction);
      case 'timestamp':
        return runTimestamp(interaction);
      case 'snowflake':
        return runSnowflake(interaction);
      case 'math':
        return runMath(interaction);
      case 'color':
        return runColor(interaction);
      case 'baseconvert':
        return runBaseconvert(interaction);
      default:
        return interaction.reply({
          flags: V2 | MessageFlags.Ephemeral,
          components: [errorContainer({ title: 'Unknown subcommand', description: `**${sub}** is not wired up.` })],
        });
    }
  },
};

const replyEphemeral = (interaction, body, extra = {}) =>
  interaction.reply({
    flags: V2 | MessageFlags.Ephemeral,
    components: [card({ emoji: '🧰', title: 'Utility', body, ...extra })],
  });

/* ---------------- encode / decode ---------------- */

function runEncode(interaction) {
  const text = interaction.options.getString('text', true);
  const flavor = interaction.options.getString('flavor') ?? 'base64';
  let out;
  if (flavor === 'hex') out = Buffer.from(text, 'utf8').toString('hex');
  else if (flavor === 'url') out = encodeURIComponent(text);
  else out = Buffer.from(text, 'utf8').toString('base64');
  return replyEphemeral(interaction, [
    `**${flavor}**`,
    codeBlock(flavor === 'url' ? 'txt' : '', cut(out, 1200)),
  ]);
}

function runDecode(interaction) {
  const text = interaction.options.getString('text', true);
  const flavor = interaction.options.getString('flavor') ?? 'auto';
  const attempts = flavor === 'auto' ? ['base64', 'hex', 'url'] : [flavor];
  const results = [];
  for (const f of attempts) {
    let out = null;
    try {
      if (f === 'base64' && /^[A-Za-z0-9+/=_-]+$/.test(text.trim()) && text.trim().length % 4 === 0) {
        out = Buffer.from(text.trim().replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
      } else if (f === 'hex' && /^[0-9a-fA-F\s]+$/.test(text.trim()) && text.replace(/\s/g, '').length % 2 === 0) {
        out = Buffer.from(text.replace(/\s/g, ''), 'hex').toString('utf8');
      } else if (f === 'url') {
        const dec = decodeURIComponent(text);
        if (dec !== text) out = dec;
      }
    } catch {
      out = null;
    }
    if (out != null && /^[\x09\x0a\x0d\x20-\x7e\u00a0-\uffff]*$/.test(out)) results.push([f, out]);
  }
  if (!results.length) {
    return interaction.reply({
      flags: V2 | MessageFlags.Ephemeral,
      components: [errorContainer({ title: 'Could not decode', description: 'No flavor produced readable UTF-8 from that text.' })],
    });
  }
  return replyEphemeral(interaction, [
    kvTable(results.map(([f, out]) => [f, cut(out, 400)]), { title: 'DECODED' }),
  ]);
}

/* ---------------- hash ---------------- */

function runHash(interaction) {
  const text = interaction.options.getString('text', true);
  const algo = (interaction.options.getString('algorithm') ?? 'sha256').toLowerCase();
  const digests = ['sha256', 'sha512', 'sha1', 'md5']
    .filter((a) => a === algo || algo === 'all')
    .map((a) => [a, crypto.createHash(a).update(text, 'utf8').digest('hex')]);
  return replyEphemeral(interaction, [kvTable(digests, { title: `HASH of "${cut(text, 24)}"` })]);
}

/* ---------------- uuid / password ---------------- */

function runUuid(interaction) {
  const ids = Array.from({ length: 5 }, () => crypto.randomUUID());
  return replyEphemeral(interaction, [`**Primary**\n${codeBlock('', ids[0])}`, `-# spares: ${ids.slice(1).join(' · ')}`]);
}

function runPassword(interaction) {
  const length = interaction.options.getInteger('length') ?? 20;
  const symbols = interaction.options.getBoolean('symbols') ?? true;
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const digits = '23456789';
  const syms = '!@#$%^&*_-+=?';
  const pool = lower + upper + digits + (symbols ? syms : '');
  const bytes = crypto.randomBytes(length);
  let pw = '';
  for (let i = 0; i < length; i++) pw += pool[bytes[i] % pool.length];
  // Guarantee at least one of each class when length allows
  if (length >= 4) {
    pw = `Aa4${symbols ? '!' : ''}${pw.slice(3 + (symbols ? 1 : 0))}`;
    const arr = [...pw];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = crypto.randomBytes(1)[0] % (i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    pw = arr.join('');
  }
  return replyEphemeral(interaction, [
    codeBlock('', pw),
    '-# ephemeral to you only · generated with crypto.randomBytes — never stored, never logged',
  ]);
}

/* ---------------- timestamp ---------------- */

function runTimestamp(interaction) {
  const raw = String(interaction.options.getString('when', true)).trim().toLowerCase();
  const style = interaction.options.getString('style') ?? 'R';
  let ts = null;

  if (/^(now|today)$/.test(raw)) ts = Date.now();
  else if (raw === 'tomorrow') ts = Date.now() + 86_400_000;
  else {
    const rel = /^in\s+(\d+)\s*(s|sec|secs|m|min|mins|h|hr|hrs|d|day|days|w|week|weeks)$/.exec(raw);
    if (rel) {
      const mult = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 }[
        rel[2][0] === 's' ? 's' : rel[2][0]
      ] ?? { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 }[rel[2][0]];
      const multMap = { s: 1000, sec: 1000, m: 60_000, min: 60_000, h: 3_600_000, hr: 3_600_000, d: 86_400_000, day: 86_400_000, w: 604_800_000, week: 604_800_000 };
      ts = Date.now() + Number(rel[1]) * multMap[rel[2]];
    } else {
      const parsed = Date.parse(raw);
      if (Number.isFinite(parsed)) ts = parsed;
    }
  }

  if (ts == null) {
    return interaction.reply({
      flags: V2 | MessageFlags.Ephemeral,
      components: [
        errorContainer({
          title: 'Could not read that date',
          description: 'Try ISO style `2026-12-25 20:00`, `tomorrow`, `in 2h`, or `now`.',
        }),
      ],
    });
  }

  const unix = Math.floor(ts / 1000);
  const tag = `<t:${unix}:${style}>`;
  return replyEphemeral(interaction, [
    `**Copy this into any message**\n${codeBlock('', tag)}`,
    `**Preview** · ${tag}`,
    '-# Discord renders it live in everyone\'s own timezone.',
  ]);
}

/* ---------------- snowflake ---------------- */

function runSnowflake(interaction) {
  const id = String(interaction.options.getString('id', true)).trim();
  if (!/^\d{15,21}$/.test(id)) {
    return interaction.reply({
      flags: V2 | MessageFlags.Ephemeral,
      components: [errorContainer({ title: 'Not a snowflake', description: 'Discord IDs are 15-21 digits.' })],
    });
  }
  const big = BigInt(id);
  const epoch = (big >> 22n) + 1420070400000n; // Discord epoch
  const worker = Number((big >> 17n) & 31n);
  const proc = Number((big >> 12n) & 31n);
  const increment = Number(big & 4095n);
  const date = new Date(Number(epoch));
  return replyEphemeral(interaction, [
    kvTable(
      [
        ['id', id],
        ['created', `${date.toISOString()}`],
        ['relative', `<t:${Math.floor(Number(epoch) / 1000)}:R>`],
        ['worker', String(worker)],
        ['process', String(proc)],
        ['increment', String(increment)],
      ],
      { title: 'SNOWFLAKE' }
    ),
  ]);
}

/* ---------------- math ---------------- */

function runMath(interaction) {
  const raw = String(interaction.options.getString('expression', true));
  const expr = raw.replace(/\^/g, '**').replace(/,/g, '.');
  // Strict whitelist — only digits, arithmetic, parens, exponent 'e', dots.
  if (!/^[\d\s.+\-*/()%e]+$/.test(expr)) {
    return interaction.reply({
      flags: V2 | MessageFlags.Ephemeral,
      components: [errorContainer({ title: 'Expression rejected', description: 'Only digits, `+ - * / % ^ ( )` and spaces are allowed.' })],
    });
  }
  try {
    // eslint-disable-next-line no-new-func
    const val = Function(`"use strict"; return (${expr});`)();
    if (typeof val !== 'number' || !Number.isFinite(val)) throw new Error('not a finite number');
    return replyEphemeral(interaction, [
      codeBlock('ml', `${raw}\n= ${val}`),
    ]);
  } catch {
    return interaction.reply({
      flags: V2 | MessageFlags.Ephemeral,
      components: [errorContainer({ title: 'Evaluation failed', description: 'That expression could not be evaluated — check the syntax.' })],
    });
  }
}

/* ---------------- color ---------------- */

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(hex.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, int: n, hex: `#${h.toLowerCase()}` };
}

function rgbToHsl({ r, g, b }) {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === R) h = ((G - B) / d + (G < B ? 6 : 0)) / 6;
    else if (max === G) h = ((B - R) / d + 2) / 6;
    else h = ((R - G) / d + 4) / 6;
  }
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

function runColor(interaction) {
  const rgb = hexToRgb(interaction.options.getString('hex', true));
  if (!rgb) {
    return interaction.reply({
      flags: V2 | MessageFlags.Ephemeral,
      components: [errorContainer({ title: 'Not a hex color', description: 'Use `#RRGGBB` — six hex digits, with or without the #.' })],
    });
  }
  const hsl = rgbToHsl(rgb);
  const swatch = '🟥🟥🟥🟥🟥🟥🟥🟥🟥🟥';
  return replyEphemeral(interaction, [
    kvTable(
      [
        ['hex', rgb.hex],
        ['rgb', `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`],
        ['hsl', `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)`],
        ['discord int', String(rgb.int)],
        ['bright?', rgb.r * 0.299 + rgb.g * 0.587 + rgb.b * 0.114 > 150 ? 'yes — dark text on it' : 'no — white text on it'],
      ],
      { title: 'COLOR' }
    ),
    `-# swatch: ${swatch.slice(0, 0) || ''}${rgb.hex} — the card accent below is your color`,
  ]);
}

/* ---------------- baseconvert ---------------- */

function runBaseconvert(interaction) {
  const number = String(interaction.options.getString('number', true)).trim();
  const from = interaction.options.getInteger('from') ?? 10;
  const to = interaction.options.getInteger('to') ?? 16;
  const asInt = from === 10 ? BigInt(number) : BigInt(parseInt(number, from));
  if (Number.isNaN(Number(asInt))) {
    return interaction.reply({
      flags: V2 | MessageFlags.Ephemeral,
      components: [errorContainer({ title: 'Not a valid number', description: `**${number}** is not valid in base ${from}.` })],
    });
  }
  const table = [];
  for (const b of [2, 8, 10, 16]) {
    if (b === from && b === to) continue;
    table.push([`base ${b}`, asInt.toString(b)]);
  }
  if (from !== to && ![2, 8, 10, 16].includes(to)) table.push([`base ${to}`, asInt.toString(to)]);
  return replyEphemeral(interaction, [kvTable(table, { title: `${number} (base ${from})` })]);
}
