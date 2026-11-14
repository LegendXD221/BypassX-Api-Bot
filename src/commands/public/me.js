import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { store } from '../../db.js';
import { V2, card } from '../../components.js';
import { bar, diffBlock } from '../../format.js';

/** Personal, privacy-friendly usage stats for the requesting user. */
export default {
  data: new SlashCommandBuilder()
    .setName('me')
    .setDescription('Your personal BypassX usage — totals, success rate, favourite service'),
  meta: { cooldownMs: 3000 },

  async execute(interaction) {
    // Defer FIRST — a Neon cold start can blow the 3s ack window.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const stats = await store.userStats(interaction.user.id);

    const body = stats
      ? [
          `**Lifetime** ${bar(stats.successRate)}\n${stats.total} bypass${stats.total === 1 ? '' : 'es'} · ${stats.successRate}% success`,
          `**Recent**\n${stats.last24h} in the last 24 hours · ${stats.last7d} in the last 7 days`,
          stats.favorite
            ? diffBlock({ info: ['favourite service'], add: [stats.favorite], max: 300 })
            : null,
          `-# Run \`/bypass url:\` or right-click a message → **Bypass Link** to add to this.`,
        ]
      : [
          'No bypass history for you yet — the database has not seen a successful bypass from your account.',
          '**Get started**\n`/bypass url:` any supported gated link, or right-click a message → **Bypass Link**.',
          '-# History needs the database connection to be online; check `/stats` for bot-wide numbers.',
        ];

    await interaction.editReply({
      components: [card({ emoji: '👤', title: `Your stats — ${interaction.user.username}`, body })],
    });
  },
};
