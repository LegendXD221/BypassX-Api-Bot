import { SlashCommandBuilder, MessageFlags, ChannelType } from 'discord.js';
import { store } from '../../db.js';
import { V2, card } from '../../components.js';
import { canManageAutobypass, resolveChannels } from './enable-autobypass.js';

export default {
  data: new SlashCommandBuilder()
    .setName('disable-autobypass')
    .setDescription('Disarm auto-bypass in chosen channels — or everywhere (server admins)')
    .addChannelOption((o) =>
      o
        .setName('channel')
        .setDescription('A channel to disarm (default: this one)')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    )
    .addStringOption((o) =>
      o
        .setName('channels')
        .setDescription('More channels to disarm — mention them, e.g. #keys #general')
        .setMaxLength(400)
    )
    .addBooleanOption((o) =>
      o.setName('all').setDescription('Disarm every channel in this server')
    )
    .setDefaultMemberPermissions('8') // Administrator — hidden from non-admins
    .setContexts(1), // InteractionContextType.Guild
  meta: { cooldownMs: 1000 },

  async execute(interaction) {
    if (!canManageAutobypass(interaction)) {
      return interaction.reply({
        flags: V2 | MessageFlags.Ephemeral,
        components: [
          card({
            accent: 0xed4245,
            emoji: '🔒',
            title: 'Server admins only',
            body: ['Auto-bypass can only be managed by the **server owner** or members with **Administrator** permission.'],
          }),
        ],
      });
    }

    if (interaction.options.getBoolean('all')) {
      const before = store.autobypassChannels(interaction.guild.id).length;
      store.autobypassDisableAll(interaction.guild.id);
      return interaction.reply({
        flags: V2 | MessageFlags.Ephemeral,
        components: [
          card({
            accent: 0x2b2d31,
            emoji: '🔇',
            title: `Auto-bypass disarmed everywhere (${before} channel${before === 1 ? '' : 's'} cleared)`,
            body: ['No channels in this server auto-bypass links anymore.', '-# Re-arm anytime with `/enable-autobypass`'],
          }),
        ],
      });
    }

    const { valid, invalid } = await resolveChannels(interaction);
    if (!valid.length) {
      return interaction.reply({
        flags: V2 | MessageFlags.Ephemeral,
        components: [
          card({
            accent: 0xed4245,
            emoji: '⚠️',
            title: 'Nothing to disarm',
            body: [invalid.length ? `**Issue(s):**\n${invalid.map((i) => `> ${i}`).join('\n')}` : 'No valid text channels were given.'],
          }),
        ],
      });
    }

    const removed = [];
    for (const channel of valid) {
      const wasArmed = store.autobypassChannels(interaction.guild.id).includes(channel.id);
      if (wasArmed) removed.push(channel.id);
      store.autobypassDisable(interaction.guild.id, channel.id);
    }

    const armedNow = store.autobypassChannels(interaction.guild.id);
    await interaction.reply({
      flags: V2 | MessageFlags.Ephemeral,
      components: [
        card({
          accent: 0x2b2d31,
          emoji: '🔇',
          title: removed.length ? `Auto-bypass disarmed in ${removed.length} channel${removed.length === 1 ? '' : 's'}` : 'Those channels were not armed',
          body: [
            removed.length ? `${removed.map((c) => `> <#${c}>`).join('\n')}` : '> Nothing changed — none of those channels were armed.',
            `**Still armed in this server (${armedNow.length})** — ${armedNow.length ? armedNow.map((c) => `<#${c}>`).join(' · ') : 'none'}`,
            invalid.length ? `**Skipped**\n${invalid.map((i) => `> ${i}`).join('\n')}` : null,
          ],
        }),
      ],
    });
  },
};
