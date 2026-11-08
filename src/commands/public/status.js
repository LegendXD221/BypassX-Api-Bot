import { SlashCommandBuilder } from 'discord.js';
import { config } from '../../config.js';
import { refreshSupported, supported, metrics, measureApi, cacheStats } from '../../api.js';
import { apiHealth } from '../../watchdog.js';
import { store, dbHealthy } from '../../db.js';
import { tokenStats } from '../../tokens.js';
import { formatUptime } from '../../util.js';
import { V2, card } from '../../components.js';

/**
 * Deep system diagnostics — the "is everything working" command, distinct
 * from /stats (usage numbers): gateway state, BypassX API health (watchdog +
 * live probe), database transport, result cache, feature flags.
 */
export default {
  data: new SlashCommandBuilder()
    .setName('status')
    .setDescription('System status — gateway, BypassX API, database and cache diagnostics'),
  meta: { cooldownMs: 5000 },

  async execute(interaction) {
    await interaction.deferReply();

    const [live] = await Promise.all([measureApi(), refreshSupported()]);
    const watchdog = apiHealth();
    const cache = cacheStats();
    const dbOk = dbHealthy();
    const servers = interaction.client.guilds.cache.size;
    const wsPing = typeof interaction.client.ws?.ping === 'number' && interaction.client.ws.ping >= 0
      ? `${Math.round(interaction.client.ws.ping)}ms`
      : '—';

    const successRate =
      metrics.apiCalls > 0 ? Math.round(((metrics.apiCalls - metrics.apiFailures) / metrics.apiCalls) * 100) : null;

    const apiLine = live.ok
      ? `🟢 Online — ${live.ms}ms${watchdog.degraded ? ' · ⚠️ watchdog marked it degraded earlier' : ''}`
      : `🔴 Unreachable (HTTP ${live.status || 'no response'}) — transient failures auto-retry`;
    const dbLine = config.databaseUrl
      ? dbOk
        ? '🟢 Neon Postgres connected'
        : '🟡 Unreachable — running memory-only (auto-reconnects every 60s)'
      : '⚪ Not configured — memory-only mode';

    const body = [
      `**Gateway**\n🟢 Connected · shard ping ${wsPing} · uptime ${formatUptime(process.uptime())} · ${servers} server${servers === 1 ? '' : 's'}`,
      `**BypassX API**\n${apiLine}\n-# watchdog: ${watchdog.consecutiveFailures} failed probe(s) · last probe HTTP ${watchdog.lastStatus ?? '—'} · registry ${supported.count || '—'} services${supported.fetchedAt ? ` · refreshed ${Math.round((Date.now() - supported.fetchedAt) / 60000)} min ago` : ''}`,
      `**Database**\n${dbLine}`,
      `**Runtime**\nresult cache ${cache.size} entr${cache.size === 1 ? 'y' : 'ies'} · ${metrics.cacheHits} cache hit${metrics.cacheHits === 1 ? '' : 's'} · ${metrics.apiCalls} API call${metrics.apiCalls === 1 ? '' : 's'} this uptime${successRate != null ? ` · ${successRate}% reached the API first try` : ''} · ${tokenStats()} active interaction token${tokenStats() === 1 ? '' : 's'}`,
      `**Settings**\nv${config.version} · maintenance ${await store.getConfig('maintenance', false) ? '🟡 ON' : '🟢 off'} · auto-leave threshold ${config.minGuildMembers}+ members${config.apiKey ? '' : '\n⚠️ No API key configured — bypasses are offline'}`,
    ];

    await interaction.editReply({
      flags: V2,
      components: [card({ emoji: '🩺', title: 'System Status', body })],
    });
  },
};
