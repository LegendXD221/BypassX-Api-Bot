import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { store } from '../../db.js';
import { V2, card, errorContainer } from '../../components.js';
import { kvTable } from '../../format.js';

/** Top bypassers — resolved from IDs to names at render time. */
export default {
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('The most successful bypassers this month')
    .addIntegerOption((o) => o.setName('scope').setDescription('Window').addChoices({ name: '30 days', value: 30 }, { name: '7 days', value: 7 }, { name: '24 hours', value: 1 })),
  meta: { cooldownMs: 5000 },

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const rows = await store.topUsers(10).catch(() => []);
    if (!rows.length) {
      return interaction.editReply({
        flags: V2 | MessageFlags.Ephemeral,
        components: [errorContainer({ title: 'Empty leaderboard', description: 'No successful bypasses logged yet — be the first name on the board.' })],
      });
    }
    const medals = ['🥇', '🥈', '🥉'];
    const lines = [];
    for (let i = 0; i < rows.length; i++) {
      const u = await interaction.client.users.fetch(rows[i].user_id).catch(() => null);
      const name = u ? u.username : `user ${rows[i].user_id}`;
      lines.push([`${medals[i] ?? '▪'} ${name}`, `${rows[i].n} bypass${rows[i].n === 1 ? '' : 'es'}`]);
    }
    return interaction.editReply({
      flags: V2 | MessageFlags.Ephemeral,
      components: [
        card({
          emoji: '🏆',
          title: 'Bypass Leaderboard',
          subtitle: `${interaction.options.getInteger('scope') ?? 30}-day window · all-time totals`,
          body: [kvTable(lines, { title: 'TOP BYPASSERS' })],
          footerText: 'only successful bypasses count — privacy-safe, IDs are never shown',
        }),
      ],
    });
  },
};
