import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { config } from '../../config.js';
import { truncate } from '../../util.js';
import { store } from '../../db.js';
import { V2, card, errorContainer, feedbackContainer } from '../../components.js';

/**
 * User feedback → persisted in Postgres and DM'd to every bot owner.
 * Rate-limited hard (60s), never pings anyone, content length-capped.
 */
export default {
  data: new SlashCommandBuilder()
    .setName('feedback')
    .setDescription('Send feedback, bug reports or ideas straight to the bot owner')
    .addStringOption((o) =>
      o
        .setName('message')
        .setDescription('What do you want to tell the owner? Bug reports get fixed faster with the link you tried.')
        .setRequired(true)
        .setMaxLength(1000)
    ),
  meta: { cooldownMs: 60_000 },

  async execute(interaction) {
    const message = interaction.options.getString('message', true).trim();
    if (message.length < 3) {
      return interaction.reply({
        flags: V2 | MessageFlags.Ephemeral,
        components: [
          errorContainer({
            title: 'A little more detail, please',
            description: 'Write at least a few characters so the feedback is actionable.',
          }),
        ],
      });
    }

    const entry = {
      from: interaction.user.tag ?? interaction.user.username,
      userId: interaction.user.id,
      guild: interaction.guild?.name ?? null,
      message: truncate(message, 1000),
      at: new Date().toISOString(),
    };

    // Persist first — DM delivery is best-effort on top.
    store.appendFeedback(entry);

    let delivered = 0;
    for (const id of config.ownerIds) {
      const owner = await interaction.client.users.fetch(id).catch(() => null);
      if (!owner) continue;
      try {
        await owner.send({
          flags: V2,
          components: [feedbackContainer(entry)],
          allowedMentions: { parse: [] },
        });
        delivered += 1;
      } catch {
        /* owner DMs closed — the stored copy keeps it safe */
      }
    }

    return interaction.reply({
      flags: V2 | MessageFlags.Ephemeral,
      components: [
        card({
          accent: config.colors.success,
          emoji: '📝',
          title: 'Feedback sent',
          body: [
            '**Thanks!** Your note is on its way to the bot owner.',
            delivered ? null : '*Direct message was not possible right now — your feedback is stored and will not get lost.*',
            '-# Misuse of this command gets you blacklisted — keep it useful.',
          ],
        }),
      ],
    });
  },
};
