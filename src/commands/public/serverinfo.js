import { SlashCommandBuilder, MessageFlags, InteractionContextType } from 'discord.js';
import { store } from '../../db.js';
import { V2, card } from '../../components.js';

/** Server overview — members, boosts, auto-bypass state and 30-day activity. */
export default {
  data: new SlashCommandBuilder()
    .setName('serverinfo')
    .setDescription('This server at a glance — members, boosts, auto-bypass and bypass activity')
    .setContexts(InteractionContextType.Guild), // guild-only — it describes a server
  meta: { cooldownMs: 3000 },

  async execute(interaction) {
    const guild = interaction.guild;
    const channels = store.autobypassChannels(guild.id);
    const stats = await store.guildStats(guild.id);

    const created = Math.floor(guild.createdTimestamp / 1000);
    const body = [
      `**Server**\n**${guild.name}** · \`${guild.id}\`\nOwner <@${guild.ownerId}> · created <t:${created}:R>`,
      `**Size**\n${guild.memberCount ?? '?'} members · ${guild.premiumSubscriptionCount ?? 0} boost${(guild.premiumSubscriptionCount ?? 0) === 1 ? '' : 's'} (level ${guild.premiumTier}) · ${guild.roles.cache.size - 1} roles · ${guild.channels.cache.size} channels`,
      `**Auto-bypass**\n${channels.length ? `${channels.length} channel${channels.length === 1 ? '' : 's'} armed — ${channels.map((c) => `<#${c}>`).join(' · ')}` : 'Not armed here yet — server admins can run `/enable-autobypass`.'}`,
      stats
        ? `**Bypass activity (30 days)**\n${stats.total} bypass${stats.total === 1 ? '' : 'es'} · ${stats.successRate}% success · ${stats.users} unique user${stats.users === 1 ? '' : 's'}${stats.topDomains.length ? `\nTop: ${stats.topDomains.map((d) => `\`${d.domain}\` (${d.n})`).join(' · ')}` : ''}`
        : '**Bypass activity**\nNo database history for this server yet.',
    ];

    await interaction.reply({
      flags: V2 | MessageFlags.Ephemeral,
      components: [card({ emoji: '🏰', title: 'Server Overview', subtitle: guild.name, body })],
    });
  },
};
