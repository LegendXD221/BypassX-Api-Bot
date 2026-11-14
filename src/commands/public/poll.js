import { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { V2, card, errorContainer } from '../../components.js';
import { truncate } from '../../util.js';
import { issueToken } from '../../tokens.js';

/** Button-based quick poll — up to 4 options, 24h window, live tallies. */
const POLLS = new Map(); // token -> { question, options: [ { label, votes:Set } ], owner }

const LETTERS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣'];

export default {
  data: new SlashCommandBuilder()
    .setName('poll')
    .setDescription('Create a button poll (up to 4 options)')
    .addStringOption((o) => o.setName('question').setDescription('The question').setRequired(true).setMaxLength(240))
    .addStringOption((o) => o.setName('option1').setDescription('Option 1').setRequired(true).setMaxLength(80))
    .addStringOption((o) => o.setName('option2').setDescription('Option 2').setRequired(true).setMaxLength(80))
    .addStringOption((o) => o.setName('option3').setDescription('Option 3').setMaxLength(80))
    .addStringOption((o) => o.setName('option4').setDescription('Option 4').setMaxLength(80))
    .addBooleanOption((o) => o.setName('multiple').setDescription('Allow voting on more than one option')),
  meta: { cooldownMs: 5000 },

  async execute(interaction) {
    const denied = interaction.member?.permissions?.has?.(PermissionFlagsBits.SendMessages);
    if (!denied) {
      return interaction.reply({
        flags: V2 | MessageFlags.Ephemeral,
        components: [errorContainer({ title: 'Cannot poll here', description: 'You need send permission in this channel to start a poll.' })],
      });
    }

    const question = interaction.options.getString('question', true);
    const options = [1, 2, 3, 4]
      .map((n) => interaction.options.getString(`option${n}`))
      .filter(Boolean)
      .slice(0, 4);
    const multiple = interaction.options.getBoolean('multiple') ?? false;
    if (options.length < 2) {
      return interaction.reply({
        flags: V2 | MessageFlags.Ephemeral,
        components: [errorContainer({ title: 'Need at least 2 options', description: 'Give at least option1 and option2.' })],
      });
    }

    const token = issueToken({ kind: 'poll' }, 24 * 3600_000);
    POLLS.set(token, {
      question,
      multiple,
      owner: interaction.user.id,
      options: options.map((label) => ({ label, votes: new Set() })),
    });

    await interaction.reply({
      flags: V2,
      components: [
        card({
          accent: 0x5865f2,
          emoji: '🗳️',
          title: truncate(question, 100),
          subtitle: `by ${interaction.user.username} · ${multiple ? 'pick all that apply' : 'one choice'} · ends <t:${Math.floor((Date.now() + 24 * 3600_000) / 1000)}:R>`,
          body: [options.map((o, i) => `${LETTERS[i]} **${o}** — 0 votes`).join('\n')],
          rows: [
            new ActionRowBuilder().addComponents(
              ...options.map((_, i) =>
                new ButtonBuilder()
                  .setCustomId(`bxpoll:${token}:${i}`)
                  .setLabel(`Option ${i + 1}`)
                  .setEmoji(LETTERS[i])
                  .setStyle(ButtonStyle.Secondary)
              )
            ),
          ],
          footerText: 'tap to vote — the card updates live',
        }),
      ],
    });
  },
};

export async function handlePollButton(interaction) {
  const [, token, idxRaw] = interaction.customId.split(':');
  const poll = POLLS.get(token);
  if (!poll) {
    return interaction.reply({
      flags: V2 | MessageFlags.Ephemeral,
      components: [errorContainer({ title: 'Poll ended', description: 'This poll expired (24h window).' })],
    });
  }
  const idx = Number.parseInt(idxRaw, 10);
  if (!Number.isInteger(idx) || idx < 0 || idx >= poll.options.length) return;
  const opt = poll.options[idx];
  const uid = interaction.user.id;

  if (poll.multiple) {
    opt.votes.has(uid) ? opt.votes.delete(uid) : opt.votes.add(uid);
  } else {
    const already = poll.options.some((o) => o.votes.has(uid));
    if (already) {
      return interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: 'You already voted — this is a single-choice poll.',
      });
    }
    opt.votes.add(uid);
  }

  const total = poll.options.reduce((n, o) => n + o.votes.size, 0);
  const lines = poll.options.map((o, i) => {
    const bar = '▰'.repeat(Math.round((o.votes.size / Math.max(1, total)) * 10)).padEnd(10, '▱');
    return `${LETTERS[i]} **${o.label}** — ${o.votes.size} vote${o.votes.size === 1 ? '' : 's'}\n\`${bar}\``;
  });

  await interaction.update({
    components: [
      card({
        accent: 0x5865f2,
        emoji: '🗳️',
        title: truncate(poll.question, 100),
        subtitle: `${total} vote${total === 1 ? '' : 's'} so far · ${poll.multiple ? 'multi-choice' : 'single choice'}`,
        body: [lines.join('\n\n')],
        footerText: 'tap to vote — the card updates live',
      }),
    ],
  });
}
