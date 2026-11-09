import { SlashCommandBuilder } from 'discord.js';
import { config } from '../../config.js';
import { refreshSupported, supported, metrics, measureApi, cacheStats } from '../../api.js';
import { apiHealth } from '../../watchdog.js';
import { store, dbHealthy } from '../../db.js';
import { tokenStats } from '../../tokens.js';
import { formatUptime } from '../../util.js';
import { V2, card, statusPanel } from '../../components.js';
import { diffBlock } from '../../format.js';

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

    const body = [
      statusPanel(
        [
          ['gateway', `connected · ping ${wsPing}`, 'ok'],
          ['uptime', formatUptime(process.uptime()), 'info'],
          ['servers', `${servers}`, 'info'],
          ['bx api', live.ok ? `online · ${live.ms}ms` : `unreachable (HTTP ${live.status || 'no response'})`, live.ok ? 'ok' : 'err'],
          ['database', config.databaseUrl ? (dbOk ? 'neon postgres connected' : 'memory-only — reconnecting') : 'not configured', config.databaseUrl ? (dbOk ? 'ok' : 'warn') : 'info'],
          ['result cache', `${cache.size} entries · ${metrics.cacheHits} hits`, 'info'],
          ['maintenance', (await store.getConfig('maintenance', false)) ? 'ON' : 'off', (await store.getConfig('maintenance', false)) ? 'warn' : 'ok'],
          ['version', `v${config.version}`, 'info'],
        ],
        { title: 'BYPASSX SYSTEM' }
      ),
      diffBlock({
        info: ['services'],
        add: [`${supported.count || '—'} services · ${supported.domainCount || '—'} domains registered`],
        warn: [
          ...(watchdog.degraded ? ['watchdog marked the API degraded earlier'] : []),
          ...(config.apiKey ? [] : ['no API key configured — bypasses are offline']),
        ],
        max: 400,
      }),
      `-# watchdog: ${watchdog.consecutiveFailures} failed probe(s) · last probe HTTP ${watchdog.lastStatus ?? '—'} · registry ${supported.fetchedAt ? `refreshed ${Math.round((Date.now() - supported.fetchedAt) / 60000)} min ago` : 'never'} · ${metrics.apiCalls} API call${metrics.apiCalls === 1 ? '' : 's'} this uptime${successRate != null ? ` · ${successRate}% first-try` : ''} · ${tokenStats()} active token${tokenStats() === 1 ? '' : 's'} · auto-leave ${config.minGuildMembers}+`,
    ];

    await interaction.editReply({
      flags: V2,
      components: [card({ emoji: '🩺', title: 'System Status', body })],
    });
  },
};
