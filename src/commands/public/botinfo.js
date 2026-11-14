import { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { config, inviteUrl } from '../../config.js';
import { measureApi, refreshSupported, supported, metrics } from '../../api.js';
import { formatUptime } from '../../util.js';
import { store, dbHealthy } from '../../db.js';
import { countInvokables } from '../catalog.js';
import { V2, card } from '../../components.js';

export default {
  data: new SlashCommandBuilder()
    .setName('botinfo')
    .setDescription('Everything about BypassX Api — version, health, reach'),
  meta: { cooldownMs: 3000 },

  async execute(interaction) {
    const [api] = await Promise.all([measureApi(), refreshSupported()]);
    const client = interaction.client;
    const servers = client.guilds.cache.size;
    const members = client.guilds.cache.reduce((acc, g) => acc + (g.memberCount ?? 0), 0);
    const mem = process.memoryUsage();
    const wsPing = client.ws.ping;
    const gateway = Number.isFinite(wsPing) && wsPing >= 0 ? `${Math.round(wsPing)} ms` : '—';
    const invokables = countInvokables(client.commands);

    const body = [
      `**Identity**\n**BypassX Api** v${config.version} · bypasses gated links with the official BypassX API · Components V2 native · ${client.commands.size} commands / ${invokables} invokable actions`,
      `**Reach**\n${servers} server${servers === 1 ? '' : 's'} · ~${members.toLocaleString()} members · ${store.totalAutobypassChannels()} auto-bypass channel(s) armed`,
      `**Health**\nUptime ${formatUptime(process.uptime())} · gateway ${gateway} · API ${api.ok ? `✅ ${api.ms} ms` : '❌ unreachable'} · database ${dbHealthy() ? '✅' : 'memory-only'}\nRegistry ${supported.count || '—'} services · ${supported.domainCount || '—'} domains · ${metrics.cacheHits} cache hit(s) this session`,
      `**Process**\nNode ${process.version} · heap ${(mem.heapUsed / 1048576).toFixed(1)} MB · rss ${(mem.rss / 1048576).toFixed(1)} MB`,
      `-# Results ship with 📱 Mobile Copy · 💻 PC Copy · 🔗 Open Result buttons.`,
    ];

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setURL(inviteUrl(client.user.id)).setLabel('Invite BypassX Api').setEmoji('🚀').setStyle(ButtonStyle.Link),
      new ButtonBuilder().setURL(config.apiUrl).setLabel('BypassX Website').setEmoji('🌐').setStyle(ButtonStyle.Link)
    );

    await interaction.reply({
      flags: V2 | MessageFlags.Ephemeral,
      components: [card({ emoji: '🤖', title: 'BypassX Api', subtitle: 'The official BypassX Discord bot', body, rows: [row], footerText: 'minimal · professional · no-exploit posture' })],
    });
  },
};
