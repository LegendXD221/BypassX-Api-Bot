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
import { store } from '../../storage.js';
import {
  refreshSupported,
  supported,
  measureApi,
  cacheClear,
  cacheStats,
  metrics,
} from '../../api.js';
import { truncate, sleep } from '../../util.js';
import { V2, card, errorContainer, broadcastContainer } from '../../components.js';
import { tokenStats } from '../../tokens.js';
import * as api from '../../api.js';

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
        .setDescription('Blacklist users from the bot')
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
        .addUserOption((o) => o.setName('user').setDescription('Target user (for add/remove)'))
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
        .addStringOption((o) => o.setName('command').setDescription('Command name or * for everything').setRequired(true))
        .addIntegerOption((o) =>
          o.setName('seconds').setDescription('Seconds (0 resets)').setRequired(true).setMinValue(0).setMaxValue(3600)
        )
    )
    .addSubcommand((sc) => sc.setName('reboot').setDescription('Restart the bot process')),
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
      case 'api':
        return subApi(interaction);
      case 'cache':
        return subCache(interaction);
      case 'cooldown':
        return subCooldown(interaction);
      case 'reboot':
        return subReboot(interaction);
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
        body: [`**${status}** · ${type} **${name}**`],
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
  const user = interaction.options.getUser('user');

  if (action === 'list') {
    const lines = store.blacklist.length
      ? store.blacklist.map((id) => `> \`${id}\``).join('\n')
      : '> Blacklist is empty.';
    return interaction.reply({
      flags: V2 | MessageFlags.Ephemeral,
      components: [card({ emoji: '🚫', title: `Blacklist (${store.blacklist.length})`, body: [lines] })],
    });
  }

  if (!user) {
    return interaction.reply({
      flags: V2 | MessageFlags.Ephemeral,
      components: [errorContainer({ title: 'User required', description: `Pick a user for **${action}**.` })],
    });
  }
  if (isOwner(user.id)) {
    return interaction.reply({
      flags: V2 | MessageFlags.Ephemeral,
      components: [errorContainer({ title: 'Not allowed', description: 'Owners cannot be blacklisted.' })],
    });
  }

  if (action === 'add') {
    store.blacklistAdd(user.id);
  } else {
    store.blacklistRemove(user.id);
  }

  await interaction.reply({
    flags: V2 | MessageFlags.Ephemeral,
    components: [
      card({
        emoji: '🚫',
        title: `Blacklist ${action === 'add' ? '— added' : '— removed'}`,
        body: [`**${user.tag}** (\`${user.id}\`) · ${store.blacklist.length} user(s) blacklisted now.`],
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

  const overrides = store.cooldownCfg;
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

async function subReboot(interaction) {
  await interaction.reply({
    flags: V2 | MessageFlags.Ephemeral,
    components: [card({ accent: 0xfee75c, emoji: '🔄', title: 'Rebooting', body: ['Process is restarting now — expect a short offline window.'] })],
  });
  setTimeout(() => process.exit(0), 750);
}
