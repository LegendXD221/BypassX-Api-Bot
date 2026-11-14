import { SlashCommandBuilder } from 'discord.js';
import { config } from '../../config.js';
import { V2, card, statusPanel } from '../../components.js';
import { formatUptime } from '../../util.js';

/** Tiny uptime card — quick "is it alive" check with a diff panel. */
export default {
  data: new SlashCommandBuilder()
    .setName('uptime')
    .setDescription('How long the bot has been running'),
  meta: { cooldownMs: 2000 },

  async execute(interaction) {
    await interaction.reply({
      flags: V2,
      components: [
        card({
          emoji: '⏱️',
          title: 'Uptime',
          body: [
            statusPanel(
              [
                ['uptime', formatUptime(process.uptime()), 'ok'],
                ['version', `v${config.version}`, 'info'],
                ['node', process.version, 'info'],
                ['memory', `${Math.round(process.memoryUsage().rss / 1048576)} MB`, 'info'],
              ],
              { title: 'RUNTIME' }
            ),
          ],
        }),
      ],
    });
  },
};
