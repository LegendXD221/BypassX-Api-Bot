import {
  SlashCommandBuilder,
  ChannelType,
  MessageFlags,
  PermissionsBitField,
  InteractionContextType,
} from 'discord.js';
import { store } from '../../db.js';
import { V2, card, errorContainer } from '../../components.js';

const MAX_CHANNELS = 10;

/** Server owners keep the bot healthy — auto-bypass is theirs to control. */
export function canManageAutobypass(interaction) {
  if (!interaction.inGuild()) return false;
  if (interaction.user.id === interaction.guild.ownerId) return true;
  return interaction.member?.permissions?.has?.(PermissionsBitField.Flags.Administrator) ?? false;
}

/** Parse "channel" option + "channels" mention/ID string into validated text channels. */
export async function resolveChannels(interaction) {
  const guild = interaction.guild;
  const candidates = new Set();

  const single = interaction.options.getChannel('channel');
  if (single) candidates.add(single.id);
  else candidates.add(interaction.channelId);

  const bulk = interaction.options.getString('channels');
  if (bulk) {
    for (const m of bulk.matchAll(/<#(\d{17,20})>/g)) candidates.add(m[1]);
    for (const m of bulk.matchAll(/\b(\d{17,20})\b/g)) candidates.add(m[0]);
  }

  const valid = [];
  const invalid = [];
  for (const id of [...candidates].slice(0, MAX_CHANNELS)) {
    const channel = guild.channels.cache.get(id) ?? (await guild.channels.fetch(id).catch(() => null));
    if (!channel || ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type)) {
      invalid.push(`<#${id}> — not a text channel`);
      continue;
    }
    const perms = channel.permissionsFor(guild.members.me);
    if (!perms?.has(PermissionsBitField.Flags.ViewChannel | PermissionsBitField.Flags.SendMessages)) {
      invalid.push(`<#${id}> — I need **View Channel** + **Send Messages** there`);
      continue;
    }
    valid.push(channel);
  }
  return { valid, invalid };
}

export default {
  data: new SlashCommandBuilder()
    .setName('enable-autobypass')
    .setDescription('Auto-bypass supported links posted in the chosen channels (server admins)')
    .addChannelOption((o) =>
      o
        .setName('channel')
        .setDescription('A channel to arm (default: this one)')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    )
    .addStringOption((o) =>
      o
        .setName('channels')
        .setDescription(`More channels — mention them, e.g. #keys #general (max ${MAX_CHANNELS} total)`)
        .setMaxLength(400)
    )
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .setContexts(InteractionContextType.Guild), // guild-only — server owners manage it there
  meta: { cooldownMs: 1000 },

  async execute(interaction) {
    if (!canManageAutobypass(interaction)) {
      return interaction.reply({
        flags: V2 | MessageFlags.Ephemeral,
        components: [
          errorContainer({
            title: 'Server admins only',
            description: 'Auto-bypass can only be managed by the **server owner** or members with **Administrator** permission.',
          }),
        ],
      });
    }

    const { valid, invalid } = await resolveChannels(interaction);
    if (!valid.length) {
      return interaction.reply({
        flags: V2 | MessageFlags.Ephemeral,
        components: [
          errorContainer({
            title: 'Nothing to arm',
            description: invalid.length ? `**Issue(s):**\n${invalid.map((i) => `> ${i}`).join('\n')}` : 'No valid text channels were given.',
          }),
        ],
      });
    }

    const newly = [];
    for (const channel of valid) {
      const already = store.autobypassChannels(interaction.guild.id).includes(channel.id);
      if (!already) newly.push(channel);
      store.autobypassEnable(interaction.guild.id, channel.id, interaction.user.id);
    }

    // Announce in every NEWLY armed channel — a visible heads-up so members
    // learn the channel is self-cleaning now. Re-arming stays silent (no spam).
    for (const channel of newly) {
      const canManageMessages = channel
        .permissionsFor(interaction.guild.members.me)
        ?.has(PermissionsBitField.Flags.ManageMessages) ?? false;
      channel
        .send({
          flags: V2,
          components: [
            card({
              accent: 0x57f287,
              emoji: '⚡',
              title: 'Auto-bypass enabled in this channel',
              body: [
                'Supported gated links posted here are now bypassed **automatically** — no commands needed.',
                '**What happens**\n> Post a supported link — the result card lands in seconds\n> Copy your link/key — the result **and the link message** self-delete **60s** later\n> Unsupported links are ignored silently · failures post a quick error card — cards & link messages always self-clean in 60s',
                canManageMessages
                  ? null
                  : '-# ⚠️ I am missing **Manage Messages** here — my result cards will still self-delete, but link posts cannot be cleaned up. Grant it for a fully self-cleaning channel.',
                `-# Armed by <@${interaction.user.id}> · turn it off anytime with \`/disable-autobypass\``,
              ],
              footerText: 'auto-bypass',
            }),
          ],
          allowedMentions: { parse: [] }, // renders the admin mention, never pings
        })
        .catch(() => {});
    }

    const armedNow = store.autobypassChannels(interaction.guild.id);
    await interaction.reply({
      flags: V2 | MessageFlags.Ephemeral,
      components: [
        card({
          accent: 0x57f287,
          emoji: '⚡',
          title: newly.length ? `Auto-bypass armed in ${newly.length} channel${newly.length === 1 ? '' : 's'}` : 'Auto-bypass already armed',
          body: [
            `**Armed in this server (${armedNow.length})**\n${armedNow.map((c) => `> <#${c}>`).join('\n')}`,
            '**How it works** — supported gated links posted in these channels are bypassed automatically · the result card **and the link message** self-delete 60s later · unsupported links are ignored silently · failures post a quick error card (❌ too) that self-cleans the same way.',
            newly.length ? `-# An announcement was posted in ${newly.length === 1 ? `<#${newly[0].id}>` : `each of the ${newly.length} channels`} so members know.` : null,
            invalid.length ? `**Skipped**\n${invalid.map((i) => `> ${i}`).join('\n')}` : null,
            `-# Disarm anytime with \`/disable-autobypass\` · check status with \`/autobypass\``,
          ],
        }),
      ],
    });
  },
};
