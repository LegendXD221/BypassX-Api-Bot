import {
  SlashCommandBuilder,
  MessageFlags,
  PermissionFlagsBits,
  ChannelType,
  EmbedBuilder,
  PermissionsBitField,
} from 'discord.js';
import { config } from '../../config.js';
import { V2, card, errorContainer } from '../../components.js';
import { truncate } from '../../util.js';
import { diffBlock, diffStatus } from '../../format.js';

/* ------------------------------------------------------------------ */
/* /server — moderation & messaging tools (perm-gated)                 */
/* purge · slowmode · lock · unlock · say · embed · announce · nick    */
/* topic · pin · unpin                                                 */
/* ------------------------------------------------------------------ */

function can(interaction, flag) {
  const perms = interaction.member?.permissions;
  if (!perms || typeof perms.has !== 'function') return false;
  return perms.has(flag);
}

function need(interaction, flag, label) {
  if (can(interaction, flag)) return null;
  return interaction.reply({
    flags: V2 | MessageFlags.Ephemeral,
    components: [errorContainer({ title: 'Missing permission', description: `You need **${label}** in this channel to use this.` })],
  });
}

const amFlag = (name) => PermissionFlagsBits[name];

export default {
  data: new SlashCommandBuilder()
    .setName('server')
    .setDescription('Server tools — purge, lockdown, announcements and more')
    .addSubcommand((sc) =>
      sc
        .setName('purge')
        .setDescription('Bulk delete recent messages in this channel')
        .addIntegerOption((o) => o.setName('count').setDescription('How many 1-100').setRequired(true).setMinValue(1).setMaxValue(100))
        .addUserOption((o) => o.setName('from').setDescription('Only messages from this user'))
        .addBooleanOption((o) => o.setName('bots').setDescription('Only bot messages'))
        .addBooleanOption((o) => o.setName('links').setDescription('Only messages containing links'))
    )
    .addSubcommand((sc) =>
      sc
        .setName('slowmode')
        .setDescription('Set channel slowmode (0 = off)')
        .addIntegerOption((o) => o.setName('seconds').setDescription('0-21600 seconds').setRequired(true).setMinValue(0).setMaxValue(21600))
    )
    .addSubcommand((sc) =>
      sc
        .setName('lock')
        .setDescription('Lock this channel — members lose send permissions')
        .addStringOption((o) => o.setName('reason').setDescription('Shown in the confirmation').setMaxLength(200))
    )
    .addSubcommand((sc) =>
      sc
        .setName('unlock')
        .setDescription('Unlock this channel — restore send permissions')
    )
    .addSubcommand((sc) =>
      sc
        .setName('say')
        .setDescription('Make the bot say something (plain text)')
        .addStringOption((o) => o.setName('text').setDescription('What to say').setRequired(true).setMaxLength(1900))
    )
    .addSubcommand((sc) =>
      sc
        .setName('embed')
        .setDescription('Make the bot say something (styled card)')
        .addStringOption((o) => o.setName('title').setDescription('Title').setRequired(true).setMaxLength(200))
        .addStringOption((o) => o.setName('description').setDescription('Body').setRequired(true).setMaxLength(3800))
        .addStringOption((o) => o.setName('color').setDescription('Hex color (default brand red)').setMaxLength(9))
    )
    .addSubcommand((sc) =>
      sc
        .setName('announce')
        .setDescription('Announce in a channel with a styled card (+ optional role ping)')
        .addStringOption((o) => o.setName('title').setDescription('Announcement title').setRequired(true).setMaxLength(200))
        .addStringOption((o) => o.setName('message').setDescription('Announcement body').setRequired(true).setMaxLength(3800))
        .addChannelOption((o) =>
          o.setName('channel').setDescription('Target channel (default: here)').addChannelTypes(ChannelType.GuildText)
        )
        .addRoleOption((o) => o.setName('ping').setDescription('Role to ping (needs Mention Everyone for it to land)'))
    )
    .addSubcommand((sc) =>
      sc
        .setName('nick')
        .setDescription('Change the bot nickname in this server')
        .addStringOption((o) => o.setName('name').setDescription('New nickname (empty = reset)').setMaxLength(32))
    )
    .addSubcommand((sc) =>
      sc
        .setName('topic')
        .setDescription('Set this channel topic')
        .addStringOption((o) => o.setName('text').setDescription('Channel topic (empty = clear)').setMaxLength(1000))
    )
    .addSubcommand((sc) =>
      sc
        .setName('pin')
        .setDescription('Pin a message by ID')
        .addStringOption((o) => o.setName('message_id').setDescription('The message ID to pin').setRequired(true).setMaxLength(25))
    )
    .addSubcommand((sc) =>
      sc
        .setName('unpin')
        .setDescription('Unpin a message by ID')
        .addStringOption((o) => o.setName('message_id').setDescription('The message ID to unpin').setRequired(true).setMaxLength(25))
    ),
  meta: { cooldownMs: 3000 },

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    switch (sub) {
      case 'purge':
        return runPurge(interaction);
      case 'slowmode':
        return runSlowmode(interaction);
      case 'lock':
        return runLock(interaction);
      case 'unlock':
        return runUnlock(interaction);
      case 'say':
        return runSay(interaction);
      case 'embed':
        return runEmbed(interaction);
      case 'announce':
        return runAnnounce(interaction);
      case 'nick':
        return runNick(interaction);
      case 'topic':
        return runTopic(interaction);
      case 'pin':
        return runPin(interaction, true);
      case 'unpin':
        return runPin(interaction, false);
      default:
        return interaction.reply({
          flags: V2 | MessageFlags.Ephemeral,
          components: [errorContainer({ title: 'Unknown subcommand', description: `**${sub}** is not wired up.` })],
        });
    }
  },
};

/* ---------------- purge ---------------- */

async function runPurge(interaction) {
  const denied = need(interaction, 'ManageMessages', 'Manage Messages');
  if (denied) return denied;

  const count = interaction.options.getInteger('count', true);
  const from = interaction.options.getUser('from');
  const onlyBots = interaction.options.getBoolean('bots') ?? false;
  const onlyLinks = interaction.options.getBoolean('links') ?? false;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const me = interaction.guild.members.me;
  if (!interaction.channel.permissionsFor(me)?.has(PermissionFlagsBits.ManageMessages)) {
    return interaction.editReply({
      flags: V2 | MessageFlags.Ephemeral,
      components: [errorContainer({ title: 'I lack permission', description: 'I need **Manage Messages** here to delete anything.' })],
    });
  }

  let collected = [];
  let remaining = Math.min(count, 100);
  let before = null;
  // Fetch in pages until we have `count` candidate messages (max 5 pages).
  for (let page = 0; page < 5 && remaining > 0; page++) {
    const fetched = await interaction.channel.messages.fetch({ limit: Math.min(remaining + 10, 100), before }).catch(() => null);
    if (!fetched?.size) break;
    const now = Date.now();
    const eligible = [...fetched.values()].filter((m) => {
      if (now - m.createdTimestamp > 13.9 * 24 * 3600 * 1000) return false; // bulk delete 14-day limit
      if (from && m.author?.id !== from.id) return false;
      if (onlyBots && !m.author?.bot) return false;
      if (onlyLinks && !/https?:\/\//i.test(m.content ?? '')) return false;
      return true;
    });
    collected = collected.concat(eligible.slice(0, remaining));
    remaining -= eligible.length;
    before = fetched.last()?.id;
    if (fetched.size < 10) break;
  }

  if (!collected.length) {
    return interaction.editReply({
      flags: V2 | MessageFlags.Ephemeral,
      components: [errorContainer({ title: 'Nothing to purge', description: 'No deletable messages matched those filters (or they are older than 14 days).' })],
    });
  }

  const deleted = await interaction.channel.bulkDelete(collected, true).catch(() => null);
  const n = deleted?.size ?? 0;

  await interaction.editReply({
    flags: V2 | MessageFlags.Ephemeral,
    components: [
      card({
        emoji: '🧹',
        title: `Purged ${n} message${n === 1 ? '' : 's'}`,
        body: [
          diffBlock({
            add: [`deleted ${n} message${n === 1 ? '' : 's'} in #${interaction.channel.name}`],
            del: [`${collected.length - n} could not be deleted (too old or already gone)`].filter(() => collected.length > n),
            max: 500,
          }),
          [
            from ? `filter: from **${from.tag}**` : null,
            onlyBots ? 'filter: bots only' : null,
            onlyLinks ? 'filter: links only' : null,
          ].filter(Boolean).join(' · ') || '-# no filters — swept everything recent',
        ],
      }),
    ],
  });
}

/* ---------------- slowmode ---------------- */

async function runSlowmode(interaction) {
  const denied = need(interaction, 'ManageChannels', 'Manage Channels');
  if (denied) return denied;
  const seconds = interaction.options.getInteger('seconds', true);
  await interaction.channel.setRateLimitPerUser(seconds, `slowmode via /server slowmode by ${interaction.user.tag}`).catch(() => null);
  return interaction.reply({
    flags: V2 | MessageFlags.Ephemeral,
    components: [
      card({
        emoji: '🐢',
        title: seconds === 0 ? 'Slowmode off' : `Slowmode: ${seconds}s`,
        body: [diffBlock({ add: [`#${interaction.channel.name} → ${seconds === 0 ? 'no delay' : `${seconds}s between messages`}`], max: 300 })],
      }),
    ],
  });
}

/* ---------------- lock / unlock ---------------- */

async function setLock(interaction, locking) {
  const denied = need(interaction, 'ManageChannels', 'Manage Channels');
  if (denied) return denied;
  const me = interaction.guild.members.me;
  const channel = interaction.channel;
  const target = locking ? false : null; // false = deny SendMessages, null = neutral
  const reason = locking
    ? `locked via /server lock by ${interaction.user.tag}`
    : `unlocked via /server unlock by ${interaction.user.tag}`;

  // Lock only @everyone's send permission; other overwrites stay untouched.
  const everyone = interaction.guild.roles.everyone;
  const current = channel.permissionsFor(everyone);
  await channel.permissionOverwrites
    .edit(everyone, { SendMessages: target }, { reason })
    .catch(() => null);

  const okNow = channel.permissionsFor(everyone)?.has(PermissionsBitField.Flags.SendMessages);
  return interaction.reply({
    flags: V2 | MessageFlags.Ephemeral,
    components: [
      card({
        accent: locking ? config.colors.error : config.colors.success,
        emoji: locking ? '🔒' : '🔓',
        title: locking ? 'Channel locked' : 'Channel unlocked',
        body: [
          diffBlock({
            add: locking ? [] : [`#${channel.name} — everyone can send messages again`],
            del: locking ? [`#${channel.name} — @everyone can no longer send messages`].filter(Boolean) : [],
            warn: locking && okNow ? ['permission edit did not stick — check my role position'] : [],
            max: 400,
          }),
          locking ? interaction.options.getString('reason') ? `reason: ${interaction.options.getString('reason')}` : null : null,
        ].filter(Boolean),
      }),
    ],
  });
}

async function runLock(interaction) {
  return setLock(interaction, true);
}

async function runUnlock(interaction) {
  return setLock(interaction, false);
}

/* ---------------- say / embed / announce ---------------- */

async function runSay(interaction) {
  const denied = need(interaction, 'ManageMessages', 'Manage Messages');
  if (denied) return denied;
  const text = interaction.options.getString('text', true);
  await interaction.channel.send({ content: text, allowedMentions: { parse: [] } });
  return interaction.reply({ flags: V2 | MessageFlags.Ephemeral, components: [card({ emoji: '💬', title: 'Sent', body: [diffBlock({ add: ['message delivered to #' + interaction.channel.name], max: 200 })] })] });
}

async function runEmbed(interaction) {
  const denied = need(interaction, 'ManageMessages', 'Manage Messages');
  if (denied) return denied;
  const title = interaction.options.getString('title', true);
  const description = interaction.options.getString('description', true);
  const colorRaw = interaction.options.getString('color');
  let color = config.colors.primary;
  if (colorRaw) {
    const m = /^#?([0-9a-f]{6})$/i.exec(colorRaw.trim());
    if (m) color = parseInt(m[1], 16);
  }
  await interaction.channel.send({ embeds: [new EmbedBuilder().setTitle(title).setDescription(description).setColor(color).setFooter({ text: 'via /server embed' })] });
  return interaction.reply({ flags: V2 | MessageFlags.Ephemeral, components: [card({ emoji: '🖼️', title: 'Embed sent', body: [diffBlock({ add: [`"${truncate(title, 60)}" → #${interaction.channel.name}`], max: 200 })] })] });
}

async function runAnnounce(interaction) {
  const denied = need(interaction, 'ManageMessages', 'Manage Messages');
  if (denied) return denied;
  const title = interaction.options.getString('title', true);
  const message = interaction.options.getString('message', true);
  const target = interaction.options.getChannel('channel') ?? interaction.channel;
  const role = interaction.options.getRole('ping');

  const canSend = target.permissionsFor(interaction.guild.members.me)?.has(PermissionFlagsBits.SendMessages);
  if (!canSend) {
    return interaction.reply({
      flags: V2 | MessageFlags.Ephemeral,
      components: [errorContainer({ title: 'No send permission', description: `I cannot post in **#${target.name}** — check my permissions there.` })],
    });
  }

  await target.send({
    content: role ? `${role}` : undefined,
    embeds: [new EmbedBuilder().setTitle(`📣 ${title}`).setDescription(message).setColor(config.colors.primary).setFooter({ text: `announced by ${interaction.user.tag}` })],
    allowedMentions: role ? { roles: [role.id] } : { parse: [] },
  });

  return interaction.reply({
    flags: V2 | MessageFlags.Ephemeral,
    components: [
      card({
        emoji: '📣',
        title: 'Announcement posted',
        body: [diffBlock({ add: [`"${truncate(title, 60)}" → #${target.name}${role ? ` (pinged ${role.name})` : ''}`], max: 300 })],
      }),
    ],
  });
}

/* ---------------- nick / topic / pin ---------------- */

async function runNick(interaction) {
  const denied = need(interaction, 'ChangeNickname', 'Manage Nicknames (for the bot)');
  if (denied) return denied;
  const name = interaction.options.getString('name');
  const me = interaction.guild.members.me;
  await me.setNickname(name ?? null, `nick via /server nick by ${interaction.user.tag}`).catch(() => null);
  return interaction.reply({
    flags: V2 | MessageFlags.Ephemeral,
    components: [card({ emoji: '🪪', title: name ? `Nickname → ${name}` : 'Nickname reset', body: [diffBlock({ add: [name ? `display name: ${name}` : 'display name: back to default'], max: 200 })] })],
  });
}

async function runTopic(interaction) {
  const denied = need(interaction, 'ManageChannels', 'Manage Channels');
  if (denied) return denied;
  const text = interaction.options.getString('text');
  await interaction.channel.setTopic(text ?? '', `topic via /server topic by ${interaction.user.tag}`).catch(() => null);
  return interaction.reply({
    flags: V2 | MessageFlags.Ephemeral,
    components: [card({ emoji: '📌', title: 'Topic updated', body: [diffBlock({ add: [text ? truncate(text, 300) : 'topic cleared'], max: 400 })] })],
  });
}

async function runPin(interaction, pinning) {
  const denied = need(interaction, 'ManageMessages', 'Manage Messages');
  if (denied) return denied;
  const id = String(interaction.options.getString('message_id', true)).trim();
  if (!/^\d{15,21}$/.test(id)) {
    return interaction.reply({
      flags: V2 | MessageFlags.Ephemeral,
      components: [errorContainer({ title: 'Not a message ID', description: 'Message IDs are 15-21 digits — enable Developer Mode and Copy Message ID.' })],
    });
  }
  const msg = await interaction.channel.messages.fetch(id).catch(() => null);
  if (!msg) {
    return interaction.reply({
      flags: V2 | MessageFlags.Ephemeral,
      components: [errorContainer({ title: 'Message not found', description: 'That ID is not a message in this channel.' })],
    });
  }
  if (pinning) await msg.pin(`pinned via /server pin by ${interaction.user.tag}`).catch(() => null);
  else await msg.unpin(`unpinned via /server unpin by ${interaction.user.tag}`).catch(() => null);
  return interaction.reply({
    flags: V2 | MessageFlags.Ephemeral,
    components: [card({ emoji: pinning ? '📌' : '📍', title: pinning ? 'Message pinned' : 'Message unpinned', body: [diffBlock({ add: [pinning ? 'pinned' : 'unpinned', truncate(msg.content ?? '(embed/attachment message)', 120)], max: 300 })] })],
  });
}
