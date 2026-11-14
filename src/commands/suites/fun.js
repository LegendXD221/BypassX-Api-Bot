import { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } from 'discord.js';
import crypto from 'node:crypto';
import { V2, card, errorContainer } from '../../components.js';
import { bar, diffBlock } from '../../format.js';

/* ------------------------------------------------------------------ */
/* /fun — party tricks with an edge                                    */
/* roll · flip · eightball · choose · rate · love · rps · duel         */
/* ------------------------------------------------------------------ */

const BALL = [
  'It is certain.', 'It is decidedly so.', 'Without a doubt.', 'Yes — definitely.',
  'You may rely on it.', 'As I see it, yes.', 'Most likely.', 'Outlook good.',
  'Signs point to yes.', 'Reply hazy — try again.', 'Ask again later.',
  'Better not tell you now.', 'Cannot predict now.', 'Concentrate and ask again.',
  "Don't count on it.", 'My reply is no.', 'My sources say no.', 'Outlook not so good.',
  'Very doubtful.', 'Absolutely — and twice on Sundays.',
];

const RATE_VERDICTS = [
  [0, 'does not deserve the electrons it printed on'],
  [10, 'rougher than a pineapple smoothie'],
  [25, 'has potential, buried deep'],
  [40, 'mid at best, mid at worst'],
  [55, 'actually decent — would recommend to a friend of a friend'],
  [70, 'strong! nearly elite tier'],
  [85, 'certified banger'],
  [95, 'top-shelf. frame this.'],
  [100, 'perfect — the numbers never lie'],
];

const randInt = (max) => crypto.randomBytes(4).readUInt32BE(0) % max;
const pick = (arr) => arr[randInt(arr.length)];

export default {
  data: new SlashCommandBuilder()
    .setName('fun')
    .setDescription('Party tricks — dice, coins, fate and harsh verdicts')
    .addSubcommand((sc) =>
      sc
        .setName('roll')
        .setDescription('Roll dice — NdM style (2d6, 1d20, 5d4…)')
        .addStringOption((o) => o.setName('dice').setDescription('Dice notation (default 1d6)').setMaxLength(20))
    )
    .addSubcommand((sc) =>
      sc
        .setName('flip')
        .setDescription('Flip a coin (or a stack of them)')
        .addIntegerOption((o) => o.setName('count').setDescription('How many coins 1-25 (default 1)').setMinValue(1).setMaxValue(25))
    )
    .addSubcommand((sc) =>
      sc
        .setName('eightball')
        .setDescription('Ask the magic 8-ball a yes/no question')
        .addStringOption((o) => o.setName('question').setDescription('Your question').setRequired(true).setMaxLength(200))
    )
    .addSubcommand((sc) =>
      sc
        .setName('choose')
        .setDescription('Let the bot pick one of your options')
        .addStringOption((o) => o.setName('options').setDescription('Options separated by commas').setRequired(true).setMaxLength(500))
    )
    .addSubcommand((sc) =>
      sc
        .setName('rate')
        .setDescription('Rate anything 0-100 — the number is final')
        .addStringOption((o) => o.setName('thing').setDescription('What to rate').setRequired(true).setMaxLength(120))
    )
    .addSubcommand((sc) =>
      sc
        .setName('love')
        .setDescription('Compatibility meter for two names')
        .addStringOption((o) => o.setName('first').setDescription('First name').setRequired(true).setMaxLength(60))
        .addStringOption((o) => o.setName('second').setDescription('Second name').setRequired(true).setMaxLength(60))
    )
    .addSubcommand((sc) =>
      sc
        .setName('rps')
        .setDescription('Rock · paper · scissors against the bot')
        .addStringOption((o) =>
          o
            .setName('move')
            .setDescription('Your move')
            .setRequired(true)
            .addChoices({ name: 'rock', value: 'rock' }, { name: 'paper', value: 'paper' }, { name: 'scissors', value: 'scissors' })
        )
    )
    .addSubcommand((sc) =>
      sc
        .setName('duel')
        .setDescription('Pit two members (or names) against each other — fate decides')
        .addStringOption((o) => o.setName('challenger1').setDescription('First fighter').setRequired(true).setMaxLength(60))
        .addStringOption((o) => o.setName('challenger2').setDescription('Second fighter').setRequired(true).setMaxLength(60))
    ),
  meta: { cooldownMs: 1500 },

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    switch (sub) {
      case 'roll':
        return runRoll(interaction);
      case 'flip':
        return runFlip(interaction);
      case 'eightball':
        return runEightball(interaction);
      case 'choose':
        return runChoose(interaction);
      case 'rate':
        return runRate(interaction);
      case 'love':
        return runLove(interaction);
      case 'rps':
        return runRps(interaction);
      case 'duel':
        return runDuel(interaction);
      default:
        return interaction.reply({
          flags: V2 | MessageFlags.Ephemeral,
          components: [errorContainer({ title: 'Unknown subcommand', description: `**${sub}** is not wired up.` })],
        });
    }
  },
};

/* ---------------- roll ---------------- */

function runRoll(interaction) {
  const spec = String(interaction.options.getString('dice') ?? '1d6').toLowerCase().replace(/\s/g, '');
  const m = /^(\d{1,3})?d(\d{1,3})$/.exec(spec);
  if (!m || Number(m[2] ?? 6) < 2) {
    return interaction.reply({
      flags: V2 | MessageFlags.Ephemeral,
      components: [errorContainer({ title: 'Bad dice', description: 'Use `NdM` — e.g. `2d6`, `1d20`, `5d4`. Sides ≥ 2.' })],
    });
  }
  const count = Math.min(Number(m[1] ?? 1), 50);
  const sides = Math.min(Number(m[2]), 1000);
  const rolls = Array.from({ length: count }, () => randInt(sides) + 1);
  const total = rolls.reduce((a, b) => a + b, 0);
  const crit = count === 1 ? (rolls[0] === sides ? ' — NAT MAX!' : rolls[0] === 1 ? ' — natural one, shame' : '') : '';
  return interaction.reply({
    flags: V2 | MessageFlags.Ephemeral,
    components: [
      card({
        emoji: '🎲',
        title: `${count}d${sides} → ${total}${crit}`,
        body: [diffBlock({ add: [`total ${total}${crit}`], info: count > 1 ? ['rolls'] : [], max: 400 })],
        footerText: count > 1 ? rolls.join(' + ') : null,
      }),
    ],
  });
}

/* ---------------- flip ---------------- */

function runFlip(interaction) {
  const count = interaction.options.getInteger('count') ?? 1;
  const flips = Array.from({ length: count }, () => (randInt(2) ? 'H' : 'T'));
  const heads = flips.filter((f) => f === 'H').length;
  const verdict = count === 1 ? (heads ? 'HEADS' : 'TAILS') : `${heads}H / ${count - heads}T`;
  return interaction.reply({
    flags: V2 | MessageFlags.Ephemeral,
    components: [
      card({
        emoji: '🪙',
        title: `${verdict}`,
        body: [diffBlock({ add: [verdict], max: 200 }), count > 1 ? `-# sequence: ${flips.join(' ')}` : null].filter(Boolean),
      }),
    ],
  });
}

/* ---------------- eightball ---------------- */

function runEightball(interaction) {
  const q = interaction.options.getString('question', true);
  return interaction.reply({
    flags: V2 | MessageFlags.Ephemeral,
    components: [
      card({
        emoji: '🎱',
        title: 'The 8-ball has spoken',
        body: [`> ${q}`, diffBlock({ add: [pick(BALL)], max: 300 })],
      }),
    ],
  });
}

/* ---------------- choose ---------------- */

function runChoose(interaction) {
  const options = interaction.options
    .getString('options', true)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (options.length < 2) {
    return interaction.reply({
      flags: V2 | MessageFlags.Ephemeral,
      components: [errorContainer({ title: 'Need at least 2 options', description: 'Separate them with commas: `pizza, sushi, tacos`.' })],
    });
  }
  const chosen = pick(options);
  return interaction.reply({
    flags: V2 | MessageFlags.Ephemeral,
    components: [
      card({
        emoji: '🤔',
        title: 'Decision made',
        body: [diffBlock({ del: options.filter((o) => o !== chosen).slice(0, 6), add: [chosen], max: 900 })],
        footerText: 'struck from the shortlist — the survivor is highlighted',
      }),
    ],
  });
}

/* ---------------- rate ---------------- */

function runRate(interaction) {
  const thing = interaction.options.getString('thing', true);
  const score = randInt(101);
  const verdict = RATE_VERDICTS.find(([min]) => score >= min)?.[1] ?? 'exists, technically';
  return interaction.reply({
    flags: V2 | MessageFlags.Ephemeral,
    components: [
      card({
        emoji: '⚖️',
        title: `${thing} — ${score}/100`,
        body: [bar(score, 14), `> ${verdict}`],
      }),
    ],
  });
}

/* ---------------- love ---------------- */

function runLove(interaction) {
  const a = interaction.options.getString('first', true).trim();
  const b = interaction.options.getString('second', true).trim();
  // Deterministic per pair — the same two names always get the same score.
  const seed = `${a.toLowerCase()}♥${b.toLowerCase()}`;
  const hash = crypto.createHash('sha256').update(seed).digest();
  const score = hash[0] % 101;
  const verdict =
    score >= 90 ? 'written in the stars 💫'
    : score >= 70 ? 'strong pairing — power-couple material'
    : score >= 45 ? 'workable — communication is key'
    : score >= 20 ? 'turbocharged platonic energy'
    : 'doomed, but make it fashion';
  return interaction.reply({
    flags: V2 | MessageFlags.Ephemeral,
    components: [
      card({
        accent: 0xec4899,
        emoji: '💘',
        title: `${a} × ${b}`,
        body: [bar(score, 14), `> ${verdict}`, '-# deterministic — this pair always scores the same'],
      }),
    ],
  });
}

/* ---------------- rps ---------------- */

function runRps(interaction) {
  const moves = ['rock', 'paper', 'scissors'];
  const mine = pick(moves);
  const yours = interaction.options.getString('move', true);
  const beats = { rock: 'scissors', paper: 'rock', scissors: 'paper' };
  let outcome, tone;
  if (mine === yours) {
    outcome = 'Draw — great minds throw the same punch';
    tone = 0xfee75c;
  } else if (beats[yours] === mine) {
    outcome = `You win — ${yours} beats ${mine}`;
    tone = 0x57f287;
  } else {
    outcome = `I win — ${mine} beats ${yours}`;
    tone = 0xed4245;
  }
  return interaction.reply({
    flags: V2 | MessageFlags.Ephemeral,
    components: [
      card({
        accent: tone,
        emoji: '✊',
        title: outcome,
        body: [diffBlock({ add: [`you: ${yours}`, `me: ${mine}`], max: 200 })],
      }),
    ],
  });
}

/* ---------------- duel ---------------- */

function runDuel(interaction) {
  const a = interaction.options.getString('challenger1', true).trim();
  const b = interaction.options.getString('challenger2', true).trim();
  const winner = randInt(2) === 0 ? a : b;
  const margin = randInt(40) + 60;
  return interaction.reply({
    flags: V2 | MessageFlags.Ephemeral,
    components: [
      card({
        emoji: '⚔️',
        title: `${winner} wins`,
        body: [
          bar(margin, 12),
          diffBlock({ add: [`🏆 ${winner}`], del: [winner === a ? b : a], max: 300 }),
          '-# margin is vibe-based — no fighters were harmed',
        ],
      }),
    ],
  });
}
