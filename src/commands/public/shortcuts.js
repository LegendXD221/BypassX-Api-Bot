import { SlashCommandBuilder } from 'discord.js';
import { V2, card } from '../../components.js';
import { codeBlock, diffBlock } from '../../format.js';

/** Power-user cheat sheet — the fast paths most people never notice. */
export default {
  data: new SlashCommandBuilder()
    .setName('shortcuts')
    .setDescription('Power-user cheat sheet — the fast paths'),
  meta: { cooldownMs: 3000 },

  async execute(interaction) {
    await interaction.reply({
      flags: V2,
      components: [
        card({
          emoji: '⚡',
          title: 'Power-user shortcuts',
          body: [
            diffBlock({
              info: ['speed tricks'],
              add: [
                'right-click any message → Apps → Bypass Link (no typing at all)',
                '/bx batch — 5 links in one command',
                '/bx last — instant re-run of your previous link',
                '/recent — rerun buttons for your last 5',
                'hidden:true on /bypass keeps results private',
                'armed channels auto-bypass every supported link posted (/enable-autobypass)',
              ],
              max: 1000,
            }),
            codeBlock('yaml', '# every result card carries the format stack:\ndiff:   "+ destination" — green highlight line\nansi:   live status panels (ping /status)\njson:   machine dumps (/owner api, /bx multicheck)'),
            '-# combine: /bypass url: … hidden:true → forward the Mobile Copy payload anywhere',
          ],
        }),
      ],
    });
  },
};
