import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { V2, card } from '../../components.js';
import { bullets } from '../../format.js';

/** The FAQ — answers to the questions that keep coming back. */
const QA = [
  ['What is a bypass?', 'Some links hide the real destination behind ad-walls, key systems or countdowns. BypassX walks those chains server-side and hands you the final link (or key) directly.'],
  ['Why is my link not supported?', 'The service registry covers 40+ families. If yours is missing, suggest it — /bx suggest sends it straight to the owner.'],
  ['Why do key systems take so long?', 'Sites like Delta enforce paced steps and sometimes a one-time sign-in. The bot waits them out and walks you through any human step.'],
  ['What do the three result buttons do?', '📱 Mobile Copy long-presses better, 💻 PC Copy one-clicks, 🔗 Open Result opens the destination.'],
  ['Is this legal?', 'The bot only automates what your browser would do anyway on public pages. It never touches accounts you do not own or paid walls.'],
  ['Who can see my links?', 'Everyone in the channel sees the result (use hidden:true for private runs). Logs keep your ID + the domain for stats — details in /privacy.'],
];

export default {
  data: new SlashCommandBuilder()
    .setName('faq')
    .setDescription('Answers to the most common questions'),
  meta: { cooldownMs: 3000 },

  async execute(interaction) {
    await interaction.reply({
      flags: V2,
      components: [
        card({
          emoji: '❓',
          title: 'FAQ',
          subtitle: 'the questions that keep coming back',
          body: [bullets(QA.map(([q, a]) => `**${q}**\n${a}`), { max: 10 })],
          footerText: 'still stuck? /support or /feedback',
        }),
      ],
    });
  },
};
