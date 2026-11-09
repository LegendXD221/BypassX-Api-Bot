import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { measureApi } from '../../api.js';
import { formatUptime } from '../../util.js';
import { V2, card, statusPanel } from '../../components.js';

export default {
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Check latency to Discord and the BypassX API'),
  meta: { cooldownMs: 2000 },

  async execute(interaction) {
    const started = Date.now();
    const api = await measureApi(); // hard-capped at ~2.5s so we answer inside the 3s window
    const roundtrip = Date.now() - started;

    const wsPing = interaction.client.ws.ping;
    const gateway = Number.isFinite(wsPing) && wsPing >= 0 ? `${Math.round(wsPing)} ms` : '—';

    await interaction.reply({
      flags: V2 | MessageFlags.Ephemeral,
      components: [
        card({
          emoji: '🏓',
          title: 'Pong',
          subtitle: `gateway ${gateway} · uptime ${formatUptime(process.uptime())}`,
          body: [
            statusPanel(
              [
                ['gateway', `${gateway}`, 'info'],
                ['roundtrip', `${roundtrip} ms`, 'info'],
                ['bypassx api', api.ok ? `up · ${api.ms} ms (HTTP ${api.status})` : `unreachable after ${api.ms} ms`, api.ok ? 'ok' : 'err'],
              ],
              { title: 'LATENCY' }
            ),
          ],
        }),
      ],
    });
  },
};
