import { SlashCommandBuilder, MessageFlags, InteractionContextType } from 'discord.js';
import { store } from '../../db.js';
import { V2, card } from '../../components.js';

/**
 * Public read-only status of auto-bypass in this server.
 * Everyone may view it; only server owners / admins can change anything.
 */
export default {
  data: new SlashCommandBuilder()
    .setName('autobypass')
    .setDescription('Show which channels in this server have auto-bypass armed')
    .setContexts(InteractionContextType.Guild), // guild-only — server owners manage it there
  meta: { cooldownMs: 2000 },

  async execute(interaction) {
    const channels = store.autobypassChannels(interaction.guild.id);

    const lines = channels.length
      ? channels.map((c) => `> <#${c}>`).join('\n')
      : [
          '> No channels armed in this server yet.',
          '> Server owners and admins can arm one with `/enable-autobypass`.',
        ].join('\n');

    await interaction.reply({
      flags: V2 | MessageFlags.Ephemeral,
      components: [
        card({
          emoji: '📡',
          title: 'Auto-bypass — this server',
          subtitle: `${channels.length} channel${channels.length === 1 ? '' : 's'} armed · bot-wide ${store.totalAutobypassChannels()} across ${store.autobypassGuildCount()} server${store.autobypassGuildCount() === 1 ? '' : 's'}`,
          body: [
            lines,
            '-# Supported links posted in armed channels are bypassed automatically · result card & link message self-delete after 60s · failures post a quick error card, also self-cleaning',
          ],
        }),
      ],
    });
  },
};
