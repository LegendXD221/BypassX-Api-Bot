import { SlashCommandBuilder, ChannelType, MessageFlags, PermissionsBitField } from 'discord.js';
import { store } from '../../storage.js';
import { V2, card, errorContainer } from '../../components.js';

export default {
  data: new SlashCommandBuilder()
    .setName('enable-autobypass')
    .setDescription('Auto-bypass supported links posted in a channel (bot owner only)')
    .addChannelOption((o) =>
      o
        .setName('channel')
        .setDescription('Channel to arm (default: this one)')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    )
    .setContexts(1), // InteractionContextType.Guild
  ownerOnly: true,
  meta: { cooldownMs: 1000 },

  async execute(interaction) {
    const channel = interaction.options.getChannel('channel') ?? interaction.channel;
    const me = interaction.guild.members.me;

    const perms = channel.permissionsFor(me);
    if (!perms?.has(PermissionsBitField.Flags.ViewChannel) || !perms?.has(PermissionsBitField.Flags.SendMessages)) {
      return interaction.reply({
        flags: V2 | MessageFlags.Ephemeral,
        components: [
          errorContainer({
            title: 'Missing permissions',
            description: `I need **View Channel** and **Send Messages** in <#${channel.id}> before I can auto-bypass there.`,
          }),
        ],
      });
    }

    const already = store.autobypassChannels(interaction.guild.id).includes(channel.id);
    store.autobypassEnable(interaction.guild.id, channel.id);

    await interaction.reply({
      flags: V2 | MessageFlags.Ephemeral,
      components: [
        card({
          accent: 0x57f287,
          emoji: '⚡',
          title: already ? 'Auto-bypass already armed' : 'Auto-bypass armed',
          body: [
            `Supported gated links posted in <#${channel.id}> are now bypassed automatically.`,
            `**How it works** — unknown links are ignored silently · one bypass per channel every 8s · failures react ❌ instead of spamming.`,
            `**Armed channels** — ${store.totalAutobypassChannels()} total. Disarm anytime with \`/disable-autobypass\`.`,
          ],
        }),
      ],
    });
  },
};
