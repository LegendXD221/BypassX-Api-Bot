import { SlashCommandBuilder } from 'discord.js';
import { V2, card } from '../../components.js';
import { diffBlock } from '../../format.js';

/** Honest data policy — what the bot stores and what it never touches. */
export default {
  data: new SlashCommandBuilder()
    .setName('privacy')
    .setDescription('What BypassX stores about you (and what it never stores)'),
  meta: { cooldownMs: 3000 },

  async execute(interaction) {
    await interaction.reply({
      flags: V2,
      components: [
        card({
          emoji: '🛡️',
          title: 'Privacy — the short version',
          body: [
            diffBlock({
              info: ['stored (database)'],
              add: [
                'bypass logs: user ID, server/channel ID, link domain, outcome',
                'per-command usage counters (no content, just counts)',
                'feedback/suggestions you actively send',
                'armed auto-bypass channels (server setting)',
              ],
              del: ['message content beyond the link you submit — never stored', 'DMs with the bot', 'anything from messages in unarmed channels'],
              max: 1100,
            }),
            '**Why the log rows exist:** personal stats (`/me`), rerun buttons (`/recent`, `/history`), abuse handling and the leaderboard. Server admins see only their own server; nothing is public except aggregate counts.',
            '-# Removal: ask the owner via `/feedback` — log rows are pruned on request, counters are anonymous.',
          ],
        }),
      ],
    });
  },
};
