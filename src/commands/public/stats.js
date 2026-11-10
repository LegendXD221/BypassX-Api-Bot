import { SlashCommandBuilder } from 'discord.js';
import { config } from '../../config.js';
import { refreshSupported, supported, metrics } from '../../api.js';
import { formatUptime } from '../../util.js';
import { store } from '../../db.js';
import { V2, card, statusPanel } from '../../components.js';
import { bar, kvTable } from '../../format.js';

export default {
  data: new SlashCommandBuilder()
    .setName('stats')
    .setDescription('Live bot & API statistics'),
  meta: { cooldownMs: 3000 },

  async execute(interaction) {
    // Defer FIRST — refreshSupported() can take 10s on a cold registry and
    // Discord kills un-acked interactions at 3s ("interaction failed").
    await interaction.deferReply();
    const c = store.counters;
    const db = await store.publicStats();
    const ageMin = supported.fetchedAt ? Math.round((Date.now() - supported.fetchedAt) / 60000) : null;
    const servers = interaction.client.guilds.cache.size;

    const total = (c.bypasses ?? 0) + (c.failures ?? 0);
    const rate = total ? Math.round(((c.bypasses ?? 0) / total) * 100) : null;

    const body = [
      statusPanel(
        [
          ['uptime', formatUptime(process.uptime()), 'info'],
          ['servers', `${servers}`, 'info'],
          ['bypasses', `${c.bypasses ?? 0}`, 'ok'],
          ['auto-bypasses', `${c.autoBypasses ?? 0}`, 'ok'],
          ['cache hits', `${metrics.cacheHits}`, 'info'],
          ['api', `${supported.count || '—'} services`, 'info'],
          ['version', `v${config.version}`, 'info'],
        ],
        { title: 'LIVE NUMBERS' }
      ),
      rate != null
        ? `**Success rate** ${bar(rate)}\n-# ${c.bypasses ?? 0} of ${total} attempts landed`
        : null,
    ];

    if (db) {
      body.push(
        `**Quality**\n${db.successRate}% success rate · ${db.last24h} bypasses in the last 24h · ${db.users} unique user(s)`
      );
      if (db.topDomains.length) {
        body.push(
          kvTable(
            db.topDomains.map((d) => [d.domain, `${d.n} bypasses`]),
            { title: 'MOST BYPASSED (30d)' }
          )
        );
      }
    }

    body.push(
      `**Auto-bypass**\n${store.totalAutobypassChannels()} channel${store.totalAutobypassChannels() === 1 ? '' : 's'} armed across ${store.autobypassGuildCount()} server${store.autobypassGuildCount() === 1 ? '' : 's'}`,
      `**BypassX API**\n${supported.count || '—'} services · ${supported.domainCount || '—'} domains${ageMin != null ? ` · refreshed ${ageMin} min ago` : ''}${config.apiKey ? '' : '\n⚠️ No API key configured — bypasses are offline'}`
    );

    await interaction.editReply({
      flags: V2,
      components: [card({ emoji: '📊', title: 'Bot Statistics', body })],
    });
  },
};
