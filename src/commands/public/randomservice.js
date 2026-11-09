import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { refreshSupported, supported } from '../../api.js';
import { V2, card } from '../../components.js';
import { truncate } from '../../util.js';
import { diffBlock } from '../../format.js';

/** Discovery: a random supported service, freshly served. */
export default {
  data: new SlashCommandBuilder()
    .setName('randomservice')
    .setDescription('Discover a random supported service'),
  meta: { cooldownMs: 3000 },

  async execute(interaction) {
    await refreshSupported();
    const list = supported.services ?? [];
    if (!list.length) {
      return interaction.reply({
        flags: V2 | MessageFlags.Ephemeral,
        components: [
          card({ emoji: '🎲', title: 'Registry is empty', body: ['The service registry is not loaded yet — try again in a minute.'] }),
        ],
      });
    }
    const svc = list[Math.floor(Math.random() * list.length)];
    return interaction.reply({
      flags: V2 | MessageFlags.Ephemeral,
      components: [
        card({
          accent: 0x818cf8,
          emoji: '🎰',
          title: svc.name ?? 'Unknown',
          subtitle: `${(svc.domains ?? []).length} domain(s) · ${svc.successRate != null ? Math.round(svc.successRate > 0 && svc.successRate <= 1 ? svc.successRate * 100 : svc.successRate) + '% rate' : 'untested'}`,
          body: [
            svc.tagline ? truncate(svc.tagline, 160) : null,
            diffBlock({ info: ['try it'], add: [`${(svc.domains ?? [])[0] ?? svc.name}`], max: 300 }),
          ].filter(Boolean),
          footerText: 'one of ' + list.length + ' services · roll again for another',
        }),
      ],
    });
  },
};
