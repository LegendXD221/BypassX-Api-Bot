import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { refreshSupported, supported } from '../../api.js';
import { V2, servicesContainer, errorContainer } from '../../components.js';
import { issueToken } from '../../tokens.js';

export const PAGE_SIZE = 10;

export function filterServices(query) {
  const all = supported.services;
  if (!query) return all;
  const q = String(query).toLowerCase();
  return all.filter(
    (s) =>
      s.name?.toLowerCase().includes(q) ||
      s.id?.toLowerCase().includes(q) ||
      (s.domains ?? []).some((d) => d.toLowerCase().includes(q))
  );
}

export default {
  data: new SlashCommandBuilder()
    .setName('services')
    .setDescription('Browse every service the BypassX API can bypass')
    .addStringOption((o) =>
      o.setName('search').setDescription('Filter by service name or domain').setRequired(false)
    ),
  meta: { cooldownMs: 3000 },

  async execute(interaction) {
    await refreshSupported();

    if (!supported.services.length) {
      return interaction.reply({
        flags: V2 | MessageFlags.Ephemeral,
        components: [
          errorContainer({
            title: 'Service list unavailable',
            description: 'Could not load the supported-services list from the API right now. Try again in a minute.',
          }),
        ],
      });
    }

    const query = interaction.options.getString('search')?.trim() || '';
    const list = filterServices(query);
    const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    const token = issueToken({ kind: 'svc', query }, 60 * 60_000);

    await interaction.reply({
      flags: V2,
      components: [
        servicesContainer({
          pageItems: list.slice(0, PAGE_SIZE),
          page: 0,
          totalPages,
          query,
          count: supported.count,
          domainCount: supported.domainCount,
          token,
        }),
      ],
    });
  },
};
