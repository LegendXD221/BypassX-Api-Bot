import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { config } from '../../config.js';
import { bypassUrl, ApiError, cacheGet, cacheSet } from '../../api.js';
import { isHttpUrl, truncate } from '../../util.js';
import { store } from '../../storage.js';
import { V2, resultContainer, oauthContainer, errorContainer } from '../../components.js';

export default {
  data: new SlashCommandBuilder()
    .setName('bypass')
    .setDescription('Bypass a supported gated link via the official BypassX API')
    .addStringOption((o) =>
      o.setName('url').setDescription('The gated link to bypass').setRequired(true)
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

    const raw = interaction.options.getString('url', true).trim().replace(/^<|>$/g, '');
    const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;

    if (!isHttpUrl(url)) {
      return interaction.reply({
        flags: V2 | MessageFlags.Ephemeral,
        components: [
          errorContainer({
            title: 'Invalid link',
            description: `\`${truncate(raw, 90)}\` is not a valid URL.\n\n**Example**\n\`/bypass url:https://linkvertise.com/1234/name\``,
          }),
        ],
      });
    }

    await interaction.deferReply();

    const cached = cacheGet(url);
    let result;
    let wasCached = false;
    if (cached) {
      result = cached;
      wasCached = true;
    } else {
      try {
        result = await bypassUrl(url);
      } catch (e) {
        store.bump('failures');
        const description =
          e instanceof ApiError
            ? e.message
            : 'Something went wrong while contacting the BypassX API.';
        return interaction.editReply({
          components: [
            errorContainer({
              title: e?.code === 'UNAUTHORIZED' ? 'API key rejected' : 'Bypass failed',
              description,
              retryUrl: e?.code === 'NO_KEY' ? null : url,
              retryUserId: interaction.user.id,
            }),
          ],
          flags: V2,
        });
      }
      cacheSet(url, result);
    }
    store.bump('bypasses');

    if (result.kind === 'oauth') {
      return interaction.editReply({
        components: [
          oauthContainer({
            siteName: result.serviceName,
            action: result.action,
            note: result.note,
            sourceUrl: url,
            userId: interaction.user.id,
          }),
        ],
        flags: V2,
      });
    }

    await interaction.editReply({
      components: [resultContainer({ sourceUrl: url, result, auto: false })],
      flags: V2,
    });
  },
};
