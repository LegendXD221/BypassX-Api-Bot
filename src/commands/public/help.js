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
        .setURL(config.apiUrl)
        .setLabel('BypassX Website')
        .setEmoji('🌐')
        .setStyle(ButtonStyle.Link)
    );

    const body = [
      `**Everyone**\n**/bypass** \`url\` \`[hidden]\` — bypass a supported gated link (hidden = only you see it)\n**Bypass Link** — right-click any message → Apps\n**/check** \`url\` — is this link supported? (no bypass, instant answer)\n**/services** \`search\` — browse all supported services\n**/stats** — live bot & API statistics · **/ping** — latency check\n**/botinfo** — about the bot · **/me** — your personal stats · **/userinfo** — user card\n**/serverinfo** — this server at a glance · **/website** — the official site\n**/invite** · **/help** · **/support** · **/feedback** — tell the owner anything`,
      `**Server admins**\n**/enable-autobypass** \`channel\` \`channels\` — auto-bypass supported links posted in channels\n**/disable-autobypass** \`channel\` \`channels\` \`all\` — disarm channels (or everything)\n**/autobypass** — see what is armed in this server`,
      `**Bot owner**\n**/owner** — eval · stats · logs · feedback · maintenance · servers · leave · presence · broadcast · dm · blacklist · api · cache · cooldown · refresh · sweep · reboot`,
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
