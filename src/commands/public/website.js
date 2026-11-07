import { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { config } from '../../config.js';
import { V2, card } from '../../components.js';

export default {
  data: new SlashCommandBuilder()
    .setName('website')
    .setDescription('Open the official BypassX website — bypass in the browser too'),
  meta: { cooldownMs: 3000 },

  async execute(interaction) {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setURL(config.apiUrl).setLabel('Open BypassX').setEmoji('🌐').setStyle(ButtonStyle.Link)
    );

    await interaction.reply({
      flags: V2,
      components: [
        card({
          emoji: '🌐',
          title: 'BypassX Website',
          subtitle: 'The same official API, in your browser',
          body: [
            'Paste any supported gated link on the site and get the destination instantly — no Discord required.',
            '-# The bot and the website share one official API, so support for services is always in sync.',
          ],
          rows: [row],
        }),
      ],
    });
  },
};
