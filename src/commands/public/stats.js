import { SlashCommandBuilder } from 'discord.js';
import { config } from '../../config.js';
import { refreshSupported, supported, metrics } from '../../api.js';
import { formatUptime } from '../../util.js';
import { store } from '../../db.js';
import { V2, card } from '../../components.js';

export default {
  data: new SlashCommandBuilder()
    .setName('stats')
    .setDescription('Live bot & API statistics'),
  meta: { cooldownMs: 3000 },

  async execute(interaction) {
    await refreshSupported();
    const c = store.counters;
    const db = await store.publicStats();
    const ageMin = supported.fetchedAt ? Math.round((Date.now() - supported.fetchedAt) / 60000) : null;
    const servers = interaction.client.guilds.cache.size;

    const body = [
      `**Runtime**\nUptime ${formatUptime(process.uptime())} · ${servers} server${servers === 1 ? '' : 's'} · v${config.version}`,
      `**Bypasses**\n${c.bypasses ?? 0} total · ${c.autoBypasses ?? 0} auto-bypassed · ${metrics.cacheHits} served from cache`,
    ];

    if (db) {
      body.push(
        `**Quality**\n${db.successRate}% success rate · ${db.last24h} bypasses in the last 24h · ${db.users} unique user(s)`
      );
      if (db.topDomains.length) {
        body.push(`**Most bypassed (30d)**\n${db.topDomains.map((d) => `> \`${d.domain}\` — ${d.n}`).join('\n')}`);
      }
    }

    body.push(
      `**Auto-bypass**\n${store.totalAutobypassChannels()} channel${store.totalAutobypassChannels() === 1 ? '' : 's'} armed across ${store.autobypassGuildCount()} server${store.autobypassGuildCount() === 1 ? '' : 's'}`,
      `**BypassX API**\n${supported.count || '—'} services · ${supported.domainCount || '—'} domains${ageMin != null ? ` · refreshed ${ageMin} min ago` : ''}${config.apiKey ? '' : '\n⚠️ No API key configured — bypasses are offline'}`
    );

    await interaction.reply({
      flags: V2,
      components: [card({ emoji: '📊', title: 'Bot Statistics', body })],
    });
  },
};
