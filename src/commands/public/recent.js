import { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { store } from '../../db.js';
import { issueToken } from '../../tokens.js';
import { truncate, ago } from '../../util.js';
import { V2, card, errorContainer } from '../../components.js';

const MAX_ITEMS = 5;

/**
 * Your recent successful bypasses — each with a one-tap "run again" button
 * (result comes back ephemerally, only visible to whoever clicked).
 */
export default {
  data: new SlashCommandBuilder()
    .setName('recent')
    .setDescription('Your recent successful bypasses — rerun any of them with one tap'),
  meta: { cooldownMs: 4000 },

  async execute(interaction) {
    const rows = await store.recentLogs({ userId: interaction.user.id, limit: 15 });
    const seen = new Set();
    const items = [];
    for (const r of rows) {
      if (!r.success || !r.url || seen.has(r.url)) continue;
      seen.add(r.url);
      items.push(r);
      if (items.length >= MAX_ITEMS) break;
    }

    if (!items.length) {
      return interaction.reply({
        flags: V2 | MessageFlags.Ephemeral,
        components: [
          errorContainer({
            title: 'Nothing here yet',
            description:
              'You have no successful bypasses recorded.\n\n**Get started**\n`/bypass url:` any supported gated link, or right-click a message → **Bypass Link**.',
          }),
        ],
      });
    }

    const lines = items.map((r, i) => {
      let host = 'link';
      try {
        host = new URL(r.url).hostname;
      } catch {
        /* keep fallback */
      }
      return `**${i + 1}.** \`${host}\` · ${ago(r.created_at)}\n> ${truncate(r.url, 110)}`;
    });

    const row = new ActionRowBuilder();
    items.forEach((r, i) => {
      const token = issueToken({ kind: 'rerun', url: r.url, userId: interaction.user.id }, 30 * 60_000);
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`bxrerun:${token}`)
          .setLabel(`Run #${i + 1}`)
          .setEmoji('⚡')
          .setStyle(ButtonStyle.Secondary)
      );
    });

    await interaction.reply({
      flags: V2,
      components: [
        card({
          emoji: '🕘',
          title: 'Your recent bypasses',
          subtitle: 'tap ⚡ to run one again — the new result is only visible to you',
          body: [lines.join('\n')],
          rows: [row],
          footerText: 'newest first · results are also re-cached when rerun',
        }),
      ],
    });
  },
};
