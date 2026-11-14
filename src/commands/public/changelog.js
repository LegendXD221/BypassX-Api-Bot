import { SlashCommandBuilder } from 'discord.js';
import { config } from '../../config.js';
import { V2, card } from '../../components.js';
import { diffStatus, codeBlock } from '../../format.js';

/** Bot changelog — mirrors the repo's WORKLOG highlights. */
export default {
  data: new SlashCommandBuilder()
    .setName('changelog')
    .setDescription('What changed in the bot lately'),
  meta: { cooldownMs: 3000 },

  async execute(interaction) {
    await interaction.reply({
      flags: V2,
      components: [
        card({
          emoji: '📜',
          title: `Changelog — v${config.version}`,
          body: [
            diffStatus({
              title: ['v2.0.0 — the power update'],
              ok: [
                'auto-bypass v2 — self-cleaning: result card & link message deleted 60s after each bypass, announcement posted in the channel when /enable-autobypass arms it',
                'message formats: ```diff``` green/red blocks + ```ansi``` live panels everywhere',
                'owner dashboard v2 — redesigned console, 55+ actions, live stats',
                '/bx suite — batch×5, key systems, multi-check, last-rerun, suggest',
                '/utility · /fun · /server · /info suites + 14 new commands',
                '/poll button polls, /reminder DM timers, /history reruns, /leaderboard',
              ],
              warn: [],
              max: 1200,
            }),
            codeBlock('diff', `+ 100+ total commands now shipped\n+ formats: diff · ansi · json · bash · http · ml tables\n- v1.x limitations removed: the wall of plain-text embeds is gone`),
          ],
          footerText: 'the worklog lives with the owner — /feedback asks anything',
        }),
      ],
    });
  },
};
