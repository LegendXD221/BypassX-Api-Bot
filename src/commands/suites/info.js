import { SlashCommandBuilder, MessageFlags, ChannelType } from 'discord.js';
import { V2, card, errorContainer } from '../../components.js';
import { kvTable, codeBlock, bullets } from '../../format.js';
import { truncate, ago } from '../../util.js';

/* ------------------------------------------------------------------ */
/* /info — lookup tools for users, channels, roles and emojis          */
/* avatar · banner · roleinfo · channelinfo · emojiinfo · emojilist    */
/* roles · boosts · servericon                                         */
/* ------------------------------------------------------------------ */

const EMOJI_MEDALS = ['🥇', '🥈', '🥉'];

export default {
  data: new SlashCommandBuilder()
    .setName('info')
    .setDescription('Look up users, roles, channels, emojis and server details')
    .addSubcommand((sc) =>
      sc
        .setName('avatar')
        .setDescription('Full-size avatar of a user')
        .addUserOption((o) => o.setName('user').setDescription('Whose avatar (default: you)'))
        .addBooleanOption((o) => o.setName('server').setDescription('Use their server-specific avatar when set'))
    )
    .addSubcommand((sc) =>
      sc
        .setName('banner')
        .setDescription('Full-size profile banner of a user')
        .addUserOption((o) => o.setName('user').setDescription('Whose banner (default: you)'))
    )
    .addSubcommand((sc) =>
      sc
        .setName('roleinfo')
        .setDescription('Everything about a role')
        .addRoleOption((o) => o.setName('role').setDescription('The role').setRequired(true))
    )
    .addSubcommand((sc) =>
      sc
        .setName('channelinfo')
        .setDescription('Everything about a channel')
        .addChannelOption((o) => o.setName('channel').setDescription('The channel (default: here)'))
    )
    .addSubcommand((sc) =>
      sc
        .setName('emojiinfo')
        .setDescription('Everything about a custom emoji')
        .addStringOption((o) => o.setName('emoji').setDescription('The custom emoji').setRequired(true).setMaxLength(64))
    )
    .addSubcommand((sc) =>
      sc
        .setName('emojilist')
        .setDescription('All custom emojis in this server, grouped')
    )
    .addSubcommand((sc) =>
      sc
        .setName('roles')
        .setDescription('Every role in this server with colors and sizes')
    )
    .addSubcommand((sc) =>
      sc
        .setName('boosts')
        .setDescription('Server boost status and perks tier')
    )
    .addSubcommand((sc) =>
      sc
        .setName('servericon')
        .setDescription('Full-size server icon / banner')
    ),
  meta: { cooldownMs: 2000 },

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    switch (sub) {
      case 'avatar':
        return runAvatar(interaction);
      case 'banner':
        return runBanner(interaction);
      case 'roleinfo':
        return runRoleinfo(interaction);
      case 'channelinfo':
        return runChannelinfo(interaction);
      case 'emojiinfo':
        return runEmojiinfo(interaction);
      case 'emojilist':
        return runEmojilist(interaction);
      case 'roles':
        return runRoles(interaction);
      case 'boosts':
        return runBoosts(interaction);
      case 'servericon':
        return runServericon(interaction);
      default:
        return interaction.reply({
          flags: V2 | MessageFlags.Ephemeral,
          components: [errorContainer({ title: 'Unknown subcommand', description: `**${sub}** is not wired up.` })],
        });
    }
  },
};

/* ---------------- avatar / banner ---------------- */

async function runAvatar(interaction) {
  const user = interaction.options.getUser('user') ?? interaction.user;
  const useServer = interaction.options.getBoolean('server') ?? false;
  let url = user.displayAvatarURL({ size: 1024, extension: 'png', forceStatic: false });
  if (useServer && interaction.guild) {
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (member?.avatar) url = member.displayAvatarURL({ size: 1024, extension: 'png' });
  }
  return interaction.reply({
    flags: V2,
    components: [
      card({
        emoji: '🖼️',
        title: `${user.username}'s avatar`,
        body: [`[open full size (1024px)](${url})`, codeBlock('', url)],
        thumb: url,
      }),
    ],
  });
}

async function runBanner(interaction) {
  const user = interaction.options.getUser('user') ?? interaction.user;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const fetched = await user.fetch(true).catch(() => null);
  const banner = fetched?.bannerURL?.({ size: 1024, extension: 'png' });
  if (!banner) {
    return interaction.editReply({
      flags: V2 | MessageFlags.Ephemeral,
      components: [errorContainer({ title: 'No banner', description: `**${user.username}** has no profile banner set.` })],
    });
  }
  return interaction.editReply({
    flags: V2 | MessageFlags.Ephemeral,
    components: [
      card({ emoji: '🎴', title: `${user.username}'s banner`, body: [`[open full size](${banner})`, codeBlock('', banner)] }),
    ],
  });
}

/* ---------------- roleinfo ---------------- */

async function runRoleinfo(interaction) {
  const role = interaction.options.getRole('role', true);
  const members = role.members?.size ?? null;
  return interaction.reply({
    flags: V2 | MessageFlags.Ephemeral,
    components: [
      card({
        emoji: '🏷️',
        title: `${role.name}`,
        subtitle: role.id,
        body: [
          kvTable(
            [
              ['color', role.hexColor],
              ['members', members == null ? 'unknown (cache)' : String(members)],
              ['position', String(role.position)],
              ['hoisted', role.hoist ? 'yes — shown separately' : 'no'],
              ['mentionable', role.mentionable ? 'yes' : 'no'],
              ['managed', role.managed ? 'yes (integration)' : 'no'],
              ['created', role.createdTimestamp ? ago(role.createdTimestamp) : 'unknown'],
            ],
            { title: 'ROLE' }
          ),
        ],
        footerText: null,
      }),
    ],
  });
}

/* ---------------- channelinfo ---------------- */

async function runChannelinfo(interaction) {
  const channel = interaction.options.getChannel('channel') ?? interaction.channel;
  const typeNames = {
    [ChannelType.GuildText]: 'text',
    [ChannelType.GuildVoice]: 'voice',
    [ChannelType.GuildAnnouncement]: 'announcement',
    [ChannelType.GuildStageVoice]: 'stage',
    [ChannelType.GuildForum]: 'forum',
    [ChannelType.GuildCategory]: 'category',
  };
  return interaction.reply({
    flags: V2 | MessageFlags.Ephemeral,
    components: [
      card({
        emoji: '📺',
        title: `#${channel.name ?? channel.id}`,
        body: [
          kvTable(
            [
              ['id', channel.id],
              ['type', typeNames[channel.type] ?? String(channel.type)],
              ['topic', channel.topic ? truncate(channel.topic, 120) : '—'],
              ['nsfw', channel.nsfw ? 'yes' : 'no'],
              ['created', channel.createdTimestamp ? ago(channel.createdTimestamp) : 'unknown'],
              ['position', String(channel.rawPosition ?? '—')],
            ],
            { title: 'CHANNEL' }
          ),
        ],
        footerText: null,
      }),
    ],
  });
}

/* ---------------- emojiinfo / emojilist ---------------- */

function parseEmoji(raw) {
  const m = /^<(a)?:(\w{2,32}):(\d{15,21})>$/.exec(String(raw ?? '').trim());
  if (!m) return null;
  return { animated: Boolean(m[1]), name: m[2], id: m[3] };
}

async function runEmojiinfo(interaction) {
  const parsed = parseEmoji(interaction.options.getString('emoji', true));
  if (!parsed) {
    return interaction.reply({
      flags: V2 | MessageFlags.Ephemeral,
      components: [errorContainer({ title: 'Not a custom emoji', description: 'Send the emoji itself (e.g. `:thinko:1234567890`) or paste it from the picker.' })],
    });
  }
  const url = `https://cdn.discordapp.com/emojis/${parsed.id}.${parsed.animated ? 'gif' : 'png'}?size=128&quality=lossless`;
  return interaction.reply({
    flags: V2 | MessageFlags.Ephemeral,
    components: [
      card({
        emoji: '😂',
        title: `:${parsed.name}:`,
        body: [
          kvTable(
            [
              ['name', parsed.name],
              ['id', parsed.id],
              ['animated', parsed.animated ? 'yes' : 'no'],
              ['url', url],
            ],
            { title: 'EMOJI' }
          ),
        ],
        thumb: url,
        footerText: null,
      }),
    ],
  });
}

async function runEmojilist(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const emojis = [...interaction.guild.emojis.cache.values()];
  if (!emojis.length) {
    return interaction.editReply({
      flags: V2 | MessageFlags.Ephemeral,
      components: [errorContainer({ title: 'No emojis', description: 'This server has no custom emojis yet.' })],
    });
  }
  const groups = new Map();
  for (const e of emojis) {
    const letter = (e.name?.[0] ?? '?').toUpperCase();
    if (!groups.has(letter)) groups.set(letter, []);
    groups.get(letter).push(`${e.animated ? '🎞️' : '🧩'} \`:${e.name}:\``);
  }
  const lines = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(0, 24)
    .map(([letter, list]) => `**${letter}** (${list.length}) — ${list.slice(0, 8).join(' ')}${list.length > 8 ? ` +${list.length - 8}` : ''}`);
  return interaction.editReply({
    flags: V2 | MessageFlags.Ephemeral,
    components: [
      card({ emoji: '🧩', title: 'Custom emojis', subtitle: `${emojis.length} total`, body: [bullets(lines, { max: 24 })], footerText: null }),
    ],
  });
}

/* ---------------- roles / boosts / servericon ---------------- */

async function runRoles(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const roles = [...interaction.guild.roles.cache.values()]
    .filter((r) => r.id !== interaction.guild.id)
    .sort((a, b) => b.position - a.position)
    .slice(0, 25);
  const lines = roles.map((r, i) => `${EMOJI_MEDALS[i] ?? '▪'} ${r.hexColor === '#000000' ? '`default`' : `\`${r.hexColor}\``} **${r.name}** — ${r.members?.size ?? '?'} member${r.members?.size === 1 ? '' : 's'}`);
  return interaction.editReply({
    flags: V2 | MessageFlags.Ephemeral,
    components: [
      card({
        emoji: '🏷️',
        title: 'Roles',
        subtitle: `${interaction.guild.roles.cache.size - 1} roles (top 25 shown)`,
        body: [bullets(lines, { max: 25 })],
        footerText: null,
      }),
    ],
  });
}

async function runBoosts(interaction) {
  const g = interaction.guild;
  const tierNames = { 0: 'Tier 0 — no perks yet', 1: 'Tier 1 — boosted', 2: 'Tier 2 — heavily boosted', 3: 'Tier 3 — maxed out' };
  return interaction.reply({
    flags: V2 | MessageFlags.Ephemeral,
    components: [
      card({
        emoji: '🚀',
        title: `${g.name} — boosts`,
        body: [
          kvTable(
            [
              ['tier', tierNames[g.premiumTier] ?? String(g.premiumTier)],
              ['boosts', String(g.premiumSubscriptionCount ?? 0)],
              ['boosters', String(g.premiumSubscriberCount ?? '?')],
              ['members', String(g.memberCount ?? '?')],
            ],
            { title: 'BOOST STATUS' }
          ),
        ],
        footerText: null,
      }),
    ],
  });
}

async function runServericon(interaction) {
  const g = interaction.guild;
  const icon = g.iconURL?.({ size: 1024, extension: 'png', forceStatic: false });
  const banner = g.bannerURL?.({ size: 1024, extension: 'png' });
  if (!icon && !banner) {
    return interaction.reply({
      flags: V2 | MessageFlags.Ephemeral,
      components: [errorContainer({ title: 'No imagery', description: 'This server has no icon or banner set.' })],
    });
  }
  return interaction.reply({
    flags: V2,
    components: [
      card({
        emoji: '🏰',
        title: `${g.name} — icon & banner`,
        body: [
          icon ? `[icon (1024px)](${icon})` : null,
          banner ? `[banner (1024px)](${banner})` : null,
          icon ? codeBlock('', icon) : null,
          banner ? codeBlock('', banner) : null,
        ].filter(Boolean),
        thumb: icon ?? undefined,
        footerText: null,
      }),
    ],
  });
}
