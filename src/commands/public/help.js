import { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { inviteUrl, config } from '../../config.js';
import { V2, card } from '../../components.js';
import { diffStatus, codeBlock } from '../../format.js';
import { categorize, countInvokables, CATEGORY_META } from '../catalog.js';

export default {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Everything BypassX Api can do — 100+ commands'),
  meta: { cooldownMs: 2000 },

  async execute(interaction) {
    const groups = categorize(interaction.client.commands);
    const total = [...groups.values()].reduce((n, list) => n + list.length, 0);

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

    const lines = Object.entries(CATEGORY_META)
      .filter(([cat]) => groups.has(cat))
      .map(([cat, meta]) => {
        const names = groups.get(cat).map((c) => `/${c.name}`);
        const head = `${meta.emoji} **${meta.label}** (${names.length})`;
        return `${head}\n${names.join(' · ')}`;
      });

    await interaction.reply({
      flags: V2,
      components: [
        card({
          emoji: '🧭',
          title: 'BypassX Api — Help',
          subtitle: `${total} top-level commands · ${countInvokables(interaction.client.commands)} invokable actions · filterable with /commands`,
          body: [
            lines.join('\n\n'),
            diffStatus({
              info: ['start here'],
              add: ['/bypass url: — the core move', 'right-click → Apps → Bypass Link — the zero-typing move', '/commands category: — full catalog view'],
              max: 500,
            }),
            codeBlock(
              'diff',
              `+ results render in diff blocks: green = landed, red = failed\n+ /bx batch chains 5 links · /bx last re-runs your previous one\n-# hidden:true keeps any result private to you`
            ),
            '-# Tip: paced key systems (Delta…) may pause for a one-time sign-in — the bot walks you through it.',
          ],
          rows: [row],
        }),
      ],
    });
  },
};
