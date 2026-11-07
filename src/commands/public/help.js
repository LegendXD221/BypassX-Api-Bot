import { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { inviteUrl, config } from '../../config.js';
import { V2, card } from '../../components.js';

export default {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Everything BypassX Api can do'),
  meta: { cooldownMs: 2000 },

  async execute(interaction) {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setURL(inviteUrl(interaction.client.user.id))
        .setLabel('Invite BypassX Api')
        .setEmoji('🚀')
        .setStyle(ButtonStyle.Link),
      new ButtonBuilder()
        .setURL(config.repoUrl)
        .setLabel('Source')
        .setEmoji('📂')
        .setStyle(ButtonStyle.Link)
    );

    const body = [
      `**Everyone**\n**/bypass** \`url\` — bypass a supported gated link\n**Bypass Link** — right-click any message → Apps\n**/services** \`search\` — browse all supported services\n**/stats** — live bot & API statistics\n**/ping** — latency check\n**/invite** · **/help**`,
      `**Server admins**\n**/enable-autobypass** \`channel\` \`channels\` — auto-bypass supported links posted in channels\n**/disable-autobypass** \`channel\` \`channels\` \`all\` — disarm channels (or everything)\n**/autobypass** — see what is armed in this server`,
      `**Bot owner**\n**/owner** — eval · stats · logs · maintenance · servers · leave · presence · broadcast · dm · blacklist · api · cache · cooldown · reboot`,
      `-# Tip: results come with **📱 Mobile Copy**, **💻 PC Copy** and **🔗 Open Result** buttons. Paced key systems (Delta…) may pause for a one-time sign-in — the bot walks you through it.`,
    ];

    await interaction.reply({
      flags: V2,
      components: [
        card({
          emoji: '🧭',
          title: 'BypassX Api — Help',
          subtitle: 'Bypass gated links straight in Discord, powered by the official BypassX API',
          body,
          rows: [row],
        }),
      ],
    });
  },
};
