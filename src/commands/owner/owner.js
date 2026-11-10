import {
  SlashCommandBuilder,
  ActivityType,
  MessageFlags,
  PermissionsBitField,
  ChannelType,
} from 'discord.js';
import { inspect } from 'node:util';
import { createRequire } from 'node:module';
import { config, isOwner } from '../../config.js';
import { store, dbHealthy } from '../../db.js';
import {
  refreshSupported,
  supported,
  measureApi,
  cacheClear,
  cacheStats,
  metrics,
} from '../../api.js';
import { truncate, sleep, formatUptime } from '../../util.js';
import { V2, card, errorContainer, broadcastContainer } from '../../components.js';
import { kvTable, codeBlock } from '../../format.js';
import { tokenStats } from '../../tokens.js';
import * as api from '../../api.js';
import { commandData } from '../index.js';

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const require = createRequire(import.meta.url);

const ACTIVITY_TYPES = {
  playing: ActivityType.Playing,
  watching: ActivityType.Watching,
  listening: ActivityType.Listening,
  competing: ActivityType.Competing,
};

function findSendableChannel(guild) {
  const me = guild.members.me;
  const canSend = (ch) =>
    ch?.viewable && ch.permissionsFor(me)?.has(PermissionsBitField.Flags.SendMessages);
  if (guild.systemChannel && canSend(guild.systemChannel)) return guild.systemChannel;
  return (
    guild.channels.cache.find(
      (ch) => ch.type === ChannelType.GuildText && canSend(ch)
    ) ?? null
  );
}

export default {
  data: new SlashCommandBuilder()
    .setName('owner')
    .setDescription('Bot owner controls — extremely OP, bot owner only')
    .addSubcommand((sc) =>
      sc
        .setName('eval')
        .setDescription('Run JavaScript in the bot process')
        .addStringOption((o) => o.setName('code').setDescription('Code to evaluate').setRequired(true))
    )
    .addSubcommand((sc) => sc.setName('stats').setDescription('Deep global statistics'))
    .addSubcommand((sc) => sc.setName('servers').setDescription('List every guild the bot is in'))
    .addSubcommand((sc) =>
      sc
        .setName('leave')
        .setDescription('Leave a guild by ID')
        .addStringOption((o) => o.setName('guild_id').setDescription('Guild ID to leave').setRequired(true))
    )
    .addSubcommand((sc) =>
      sc
        .setName('presence')
        .setDescription('Set the bot presence')
        .addStringOption((o) =>
          o
            .setName('status')
            .setDescription('Presence status')
            .addChoices(
              { name: 'online', value: 'online' },
              { name: 'idle', value: 'idle' },
              { name: 'do not disturb', value: 'dnd' },
              { name: 'invisible', value: 'invisible' }
            )
        )
        .addStringOption((o) =>
          o
            .setName('type')
            .setDescription('Activity type')
            .addChoices(
              { name: 'playing', value: 'playing' },
              { name: 'watching', value: 'watching' },
              { name: 'listening', value: 'listening' },
              { name: 'competing', value: 'competing' }
            )
        )
        .addStringOption((o) => o.setName('name').setDescription('Activity name').setMaxLength(80))
    )
    .addSubcommand((sc) =>
      sc
        .setName('broadcast')
        .setDescription('Announce something in every guild')
        .addStringOption((o) => o.setName('message').setDescription('Broadcast message').setRequired(true).setMaxLength(1500))
    )
    .addSubcommand((sc) =>
      sc
        .setName('dm')
        .setDescription('DM a user through the bot')
        .addUserOption((o) => o.setName('user').setDescription('Recipient').setRequired(true))
        .addStringOption((o) => o.setName('message').setDescription('Message to send').setRequired(true).setMaxLength(1500))
    )
    .addSubcommand((sc) =>
      sc
        .setName('blacklist')
        .setDescription('Blacklist a user or an entire guild')
        .addStringOption((o) =>
          o
            .setName('action')
            .setDescription('What to do')
            .setRequired(true)
            .addChoices(
              { name: 'add', value: 'add' },
              { name: 'remove', value: 'remove' },
              { name: 'list', value: 'list' }
            )
        )
        .addStringOption((o) =>
          o
            .setName('target')
            .setDescription('Target type')
            .addChoices(
              { name: 'user', value: 'user' },
              { name: 'guild', value: 'guild' }
            )
        )
        .addUserOption((o) => o.setName('user').setDescription('Target user (for users)'))
        .addStringOption((o) => o.setName('id').setDescription('Target ID (for guilds)'))
        .addStringOption((o) => o.setName('reason').setDescription('Reason').setMaxLength(200))
    )
    .addSubcommand((sc) =>
      sc
        .setName('logs')
        .setDescription('Recent bypass logs from the database')
        .addStringOption((o) =>
          o
            .setName('scope')
            .setDescription('Scope')
            .addChoices(
              { name: 'global', value: 'global' },
              { name: 'user', value: 'user' },
              { name: 'guild', value: 'guild' }
            )
        )
        .addStringOption((o) => o.setName('id').setDescription('User or guild ID (for user/guild scope)'))
        .addIntegerOption((o) => o.setName('limit').setDescription('How many (1-20, default 10)').setMinValue(1).setMaxValue(20))
    )
    .addSubcommand((sc) =>
      sc
        .setName('maintenance')
        .setDescription('Toggle maintenance mode (pauses the bot for everyone but you)')
        .addStringOption((o) =>
          o
            .setName('mode')
            .setDescription('On or off')
            .setRequired(true)
            .addChoices(
              { name: 'on', value: 'on' },
              { name: 'off', value: 'off' }
            )
        )
    )
    .addSubcommand((sc) => sc.setName('api').setDescription('Diagnose the BypassX API connection'))
    .addSubcommand((sc) =>
      sc
        .setName('cache')
        .setDescription('Inspect or clear the local result cache')
        .addStringOption((o) =>
          o
            .setName('action')
            .setDescription('What to do')
            .setRequired(true)
            .addChoices(
              { name: 'stats', value: 'stats' },
              { name: 'clear', value: 'clear' }
            )
        )
    )
    .addSubcommand((sc) =>
      sc
        .setName('cooldown')
        .setDescription('Set a command cooldown in seconds (0 = reset to default)')
        .addStringOption((o) =>
          o.setName('command').setDescription('Command name or * for everything').setRequired(true).setAutocomplete(true)
        )
        .addIntegerOption((o) =>
          o.setName('seconds').setDescription('Seconds (0 resets)').setRequired(true).setMinValue(0).setMaxValue(3600)
        )
    )
    .addSubcommand((sc) =>
      sc.setName('refresh').setDescription('Re-register all slash commands globally (instant sync)')
    )
    .addSubcommand((sc) =>
      sc
        .setName('feedback')
        .setDescription('Recent user feedback from /feedback')
        .addIntegerOption((o) =>
          o.setName('limit').setDescription('How many (1-10, default 5)').setMinValue(1).setMaxValue(10)
        )
    )
    .addSubcommand((sc) => sc.setName('reboot').setDescription('Restart the bot process'))
    .addSubcommand((sc) =>
      sc
        .setName('sql')
        .setDescription('Run a READ-ONLY SQL query against the database')
        .addStringOption((o) => o.setName('query').setDescription('SELECT/WITH/SHOW/EXPLAIN only').setRequired(true).setMaxLength(500))
    )
    .addSubcommand((sc) =>
      sc
        .setName('avatar')
        .setDescription('Set the bot avatar from an image URL')
        .addStringOption((o) => o.setName('url').setDescription('Image URL').setRequired(true).setMaxLength(500))
    )
    .addSubcommand((sc) =>
      sc
        .setName('username')
        .setDescription('Change the bot username (max 2/hour — Discord enforced)')
        .addStringOption((o) => o.setName('name').setDescription('New username').setRequired(true).setMaxLength(32))
    )
    .addSubcommand((sc) =>
      sc
        .setName('cmdstats')
        .setDescription('Per-command usage counters from the database')
    )
    .addSubcommand((sc) =>
      sc
        .setName('prune')
        .setDescription('Delete bypass logs older than N days')
        .addIntegerOption((o) => o.setName('days').setDescription('Older than N days (default 30)').setMinValue(1).setMaxValue(365))
    )
    .addSubcommand((sc) =>
      sc
        .setName('config')
        .setDescription('Dump every live flag — maintenance, disabled commands, cooldowns')
    ),
  ownerOnly: true,
  meta: { cooldownMs: 500 },

  async execute(interaction) {
    // Defense in depth — the registry gate already checked, check again here.
    if (!isOwner(interaction.user.id)) {
      return interaction.reply({
        flags: V2 | MessageFlags.Ephemeral,
        components: [errorContainer({ title: 'Owner only', description: 'This command is reserved for the bot owner.' })],
      });
    }
    const sub = interaction.options.getSubcommand();
    switch (sub) {
      case 'eval':
        return subEval(interaction);
      case 'stats':
        return subStats(interaction);
      case 'servers':
        return subServers(interaction);
      case 'leave':
        return subLeave(interaction);
      case 'presence':
        return subPresence(interaction);
      case 'broadcast':
        return subBroadcast(interaction);
      case 'dm':
        return subDm(interaction);
      case 'blacklist':
        return subBlacklist(interaction);
      case 'logs':
        return subLogs(interaction);
      case 'maintenance':
        return subMaintenance(interaction);
      case 'api':
        return subApi(interaction);
      case 'cache':
        return subCache(interaction);
      case 'cooldown':
        return subCooldown(interaction);
      case 'feedback':
        return subFeedback(interaction);
      case 'refresh':
        return subRefresh(interaction);
      case 'reboot':
        return subReboot(interaction);
      case 'sql':
        return subSql(interaction);
      case 'avatar':
        return subAvatar(interaction);
      case 'username':
        return subUsername(interaction);
      case 'cmdstats':
        return subCmdstats(interaction);
      case 'prune':
        return subPrune(interaction);
      case 'config':
        return subConfig(interaction);
      default:
        return;
    }
  },
};

/* ------------------------------------------------------------------ */

async function subEval(interaction) {
  const code = interaction.options.getString('code', true);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const started = Date.now();
  try {
    const fn = new AsyncFunction('client', 'interaction', 'config', 'store', 'api', 'require', code);
    const result = await fn(interaction.client, interaction, config, store, api, require);
    const out =
      typeof result === 'string'
        ? result
        : inspect(result, { depth: 3, maxArrayLength: 25, maxStringLength: 500 });
    await interaction.editReply({
      content: `✅ **Evaluated in ${Date.now() - started}ms**\n\`\`\`js\n${truncate(out, 1800)}\n\`\`\``,
    });
  } catch (e) {
    await interaction.editReply({
      content: `❌ **Failed after ${Date.now() - started}ms**\n\`\`\`js\n${truncate(e?.stack ?? String(e), 1800)}\n\`\`\``,
    });
  }
}

async function subStats(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await refreshSupported();
  const db = await store.publicStats();
  const c = store.counters;
  const mem = process.memoryUsage();

  const lines = [
    `**Runtime** — uptime ${formatUptime(process.uptime())} · ${interaction.client.guilds.cache.size} servers · Node ${process.version} · v${config.version}`,
    `**Bypasses (lifetime)** — ${c.bypasses ?? 0} total · ${c.autoBypasses ?? 0} auto · ${c.failures ?? 0} failed · ${metrics.cacheHits} cache hits this session`,
    db
      ? `**Logged (DB)** — ${db.total} total · ${db.last24h} in 24h · ${db.successRate}% success · ${db.users} unique user(s)`
      : '**Logged (DB)** — database offline, lifetime counters only',
    `**Auto-bypass** — ${store.totalAutobypassChannels()} channel(s) armed across ${store.autobypassGuildCount()} server(s)`,
    `**Process** — heap ${(mem.heapUsed / 1048576).toFixed(1)} MB · rss ${(mem.rss / 1048576).toFixed(1)} MB · db ${dbHealthy() ? '✅ connected' : '❌ memory-only'}`,
  ];

  if (db?.topDomains?.length) {
    lines.push(`**Top domains (30d)**\n${db.topDomains.map((d) => `> \`${d.domain}\` — ${d.n}`).join('\n')}`);
  }

  await interaction.editReply({
    flags: V2 | MessageFlags.Ephemeral,
    components: [card({ emoji: '📈', title: 'Owner statistics', body: lines })],
  });
}

async function subServers(interaction) {
  const guilds = [...interaction.client.guilds.cache.values()].sort(
    (a, b) => (b.memberCount ?? 0) - (a.memberCount ?? 0)
  );
  const lines = guilds
    .slice(0, 30)
    .map((g) => `> \`${g.id}\` **${g.name}** · ${g.memberCount ?? '?'} members`);
  if (guilds.length > 30) lines.push(`> …and ${guilds.length - 30} more`);
  if (!lines.length) lines.push('> Not in any guild yet.');

  await interaction.reply({
    flags: V2 | MessageFlags.Ephemeral,
    components: [
      card({ emoji: '🏠', title: `Guilds (${guilds.length})`, body: [lines.join('\n')] }),
    ],
  });
}

async function subLeave(interaction) {
  const id = interaction.options.getString('guild_id', true);
  const guild = await interaction.client.guilds.fetch(id).catch(() => null);
  if (!guild) {
    return interaction.reply({
      flags: V2 | MessageFlags.Ephemeral,
      components: [errorContainer({ title: 'Guild not found', description: `I am not in a guild with ID \`${id}\`.` })],
    });
  }
  const name = guild.name;
  await guild.leave();
  await interaction.reply({
    flags: V2 | MessageFlags.Ephemeral,
    components: [card({ accent: 0x2b2d31, emoji: '👋', title: 'Left guild', body: [`**${name}** (\`${id}\`)`] })],
  });
}

async function subPresence(interaction) {
  const status = interaction.options.getString('status') ?? 'online';
  const type = interaction.options.getString('type') ?? 'watching';
  const name = interaction.options.getString('name') ?? 'links get bypassed';

  interaction.client.user.setPresence({
    status,
    activities: [{ type: ACTIVITY_TYPES[type] ?? ActivityType.Watching, name }],
  });

  await interaction.reply({
    flags: V2 | MessageFlags.Ephemeral,
    components: [
      card({
        emoji: '🪄',
        title: 'Presence updated',
        body: [`**${status}** · ${type} **${name}**`, '-# Resets to rotation on reboot.'],
      }),
    ],
  });
}

async function subBroadcast(interaction) {
  const message = interaction.options.getString('message', true);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  let ok = 0;
  const failed = [];
  for (const guild of interaction.client.guilds.cache.values()) {
    const ch = findSendableChannel(guild);
    if (!ch) {
      failed.push(guild.name);
      continue;
    }
    try {
      await ch.send({
        flags: V2,
        components: [broadcastContainer({ message, requesterTag: interaction.user.tag })],
        allowedMentions: { parse: [] },
      });
      ok += 1;
    } catch {
      failed.push(guild.name);
    }
    await sleep(350);
  }

  await interaction.editReply({
    content: `📣 Broadcast delivered to **${ok}/${ok + failed.length}** servers.${
      failed.length
        ? `\nFailed (${failed.length}): ${failed.slice(0, 8).join(', ')}${failed.length > 8 ? '…' : ''}`
        : ''
    }`,
  });
}

async function subDm(interaction) {
  const user = interaction.options.getUser('user', true);
  const message = interaction.options.getString('message', true);
  try {
    await user.send({
      flags: V2,
      components: [broadcastContainer({ message, requesterTag: 'BypassX owner' })],
    });
    await interaction.reply({
      flags: V2 | MessageFlags.Ephemeral,
      components: [card({ emoji: '📨', title: 'DM sent', body: [`Delivered to **${user.tag}** (\`${user.id}\`).`] })],
    });
  } catch {
    await interaction.reply({
      flags: V2 | MessageFlags.Ephemeral,
      components: [errorContainer({ title: 'Could not DM', description: `${user.tag} may have DMs closed or me blocked.` })],
    });
  }
}

async function subBlacklist(interaction) {
  const action = interaction.options.getString('action', true);
  const target = interaction.options.getString('target') ?? 'user';
  const user = interaction.options.getUser('user');
  const id = interaction.options.getString('id');
  const reason = interaction.options.getString('reason');

  if (action === 'list') {
    const rows = await store.blacklistList();
    const lines = rows.length
      ? rows.map((r) => `> \`${r.type}\` \`${r.target_id}\`${r.reason ? ` — ${truncate(r.reason, 80)}` : ''}`).join('\n')
      : '> Blacklist is empty.';
    return interaction.reply({
      flags: V2 | MessageFlags.Ephemeral,
      components: [card({ emoji: '🚫', title: `Blacklist (${rows.length})`, body: [lines] })],
    });
  }

  // Resolve the target ID: user option wins, otherwise the id option.
  const targetId = target === 'user' ? (user?.id ?? (/\d{17,20}/.test(id ?? '') ? id : null)) : id;
  if (!targetId) {
    return interaction.reply({
      flags: V2 | MessageFlags.Ephemeral,
      components: [
        errorContainer({
          title: 'Target required',
          description:
            target === 'user'
              ? 'Pick a **user** or provide an **id** for the blacklist action.'
              : 'Provide a **guild id** for the blacklist action.',
        }),
      ],
    });
  }
  if (target === 'user' && isOwner(targetId)) {
    return interaction.reply({
      flags: V2 | MessageFlags.Ephemeral,
      components: [errorContainer({ title: 'Not allowed', description: 'Owners cannot be blacklisted.' })],
    });
  }

  if (action === 'add') store.blacklistAdd(target, targetId, reason, interaction.user.id);
  else store.blacklistRemove(target, targetId);

  await interaction.reply({
    flags: V2 | MessageFlags.Ephemeral,
    components: [
      card({
        emoji: '🚫',
        title: `Blacklist — ${action === 'add' ? 'added' : 'removed'}`,
        body: [`\`${target}\` \`${targetId}\`${reason ? ` — ${reason}` : ''}`, action === 'add' ? 'They can no longer use the bot anywhere.' : 'They can use the bot again.'],
      }),
    ],
  });
}

async function subLogs(interaction) {
  const scope = interaction.options.getString('scope') ?? 'global';
  const id = interaction.options.getString('id');
  const limit = interaction.options.getInteger('limit') ?? 10;

  if (scope !== 'global' && !/\d{17,20}/.test(id ?? '')) {
    return interaction.reply({
      flags: V2 | MessageFlags.Ephemeral,
      components: [errorContainer({ title: 'ID required', description: `Provide an **id** for the \`${scope}\` scope.` })],
    });
  }

  const rows = await store.recentLogs({
    userId: scope === 'user' ? id : null,
    guildId: scope === 'guild' ? id : null,
    limit,
  });

  const lines = rows.length
    ? rows.map((r) => {
        const when = `<t:${Math.floor(new Date(r.created_at).getTime() / 1000)}:R>`;
        const status = r.success ? '✅' : '❌';
        const where = r.guild_id ? ` · guild \`${r.guild_id}\`` : '';
        return `> ${status} \`${r.source ?? '?'}\` \`${truncate(r.domain ?? r.url ?? '—', 40)}\` ${r.user_id ? `<@${r.user_id}>` : ''}${where} ${when}`;
      })
    : ['> No matching log rows yet.'];

  await interaction.reply({
    flags: V2 | MessageFlags.Ephemeral,
    components: [
      card({
        emoji: '🧾',
        title: `Bypass logs — ${scope}`,
        subtitle: dbHealthy() ? 'live from Neon Postgres' : 'database offline',
        body: [lines.join('\n')],
      }),
    ],
  });
}

async function subMaintenance(interaction) {
  const mode = interaction.options.getString('mode', true);
  const on = mode === 'on';
  store.setConfig('maintenance', on);

  await interaction.reply({
    flags: V2 | MessageFlags.Ephemeral,
    components: [
      card({
        accent: on ? 0xfee75c : 0x57f287,
        emoji: '🛠️',
        title: on ? 'Maintenance mode — ON' : 'Maintenance mode — OFF',
        body: [
          on
            ? 'Everyone except you now gets a maintenance notice. Owner commands keep working.'
            : 'The bot is fully available again.',
        ],
      }),
    ],
  });
}

async function subApi(interaction) {
  await refreshSupported();
  const probe = await measureApi();
  const ageMin = supported.fetchedAt ? Math.round((Date.now() - supported.fetchedAt) / 60000) : null;

  await interaction.reply({
    flags: V2 | MessageFlags.Ephemeral,
    components: [
      card({
        emoji: '🛰️',
        title: 'BypassX API diagnostics',
        subtitle: config.apiUrl,
        body: [
          `**Key** ${config.apiKey ? '✅ configured' : '❌ missing — bypasses will fail'}`,
          `**Probe** ${probe.ok ? `✅ HTTP ${probe.status} in ${probe.ms} ms` : `❌ unreachable (${probe.ms} ms)`}`,
          `**Registry** ${supported.count || '—'} services · ${supported.domainCount || '—'} domains${ageMin != null ? ` · refreshed ${ageMin} min ago` : ''}`,
          `**Session** ${metrics.apiCalls} calls · ${metrics.apiFailures} failures · ${metrics.cacheHits} cache hits`,
        ],
      }),
    ],
  });
}

async function subCache(interaction) {
  const action = interaction.options.getString('action', true);
  if (action === 'clear') {
    const cleared = cacheClear();
    return interaction.reply({
      flags: V2 | MessageFlags.Ephemeral,
      components: [card({ emoji: '🧹', title: 'Cache cleared', body: [`Removed **${cleared}** cached result(s).`] })],
    });
  }
  await interaction.reply({
    flags: V2 | MessageFlags.Ephemeral,
    components: [
      card({
        emoji: '🧠',
        title: 'Cache statistics',
        body: [
          `**Result cache** ${cacheStats().size} entr${cacheStats().size === 1 ? 'y' : 'ies'} (10 min TTL, 250 max)`,
          `**Hits this session** ${metrics.cacheHits} · **live button tokens** ${tokenStats()}`,
        ],
      }),
    ],
  });
}

async function subCooldown(interaction) {
  const name = interaction.options.getString('command', true).toLowerCase().replace(/^\//, '');
  const seconds = interaction.options.getInteger('seconds', true);

  if (name !== '*' && !interaction.client.commands.has(name)) {
    return interaction.reply({
      flags: V2 | MessageFlags.Ephemeral,
      components: [errorContainer({ title: 'Unknown command', description: `\`/${name}\` is not a command of mine.` })],
    });
  }

  store.setCooldown(name, seconds);

  const overrides = store.cooldownOverrides();
  const table = interaction.client.commands
    .map((cmd) => {
      const def = (cmd.meta?.cooldownMs ?? 0) / 1000;
      const eff = overrides[cmd.data.name] ?? overrides['*'] ?? def;
      const src = overrides[cmd.data.name] ? '' : overrides['*'] && def !== eff ? ' (global)' : '';
      return `> \`/${cmd.data.name}\` — ${eff}s${src}`;
    })
    .join('\n');

  await interaction.reply({
    flags: V2 | MessageFlags.Ephemeral,
    components: [
      card({
        emoji: '⏱️',
        title: seconds > 0 ? `Cooldown set — ${name} → ${seconds}s` : `Cooldown reset — ${name}`,
        body: [table || '> No commands registered.'],
      }),
    ],
  });
}

async function subRefresh(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    await interaction.client.application.commands.set(commandData);
    await interaction.editReply({
      content: `✅ Re-registered **${commandData.length}** global application commands.`,
    });
  } catch (e) {
    await interaction.editReply({
      content: `❌ Registration failed: \`${truncate(String(e?.message ?? e), 300)}\``,
    });
  }
}

async function subFeedback(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const rows = await store.recentFeedback(interaction.options.getInteger('limit') ?? 5);
  const lines = rows.length
    ? rows.map((r) => {
        const when = r.at ? `<t:${Math.floor(new Date(r.at).getTime() / 1000)}:R>` : '';
        return `> **${truncate(r.from ?? 'unknown', 40)}**${r.guild ? ` · ${truncate(r.guild, 30)}` : ''} ${when}\n> ${truncate(r.message ?? '', 200)}`;
      })
    : ['> No feedback received yet.'];
  await interaction.editReply({
    flags: V2 | MessageFlags.Ephemeral,
    components: [card({ emoji: '📝', title: `Recent feedback (${rows.length})`, body: [lines.join('\n')] })],
  });
}

async function subReboot(interaction) {
  await interaction.reply({
    flags: V2 | MessageFlags.Ephemeral,
    components: [card({ accent: 0xfee75c, emoji: '🔄', title: 'Rebooting', body: ['Process is restarting now — expect a short offline window.'] })],
  });
  setTimeout(() => process.exit(0), 750);
}

/* ------------------------------------------------------------------ */
/* v2.0 owner additions                                                */
/* ------------------------------------------------------------------ */

async function subSql(interaction) {
  const query = String(interaction.options.getString('query', true)).trim();
  // Full-string keyword scan — the old after-';' scan let
  // `WITH d AS (DELETE …) SELECT` straight through.
  const startsReadOnly = /^(select|with|show|explain|table)\b/i.test(query);
  const hasModifier = /\b(delete|insert|update|drop|alter|truncate|create|grant|revoke|copy|vacuum|call|do|listen|notify|reindex|cluster|comment|lock|move|fetch|refresh|import|security|procedure|function)\b/i.test(query.replace(/^\s*(with|select|show|explain|table)\b/i, ''));
  if (!startsReadOnly || hasModifier || query.includes(';')) {
    return interaction.reply({
      flags: V2 | MessageFlags.Ephemeral,
      components: [errorContainer({ title: 'Read-only enforced', description: 'Only single-statement `SELECT` / `WITH` / `SHOW` / `EXPLAIN` / `TABLE` queries run here — no data-modifying keywords.' })],
    });
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const res = await store.rawQuery(query);
    const rows = res?.rows ?? [];
    const body = rows.length
      ? codeBlock('json', truncate(JSON.stringify(rows, null, 1), 1700))
      : codeBlock('ml', '0 rows returned');
    await interaction.editReply({
      flags: V2 | MessageFlags.Ephemeral,
      components: [card({ emoji: '🗄️', title: `SQL — ${rows.length} row(s)`, body: [truncate(query, 150), body] })],
    });
  } catch (e) {
    await interaction.editReply({
      flags: V2 | MessageFlags.Ephemeral,
      components: [errorContainer({ title: 'SQL failed', description: truncate(String(e?.message ?? e), 300) })],
    });
  }
}

async function subAvatar(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    await interaction.client.user.setAvatar(interaction.options.getString('url', true));
    await interaction.editReply({
      flags: V2 | MessageFlags.Ephemeral,
      components: [card({ emoji: '🎨', title: 'Avatar updated', body: ['Propagation can take a few minutes across clients.'] })],
    });
  } catch (e) {
    await interaction.editReply({
      flags: V2 | MessageFlags.Ephemeral,
      components: [errorContainer({ title: 'Avatar rejected', description: truncate(String(e?.message ?? e), 300) })],
    });
  }
}

async function subUsername(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    await interaction.client.user.setUsername(interaction.options.getString('name', true));
    await interaction.editReply({
      flags: V2 | MessageFlags.Ephemeral,
      components: [card({ emoji: '🪪', title: 'Username updated', body: ['Discord allows this twice per hour — mind the rate limit.'] })],
    });
  } catch (e) {
    await interaction.editReply({
      flags: V2 | MessageFlags.Ephemeral,
      components: [errorContainer({ title: 'Username rejected', description: truncate(String(e?.message ?? e), 300) })],
    });
  }
}

async function subCmdstats(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const counts = await store.commandCounts();
  if (!counts.length) {
    return interaction.editReply({
      flags: V2 | MessageFlags.Ephemeral,
      components: [card({ emoji: '📊', title: 'Command usage', body: ['No per-command counters recorded yet — they fill as commands run.'] })],
    });
  }
  const total = counts.reduce((n, c) => n + c.count, 0);
  await interaction.editReply({
    flags: V2 | MessageFlags.Ephemeral,
    components: [
      card({
        emoji: '📊',
        title: `Command usage — ${total} total runs`,
        body: [
          kvTable(
            counts.slice(0, 15).map((c) => [`/${c.name}`, `${c.count} (${Math.round((c.count / total) * 100)}%)`]),
            { title: 'TOP COMMANDS' }
          ),
        ],
      }),
    ],
  });
}

async function subPrune(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const days = interaction.options.getInteger('days') ?? 30;
  const n = await store.pruneLogs(days);
  await interaction.editReply({
    flags: V2 | MessageFlags.Ephemeral,
    components: [
      card({
        emoji: '🧹',
        title: n == null ? 'Database offline' : `Pruned ${n} log row(s)`,
        body: [n == null ? 'Nothing was deleted — the database is unreachable.' : `Deleted bypass logs older than **${days}** day(s).`],
      }),
    ],
  });
}

async function subConfig(interaction) {
  const [maintenance, disabledCommands] = await Promise.all([
    store.getConfig('maintenance', false),
    store.getConfig('disabledCommands', []),
  ]);
  const overrides = store.cooldownOverrides();
  await interaction.reply({
    flags: V2 | MessageFlags.Ephemeral,
    components: [
      card({
        emoji: '🎚️',
        title: 'Live configuration',
        body: [
          kvTable(
            [
              ['maintenance', maintenance ? 'ON — bot paused for everyone but you' : 'off'],
              ['disabled commands', disabledCommands.length ? disabledCommands.map((c) => `/${c}`).join(', ') : 'none'],
              ['cooldown overrides', Object.keys(overrides).length ? Object.entries(overrides).map(([k, v]) => `${k}=${v}s`).join(', ') : 'none'],
              ['api key', config.apiKey ? 'configured' : 'MISSING — bypasses offline'],
              ['dashboard', config.dashboardToken ? 'token set — /dashboard live' : 'not configured'],
              ['database', dbHealthy() ? 'connected' : 'memory-only'],
              ['version', `v${config.version}`],
            ],
            { title: 'FLAGS' }
          ),
        ],
      }),
    ],
  });
}
