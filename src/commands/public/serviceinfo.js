import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { refreshSupported, supported, matchService } from '../../api.js';
import { V2, card, errorContainer } from '../../components.js';
import { truncate } from '../../util.js';
import { kvTable, diffBlock } from '../../format.js';

/** Deep info on one supported service — by name or any URL. */
export default {
  data: new SlashCommandBuilder()
    .setName('serviceinfo')
    .setDescription('Deep info about a supported service — domains, rate, notes')
    .addStringOption((o) => o.setName('service').setDescription('Service name, domain, or a full link').setRequired(true).setMaxLength(200)),
  meta: { cooldownMs: 3000 },

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await refreshSupported();

    const raw = String(interaction.options.getString('service', true)).trim();
    let svc = null;

    if (/https?:\/\//i.test(raw)) {
      svc = matchService(raw);
    } else {
      const q = raw.toLowerCase();
      svc =
        supported.services.find((s) => (s.name ?? '').toLowerCase() === q) ??
        supported.services.find((s) => (s.domains ?? []).some((d) => d.toLowerCase() === q || d.toLowerCase().includes(q))) ??
        supported.services.find((s) => (s.name ?? '').toLowerCase().includes(q));
    }

    if (!svc) {
      return interaction.editReply({
        flags: V2 | MessageFlags.Ephemeral,
        components: [
          errorContainer({
            title: 'Unknown service',
            description: `**${truncate(raw, 60)}** is not in the registry. Browse everything with \`/services search:\`.`,
          }),
        ],
      });
    }

    const domains = (svc.domains ?? []).slice(0, 12);
    return interaction.editReply({
      flags: V2 | MessageFlags.Ephemeral,
      components: [
        card({
          emoji: '🛰️',
          title: svc.name ?? 'Unknown service',
          subtitle: svc.tagline ? truncate(svc.tagline, 90) : null,
          body: [
            kvTable(
              [
                ['domains', `${(svc.domains ?? []).length}`],
                ['success rate', svc.successRate != null ? `${Math.round(svc.successRate > 0 && svc.successRate <= 1 ? svc.successRate * 100 : svc.successRate)}%` : '—'],
                ['id', svc.id ?? '—'],
              ],
              { title: 'SERVICE' }
            ),
            diffBlock({ info: ['known domains'], add: domains, max: 700 }),
            svc.note ? `-# ${truncate(svc.note, 200)}` : null,
          ].filter(Boolean),
          footerText: 'bypass it directly with /bypass url:',
        }),
      ],
    });
  },
};
