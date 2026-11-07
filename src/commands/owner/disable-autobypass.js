import { SlashCommandBuilder, ChannelType, MessageFlags } from 'discord.js';
import { store } from '../../storage.js';
import { V2, card } from '../../components.js';

export default {
  data: new SlashCommandBuilder()
    .setName('disable-autobypass')
    .setDescription('Disarm auto-bypass in a channel (bot owner only)')
    .addChannelOption((o) =>
      o
        .setName('channel')
        .setDescription('Channel to disarm (default: this one)')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    )
    .setContexts(1), // InteractionContextType.Guild
  ownerOnly: true,
  meta: { cooldownMs: 1000 },

  async execute(interaction) {
    const channel = interaction.options.getChannel('channel') ?? interaction.channel;
    const armed = store.autobypassChannels(interaction.guild.id);
    const wasArmed = armed.includes(channel.id);

    store.autobypassDisable(interaction.guild.id, channel.id);

    await interaction.reply({
      flags: V2 | MessageFlags.Ephemeral,
      components: [
        card({
          accent: 0x2b2d31,
          emoji: '🔇',
          title: wasArmed ? 'Auto-bypass disarmed' : 'Auto-bypass was not armed',
          body: [
            `<#${channel.id}> will no longer auto-bypass posted links.`,
            `**Armed channels remaining** — ${store.totalAutobypassChannels()}.`,
          ],
        }),
      ],
    });
  },
};
