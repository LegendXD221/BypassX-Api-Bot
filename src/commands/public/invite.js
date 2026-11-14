import { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { inviteUrl } from '../../config.js';
import { V2, card } from '../../components.js';

export default {
  data: new SlashCommandBuilder()
    .setName('invite')
    .setDescription('Invite BypassX Api to your server'),
  meta: { cooldownMs: 2000 },

  async execute(interaction) {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setURL(inviteUrl(interaction.client.user.id))
        .setLabel('Invite BypassX Api')
        .setEmoji('🚀')
        .setStyle(ButtonStyle.Link)
    );

    await interaction.reply({
      flags: V2,
      components: [
        card({
          emoji: '🚀',
          title: 'Invite BypassX Api',
          body: [
            'Add the bot to your server and bypass gated links with a single command.',
            'Permissions needed: View Channel, Send Messages, Read Message History, Add Reactions — plus the **Message Content** intent (for auto-bypass). **Manage Messages** is optional but recommended: it lets auto-bypass clean up link posts 60s after the result.',
          ],
          rows: [row],
        }),
      ],
    });
  },
};
