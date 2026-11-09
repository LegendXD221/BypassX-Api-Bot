import { SlashCommandBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { store } from '../../db.js';
import { V2, card, errorContainer } from '../../components.js';
import { issueToken } from '../../tokens.js';
import { truncate } from '../../util.js';
import { diffStatus } from '../../format.js';

/** Personal history with a domain filter and one-tap reruns. */
export default {
  data: new SlashCommandBuilder()
    .setName('history')
    .setDescription('Your bypass history — filter by domain, rerun anything')
    .addStringOption((o) => o.setName('domain').setDescription('Filter: e.g. linkvertise, boostylink…').setMaxLength(80))
    .addIntegerOption((o) => o.setName('limit').setDescription('How many 1-10 (default 8)').setMinValue(1).setMaxValue(10)),
  meta: { cooldownMs: 3000 },

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const domain = interaction.options.getString('domain');
    const limit = interaction.options.getInteger('limit') ?? 8;
    const rows = await store.userHistory(interaction.user.id, { domain, limit }).catch(() => []);
    if (!rows.length) {
      return interaction.editReply({
        flags: V2 | MessageFlags.Ephemeral,
        components: [
          errorContainer({
            title: 'No history',
            description: domain
              ? `Nothing matching **${domain}** yet.`
              : 'You have no bypass history yet — run `/bypass url:` first.',
          }),
        ],
      });
    }

    const okRows = rows.filter((r) => r.success).map((r) => `${truncate(r.domain ?? r.url, 40)} → ok ${r.created_at ? `<t:${Math.floor(new Date(r.created_at).getTime() / 1000)}:R>` : ''}`);
    const failRows = rows.filter((r) => !r.success).map((r) => `${truncate(r.domain ?? r.url, 40)} — ${truncate(r.error ?? 'failed', 60)}`);

    const rerunnable = rows.filter((r) => r.success && r.url).slice(0, 5);
    const row = rerunnable.length
      ? new ActionRowBuilder().addComponents(
          ...rerunnable.map((r, i) => {
            const token = issueToken({ kind: 'rerun', url: r.url, userId: interaction.user.id }, 15 * 60_000);
            return new ButtonBuilder()
              .setCustomId(`bxrerun:${token}`)
              .setLabel(`rerun ${i + 1}`)
              .setEmoji('🔁')
              .setStyle(ButtonStyle.Secondary);
          })
        )
      : null;

    return interaction.editReply({
      flags: V2 | MessageFlags.Ephemeral,
      components: [
        card({
          emoji: '🕘',
          title: 'Your history',
          subtitle: `${rows.length} entr${rows.length === 1 ? 'y' : 'ies'}${domain ? ` · filter ${domain}` : ''}`,
          body: [diffStatus({ ok: okRows, fail: failRows, title: 'latest first', max: 1500 })],
          rows: [row],
          footerText: 'rerun buttons valid for 15 minutes — only you can press them',
        }),
      ],
    });
  },
};
