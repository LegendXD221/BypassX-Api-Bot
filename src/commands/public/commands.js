import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { V2, card, errorContainer } from '../../components.js';
import { diffStatus } from '../../format.js';
import { CATEGORY_META, categorize } from '../catalog.js';

/** /commands — the full command catalog, filterable by category. */
export default {
  data: new SlashCommandBuilder()
    .setName('commands')
    .setDescription('Every command, grouped — with a category filter')
    .addStringOption((o) =>
      o
        .setName('category')
        .setDescription('Which group to show')
        .addChoices(
          ...Object.entries(CATEGORY_META).map(([value, meta]) => ({ name: `${meta.emoji} ${meta.label}`, value }))
        )
    ),
  meta: { cooldownMs: 3000 },

  async execute(interaction) {
    const filter = interaction.options.getString('category');
    const groups = categorize(interaction.client.commands);
    const picks = filter ? [filter] : Object.keys(CATEGORY_META);

    const shown = picks
      .map((cat) => ({ cat, names: (groups.get(cat) ?? []).map((c) => c.name) }))
      .filter((g) => g.names.length);

    if (!shown.length) {
      return interaction.reply({
        flags: V2 | MessageFlags.Ephemeral,
        components: [errorContainer({ title: 'Nothing to show', description: 'That category is empty.' })],
      });
    }

    const total = shown.reduce((n, g) => n + g.names.length, 0);
    const blocks = shown.map((g) =>
      diffStatus({
        title: [`${CATEGORY_META[g.cat].label}`],
        ok: g.names.map((n) => `/${n}`),
        max: 1400,
      })
    );

    return interaction.reply({
      flags: V2 | MessageFlags.Ephemeral,
      components: [
        card({
          emoji: '🗂️',
          title: 'Command catalog',
          subtitle: `${total} top-level command${total === 1 ? '' : 's'}${filter ? '' : ' across every category'}`,
          body: blocks,
          footerText: 'details on any command: /help · usage counters feed the owner dashboard',
        }),
      ],
    });
  },
};
