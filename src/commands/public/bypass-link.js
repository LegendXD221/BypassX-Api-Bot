import { ContextMenuCommandBuilder, ApplicationCommandType, MessageFlags } from 'discord.js';
import { config } from '../../config.js';
import { extractUrls } from '../../util.js';
import { refreshSupported, matchService } from '../../api.js';
import { V2, errorContainer } from '../../components.js';
import { runBypass, normalizeBypassUrl } from './bypass-core.js';

/**
 * Right-click any message → Apps → "Bypass Link".
 * Picks the first supported link in the message (falls back to the first
 * http(s) link and lets the API decide).
 */
export default {
  data: new ContextMenuCommandBuilder()
    .setName('Bypass Link')
    .setType(ApplicationCommandType.Message),
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

    const content = interaction.targetMessage?.content ?? '';
    const urls = extractUrls(content).map(normalizeBypassUrl).filter(Boolean);
    if (!urls.length) {
      return interaction.reply({
        flags: V2 | MessageFlags.Ephemeral,
        components: [
          errorContainer({
            title: 'No link found',
            description: 'That message does not contain any http(s) link to bypass.',
          }),
        ],
      });
    }

    await refreshSupported();
    const target = urls.find((u) => matchService(u)) ?? urls[0];

    return runBypass({ interaction, url: target, source: 'message' });
  },
};
