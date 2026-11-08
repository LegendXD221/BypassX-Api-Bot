import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { config } from '../../config.js';
import { V2, errorContainer } from '../../components.js';
import { truncate } from '../../util.js';
import { runBypass, normalizeBypassUrl } from './bypass-core.js';

export default {
  data: new SlashCommandBuilder()
    .setName('bypass')
    .setDescription('Bypass a supported gated link via the official BypassX API')
    .addStringOption((o) =>
      o.setName('url').setDescription('The gated link to bypass').setRequired(true).setMaxLength(1024)
    )
    .addBooleanOption((o) =>
      o.setName('hidden').setDescription('Only you can see the result (default: off)')
    ),
  meta: { cooldownMs: 4000 },

  async execute(interaction) {
    if (!config.apiKey) {
      return interaction.reply({
        flags: V2 | MessageFlags.Ephemeral,
        components: [
          errorContainer({
            title: 'API not configured',
            description:
              'The bot owner has not set a **BypassX API key** yet, so bypasses are offline right now.',
          }),
        ],
      });
    }

    const url = normalizeBypassUrl(interaction.options.getString('url', true));
    if (!url) {
      return interaction.reply({
        flags: V2 | MessageFlags.Ephemeral,
        components: [
          errorContainer({
            title: 'Invalid link',
            description: `\`${truncate(interaction.options.getString('url', true), 90)}\` is not a valid URL.\n\n**Example**\n\`/bypass url:https://linkvertise.com/1234/name\``,
          }),
        ],
      });
    }

    return runBypass({
      interaction,
      url,
      source: 'command',
      hidden: interaction.options.getBoolean('hidden') ?? false,
    });
  },
};
