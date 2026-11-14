import { SlashCommandBuilder } from 'discord.js';
import { V2, card } from '../../components.js';

const TIPS = [
  'Right-click a message → Apps → **Bypass Link** bypasses without typing anything.',
  '/bx batch runs **5 links in one command** — the fastest way to clear a hub page.',
  'hidden:true on /bypass keeps the result private to you.',
  'Armed auto-bypass channels bypass every supported link posted there — zero commands needed.',
  '/bx last re-runs your most recent link instantly.',
  'Paced key systems (Delta…) sometimes pause — hit **Try Again**, a rerun usually finishes the chain.',
  'The result card carries **📱 Mobile Copy** for long-press and **💻 PC Copy** for one-click.',
  '/history filters your own logs by domain and gives one-tap rerun buttons.',
  '/timestamp builds live-updating dates for event posts.',
  '/leaderboard ranks successful bypasses — the numbers come from the same logs as /stats.',
  'Use /check before pasting a wall of links — it tells you which ones the API can attempt.',
  '/support reaches the community; /bx suggest reaches the owner directly.',
];

/** One rotating tip per invocation — deterministic shuffle. */
export default {
  data: new SlashCommandBuilder()
    .setName('tip')
    .setDescription('A random power tip'),
  meta: { cooldownMs: 1500 },

  async execute(interaction) {
    const tip = TIPS[Math.floor(Math.random() * TIPS.length)];
    await interaction.reply({
      flags: V2,
      components: [
        card({
          emoji: '💡',
          title: 'Did you know',
          body: [tip, '-# /shortcuts has the full cheat sheet'],
        }),
      ],
    });
  },
};
