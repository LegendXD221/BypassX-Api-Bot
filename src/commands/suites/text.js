import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { config } from '../../config.js';
import { V2, card, errorContainer } from '../../components.js';
import { kvTable, codeBlock, cut, diffBlock, diffFail } from '../../format.js';

/* ------------------------------------------------------------------ */
/* /text — text transformation lab                                     */
/* case · reverse · wc · sort · dedupe · mock · binary · morse ·       */
/* caesar · leet · charinfo                                            */
/* All local computation — instant, no network.                        */
/* ------------------------------------------------------------------ */

export default {
  data: new SlashCommandBuilder()
    .setName('text')
    .setDescription('Text transformation lab — cases, sorting, morse, binary, caesar…')
    .addSubcommand((sc) =>
      sc
        .setName('case')
        .setDescription('Convert text case — camelCase, snake_case, Title Case…')
        .addStringOption((o) => o.setName('text').setDescription('Text to convert').setRequired(true).setMaxLength(1000))
        .addStringOption((o) =>
          o
            .setName('style')
            .setDescription('Target case (default: title)')
            .addChoices(
              { name: 'UPPERCASE', value: 'upper' },
              { name: 'lowercase', value: 'lower' },
              { name: 'Title Case', value: 'title' },
              { name: 'Sentence case', value: 'sentence' },
              { name: 'camelCase', value: 'camel' },
              { name: 'PascalCase', value: 'pascal' },
              { name: 'snake_case', value: 'snake' },
              { name: 'kebab-case', value: 'kebab' },
              { name: 'aLtErNaTiNg', value: 'alternating' }
            )
        )
    )
    .addSubcommand((sc) =>
      sc
        .setName('reverse')
        .setDescription('Reverse a string (emoji-safe)')
        .addStringOption((o) => o.setName('text').setDescription('Text to reverse').setRequired(true).setMaxLength(1000))
    )
    .addSubcommand((sc) =>
      sc
        .setName('wc')
        .setDescription('Text statistics — chars, words, lines, reading time')
        .addStringOption((o) => o.setName('text').setDescription('Text to measure').setRequired(true).setMaxLength(2000))
    )
    .addSubcommand((sc) =>
      sc
        .setName('sort')
        .setDescription('Sort lines — A→Z, Z→A, length, numeric or shuffle')
        .addStringOption((o) => o.setName('text').setDescription('Lines to sort').setRequired(true).setMaxLength(1500))
        .addStringOption((o) =>
          o
            .setName('mode')
            .setDescription('Sort mode (default: asc)')
            .addChoices({ name: 'A→Z', value: 'asc' }, { name: 'Z→A', value: 'desc' }, { name: 'by length', value: 'length' }, { name: 'numeric', value: 'numeric' }, { name: 'shuffle', value: 'shuffle' })
        )
    )
    .addSubcommand((sc) =>
      sc
        .setName('dedupe')
        .setDescription('Remove duplicate lines — keeps the first occurrence')
        .addStringOption((o) => o.setName('text').setDescription('Lines to dedupe').setRequired(true).setMaxLength(1500))
        .addBooleanOption((o) => o.setName('ignorecase').setDescription('Treat abc and ABC as duplicates (default: on)'))
    )
    .addSubcommand((sc) =>
      sc
        .setName('mock')
        .setDescription('mOcKiNg SpOnGeBoB cAsE — pure disrespect, zero mercy')
        .addStringOption((o) => o.setName('text').setDescription('Text to mock').setRequired(true).setMaxLength(800))
    )
    .addSubcommand((sc) =>
      sc
        .setName('binary')
        .setDescription('Text ↔ binary (auto-detects direction)')
        .addStringOption((o) => o.setName('input').setDescription('Text or 8-bit binary').setRequired(true).setMaxLength(1500))
    )
    .addSubcommand((sc) =>
      sc
        .setName('morse')
        .setDescription('Text ↔ morse code (auto-detects direction)')
        .addStringOption((o) => o.setName('input').setDescription('Text, or morse with / between words').setRequired(true).setMaxLength(1500))
    )
    .addSubcommand((sc) =>
      sc
        .setName('caesar')
        .setDescription('Shift a cipher by N (use 13 for ROT13, negative to decode)')
        .addStringOption((o) => o.setName('text').setDescription('Text to shift').setRequired(true).setMaxLength(1200))
        .addIntegerOption((o) => o.setName('shift').setDescription('Shift amount -25…25 (default 3)').setMinValue(-25).setMaxValue(25))
    )
    .addSubcommand((sc) =>
      sc
        .setName('leet')
        .setDescription('Translate to l33tsp34k')
        .addStringOption((o) => o.setName('text').setDescription('Text to translate').setRequired(true).setMaxLength(800))
        .addBooleanOption((o) => o.setName('hardcore').setDescription('Aggressive substitutions (default: off)'))
    )
    .addSubcommand((sc) =>
      sc
        .setName('charinfo')
        .setDescription('Unicode intel for a character — codepoint, UTF-8, HTML entity')
        .addStringOption((o) => o.setName('character').setDescription('One or more characters').setRequired(true).setMaxLength(5))
    ),
  meta: { cooldownMs: 1500 },

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    switch (sub) {
      case 'case':
        return runCase(interaction);
      case 'reverse':
        return runReverse(interaction);
      case 'wc':
        return runWc(interaction);
      case 'sort':
        return runSort(interaction);
      case 'dedupe':
        return runDedupe(interaction);
      case 'mock':
        return runMock(interaction);
      case 'binary':
        return runBinary(interaction);
      case 'morse':
        return runMorse(interaction);
      case 'caesar':
        return runCaesar(interaction);
      case 'leet':
        return runLeet(interaction);
      case 'charinfo':
        return runCharinfo(interaction);
      default:
        return interaction.reply({
          flags: V2 | MessageFlags.Ephemeral,
          components: [errorContainer({ title: 'Unknown subcommand', description: `**${sub}** is not wired up — use \`/help\`.` })],
        });
    }
  },
};

const reply = (interaction, body, extra = {}) =>
  interaction.reply({
    flags: V2 | MessageFlags.Ephemeral,
    components: [card({ emoji: '✍️', title: 'Text lab', body, ...extra })],
  });

/* ---------------- case ---------------- */

const words = (s) =>
  s
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[\s_\-.]+/)
    .filter(Boolean);

function runCase(interaction) {
  const text = interaction.options.getString('text', true);
  const style = interaction.options.getString('style') ?? 'title';
  const w = words(text);
  const lower = w.map((x) => x.toLowerCase());
  let out;
  switch (style) {
    case 'upper':
      out = text.toUpperCase();
      break;
    case 'lower':
      out = text.toLowerCase();
      break;
    case 'title':
      out = lower.map((x) => x[0].toUpperCase() + x.slice(1)).join(' ');
      break;
    case 'sentence': {
      const s = text.toLowerCase();
      out = s.replace(/(^\s*[a-z])|([.!?]\s+[a-z])/g, (m) => m.toUpperCase());
      break;
    }
    case 'camel':
      out = lower.map((x, i) => (i === 0 ? x : x[0].toUpperCase() + x.slice(1))).join('');
      break;
    case 'pascal':
      out = lower.map((x) => x[0].toUpperCase() + x.slice(1)).join('');
      break;
    case 'snake':
      out = lower.join('_');
      break;
    case 'kebab':
      out = lower.join('-');
      break;
    case 'alternating':
      out = [...text].map((c, i) => (i % 2 ? c.toUpperCase() : c.toLowerCase())).join('');
      break;
    default:
      out = text;
  }
  return reply(interaction, [codeBlock(style === 'kebab' || style === 'snake' || style === 'camel' || style === 'pascal' ? 'yaml' : 'txt', cut(out, 1000)), `-# ${style} · ${out.length} chars`]);
}

/* ---------------- reverse ---------------- */

function runReverse(interaction) {
  const text = interaction.options.getString('text', true);
  const out = [...text].reverse().join('');
  return reply(interaction, [codeBlock('txt', cut(out, 1000))]);
}

/* ---------------- wc ---------------- */

function runWc(interaction) {
  const text = interaction.options.getString('text', true);
  const chars = [...text].length;
  const wordCount = (text.trim().match(/\S+/g) ?? []).length;
  const lineCount = text.split(/\r\n|\r|\n/).length;
  const sentences = (text.match(/[^.!?]+[.!?]+/g) ?? []).length || (text.trim() ? 1 : 0);
  const bytes = Buffer.byteLength(text, 'utf8');
  const minutes = Math.max(1, Math.round(wordCount / 200));
  return reply(interaction, [
    kvTable(
      [
        ['characters', String(chars)],
        ['words', String(wordCount)],
        ['lines', String(lineCount)],
        ['sentences', String(sentences)],
        ['bytes (utf-8)', String(bytes)],
        ['reading time', `${minutes} min @ 200 wpm`],
      ],
      { title: 'wc' }
    ),
  ]);
}

/* ---------------- sort ---------------- */

function runSort(interaction) {
  const text = interaction.options.getString('text', true);
  const mode = interaction.options.getString('mode') ?? 'asc';
  const lines = text.split(/\r\n|\r|\n/).filter((l) => l.trim() !== '');
  let out;
  switch (mode) {
    case 'asc':
      out = [...lines].sort((a, b) => a.localeCompare(b));
      break;
    case 'desc':
      out = [...lines].sort((a, b) => b.localeCompare(a));
      break;
    case 'length':
      out = [...lines].sort((a, b) => a.length - b.length);
      break;
    case 'numeric':
      out = [...lines].sort((a, b) => (parseFloat(a) || 0) - (parseFloat(b) || 0));
      break;
    case 'shuffle':
      out = [...lines];
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      break;
    default:
      out = lines;
  }
  return reply(interaction, [codeBlock('txt', cut(out.join('\n'), 1200)), `-# ${mode} · ${out.length} line(s)`]);
}

/* ---------------- dedupe ---------------- */

function runDedupe(interaction) {
  const text = interaction.options.getString('text', true);
  const ignoreCase = interaction.options.getBoolean('ignorecase') ?? true;
  const lines = text.split(/\r\n|\r|\n/);
  const seen = new Set();
  const kept = [];
  for (const l of lines) {
    const key = ignoreCase ? l.trim().toLowerCase() : l;
    if (key === '' || seen.has(key)) continue;
    seen.add(key);
    kept.push(l);
  }
  const removed = lines.filter((l) => l.trim() !== '').length - kept.length;
  return reply(interaction, [diffBlock({ add: [`${removed} duplicate line(s) removed, ${kept.length} kept`] }), codeBlock('txt', cut(kept.join('\n'), 1100))]);
}

/* ---------------- mock ---------------- */

function runMock(interaction) {
  const text = interaction.options.getString('text', true);
  let i = 0;
  const out = [...text.toLowerCase()].map((c) => (/[a-z]/.test(c) ? (i++ % 2 ? c.toUpperCase() : c) : c)).join('');
  return reply(interaction, [codeBlock('txt', cut(out, 800))]);
}

/* ---------------- binary ---------------- */

function runBinary(interaction) {
  const input = interaction.options.getString('input', true).trim();
  const isBinary = /^[01\s]+$/.test(input) && input.replace(/\s/g, '').length % 8 === 0 && input.replace(/\s/g, '').length >= 8;
  if (isBinary) {
    const bytes = input.replace(/\s/g, '').match(/.{8}/g) ?? [];
    let out;
    try {
      out = Buffer.from(bytes.map((b) => parseInt(b, 2))).toString('utf8');
    } catch {
      out = null;
    }
    if (out && /^[\x20-\x7e\u00a0-\uffff\s]*$/.test(out)) {
      return reply(interaction, [diffBlock({ add: ['binary → text'] }), codeBlock('txt', cut(out, 1000))]);
    }
  }
  const out = [...input].map((c) => c.codePointAt(0).toString(2).padStart(c.codePointAt(0) > 255 ? 16 : 8, '0')).join(' ');
  return reply(interaction, [diffBlock({ add: ['text → binary'] }), codeBlock('txt', cut(out, 1400)), `-# ${input.length} char(s) · paste binary back to reverse it`]);
}

/* ---------------- morse ---------------- */

const MORSE = {
  a: '.-', b: '-...', c: '-.-.', d: '-..', e: '.', f: '..-.', g: '--.', h: '....', i: '..', j: '.---', k: '-.-', l: '.-..', m: '--', n: '-.', o: '---', p: '.--.', q: '--.-', r: '.-.', s: '...', t: '-', u: '..-', v: '...-', w: '.--', x: '-..-', y: '-.--', z: '--..', '0': '-----', '1': '.----', '2': '..---', '3': '...--', '4': '....-', '5': '.....', '6': '-....', '7': '--...', '8': '---..', '9': '----.', '.': '.-.-.-', ',': '--..--', '?': '..--..', '!': '-.-.--', '/': '-..-.', '@': '.--.-.', '-': '-....-',
};
const MORSE_REV = Object.fromEntries(Object.entries(MORSE).map(([k, v]) => [v, k]));

function runMorse(interaction) {
  const input = interaction.options.getString('input', true).trim();
  const isMorse = /^[.\-\s/|]+$/.test(input) && /[.\-]/.test(input);
  if (isMorse) {
    const out = input
      .split(/\s*[/|]\s*/)
      .map((word) => word.trim().split(/\s+/).map((code) => MORSE_REV[code] ?? '?').join(''))
      .join(' ')
      .trim();
    return reply(interaction, [diffBlock({ add: ['morse → text'] }), codeBlock('txt', cut(out, 1000))]);
  }
  const out = input
    .toLowerCase()
    .split(/\s+/)
    .map((word) => [...word].map((c) => MORSE[c] ?? '?').join(' '))
    .join(' / ');
  return reply(interaction, [diffBlock({ add: ['text → morse'] }), codeBlock('txt', cut(out, 1400)), '-# words separated by / — paste it back to decode']);
}

/* ---------------- caesar ---------------- */

function runCaesar(interaction) {
  const text = interaction.options.getString('text', true);
  const shift = ((interaction.options.getInteger('shift') ?? 3) % 26 + 26) % 26;
  const rot = (s, n) =>
    [...s]
      .map((c) => {
        if (/[a-z]/.test(c)) return String.fromCharCode(((c.charCodeAt(0) - 97 + n) % 26) + 97);
        if (/[A-Z]/.test(c)) return String.fromCharCode(((c.charCodeAt(0) - 65 + n) % 26) + 65);
        return c;
      })
      .join('');
  const variants = new Map([
    [`shift ${shift}`, rot(text, shift)],
    ['rot0 (identity)', rot(text, 0)],
    ['rot13', rot(text, 13)],
  ]);
  const lines = [...variants.entries()].map(([label, val], i) => `${i === 0 ? '+' : ' '} ${label.padEnd(16)}: ${cut(val, 90)}`);
  return reply(interaction, [codeBlock('diff', lines.join('\n'), 1400), '-# negative shift decodes — rot13 is its own inverse']);
}

/* ---------------- leet ---------------- */

const LEET = { a: '4', e: '3', i: '1', o: '0', s: '5', t: '7', b: '8', g: '9', z: '2' };
const LEET_HARD = { ...LEET, l: '1', c: '(', d: '|)', f: '|=', h: '|-|', k: '|<', m: '|v|', n: '|v|', r: '|2', u: '|_|', v: '\\/', w: '\\/\\/', x: '><', y: "'/" };

function runLeet(interaction) {
  const text = interaction.options.getString('text', true);
  const hardcore = interaction.options.getBoolean('hardcore') ?? false;
  const map = hardcore ? LEET_HARD : LEET;
  const out = [...text.toLowerCase()].map((c) => map[c] ?? c).join('');
  return reply(interaction, [codeBlock('txt', cut(out, 800)), `-# ${hardcore ? 'hardcore' : 'classic'} mode · ${Object.keys(map).length} substitutions`]);
}

/* ---------------- charinfo ---------------- */

function runCharinfo(interaction) {
  const input = interaction.options.getString('character', true);
  const chars = [...input].slice(0, 3);
  const rows = chars.map((c) => {
    const cp = c.codePointAt(0);
    const buf = Buffer.from(c, 'utf8');
    return [
      c === ' ' ? '(space)' : c,
      `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`,
      `${cp}`,
      [...buf].map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' '),
      buf.length === 1 ? `&#${cp};` : `&#x${cp.toString(16)};`,
    ];
  });
  const lines = rows.map(([ch, u, dec, utf8, ent]) => `${ch} │ ${u} │ dec ${dec} │ utf8 ${utf8} │ ${ent}`);
  return reply(interaction, [codeBlock('ml', ['char │ unicode │ decimal │ utf-8 │ html entity', '─'.repeat(46)].concat(lines).join('\n'), 1200), '-# showing first 3 characters']);
}
