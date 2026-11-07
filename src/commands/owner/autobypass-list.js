import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { store } from '../../storage.js';
import { V2, card } from '../../components.js';

export default {
  data: new SlashCommandBuilder()
    .setName('autobypass-list')
    .setDescription('List every channel with auto-bypass armed (bot owner only)')
    .setContexts(1), // InteractionContextType.Guild
  ownerOnly: true,
  meta: { cooldownMs: 1000 },

  async execute(interaction) {
    const here = store.autobypassChannels(interaction.guild.id);
    const total = store.totalAutobypassChannels();
    const servers = Object.keys(store.autobypass).length;

    const lines = here.length
      ? here.map((c) => `> <#${c}>`)
      : ['> None armed in this server yet — use `/enable-autobypass`.'];

    await interaction.reply({
      flags: V2 | MessageFlags.Ephemeral,
      components: [
        card({
          emoji: '📡',
          title: 'Auto-bypass channels',
          subtitle: `${total} armed across ${servers} server${servers === 1 ? '' : 's'}`,
          body: [lines.join('\n')],
        }),
      ],
    });
  },
};
