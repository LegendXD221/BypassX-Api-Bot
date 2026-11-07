import { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { inviteUrl, config } from '../../config.js';
import { V2, card } from '../../components.js';

export default {
  data: new SlashCommandBuilder()
    .setName('support')
    .setDescription('Get help with BypassX Api'),
  meta: { cooldownMs: 2000 },

  async execute(interaction) {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setURL(`${config.repoUrl}/issues`)
        .setLabel('Report an issue')
        .setEmoji('🐞')
        .setStyle(ButtonStyle.Link),
      new ButtonBuilder()
        .setURL(config.apiUrl)
        .setLabel('BypassX website')
        .setEmoji('🌐')
        .setStyle(ButtonStyle.Link)
    );

    if (config.supportServerUrl) {
      row.addComponents(
        new ButtonBuilder()
          .setURL(config.supportServerUrl)
          .setLabel('Support server')
          .setEmoji('💬')
          .setStyle(ButtonStyle.Link)
      );
    }

    await interaction.reply({
      flags: V2,
      components: [
        card({
          emoji: '🛟',
          title: 'Need a hand?',
          subtitle: 'BypassX Api — support',
          body: [
            '**Quick fixes**\n• A link failed? Hit the **🔁 Try Again** button — paced key systems sometimes need a rerun.\n• Not sure if a service is supported? Check `/services`.\n• Curious about the bot health? `/stats` and `/ping` tell all.',
            '**Still stuck?** Report it on GitHub with the link you tried and the error message — it gets fixed fast.',
          ],
          rows: [row],
        }),
      ],
    });
  },
};
