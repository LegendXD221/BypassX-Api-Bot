import { SlashCommandBuilder } from 'discord.js';
import { config } from '../../config.js';
import { refreshSupported, supported, metrics } from '../../api.js';
import { formatUptime } from '../../util.js';
import { store } from '../../storage.js';
import { V2, card } from '../../components.js';

export default {
  data: new SlashCommandBuilder()
    .setName('stats')
    .setDescription('Live bot & API statistics'),
  meta: { cooldownMs: 3000 },

  async execute(interaction) {
    await refreshSupported();
    const c = store.counters;
    const ageMin = supported.fetchedAt ? Math.round((Date.now() - supported.fetchedAt) / 60000) : null;

    const body = [
      `**Runtime**\nUptime ${formatUptime(process.uptime())} · ${interaction.client.guilds.cache.size} server${interaction.client.guilds.cache.size === 1 ? '' : 's'} · v${config.version}`,
      `**Bypasses**\n${c.bypasses} total · ${c.autoBypasses} auto-bypassed · ${c.failures} failed · ${metrics.cacheHits} served from local cache`,
      `**Auto-bypass**\n${store.totalAutobypassChannels()} channel${store.totalAutobypassChannels() === 1 ? '' : 's'} armed across ${Object.keys(store.autobypass).length} server${Object.keys(store.autobypass).length === 1 ? '' : 's'}`,
      `**BypassX API**\n${supported.count || '—'} services · ${supported.domainCount || '—'} domains${ageMin != null ? ` · refreshed ${ageMin} min ago` : ''}${config.apiKey ? '' : '\n⚠️ No API key configured — bypasses are offline'}`,
    ];

    await interaction.reply({
      flags: V2,
      components: [card({ emoji: '📊', title: 'Bot Statistics', body })],
    });
  },
};
