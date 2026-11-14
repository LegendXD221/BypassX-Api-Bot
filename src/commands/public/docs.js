import { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { config } from '../../config.js';
import { V2, card } from '../../components.js';
import { codeBlock } from '../../format.js';

/** The API door — quick start for developers. */
export default {
  data: new SlashCommandBuilder()
    .setName('docs')
    .setDescription('API quick-start — run bypasses from your own code'),
  meta: { cooldownMs: 3000 },

  async execute(interaction) {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setURL(`${config.apiUrl}/docs`).setLabel('Full API docs').setEmoji('📘').setStyle(ButtonStyle.Link),
      new ButtonBuilder().setURL(config.apiUrl).setLabel('BypassX Website').setEmoji('🌐').setStyle(ButtonStyle.Link)
    );

    const curl = codeBlock(
      'bash',
      `curl -X POST ${config.apiUrl}/api/owner \\\n  -H "x-api-key: YOUR_KEY" \\\n  -H "content-type: application/json" \\\n  -d '{"url":"https://linkvertise.com/…"}'`
    );

    await interaction.reply({
      flags: V2,
      components: [
        card({
          emoji: '🧑‍💻',
          title: 'BypassX API — quick start',
          subtitle: 'one POST, one destination — the same engine this bot uses',
          body: [
            '**Owner API (key-gated)** — ask the owner for a key, then:',
            curl,
            '**Public supported registry** — no key needed:\n`GET ' + config.apiUrl + '/api/supported`',
            '-# The public bypass endpoint is rate-limited and honest about every wall it hits.',
          ],
          rows: [row],
        }),
      ],
    });
  },
};
