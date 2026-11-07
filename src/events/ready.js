import { ActivityType } from 'discord.js';
import { config } from '../config.js';
import { log } from '../logger.js';
import { commandData } from '../commands/index.js';
import { refreshSupported } from '../api.js';
import { cleanupTokens } from '../tokens.js';
import { leaveCard, V2 } from '../components.js';

export async function onReady(client) {
  log.ok(`Logged in as ${client.user.tag} (${client.user.id}) — ${client.guilds.cache.size} guild(s)`);
  if (client.autobypassDisabled) {
    log.warn('Auto-bypass disabled: Message Content intent unavailable.');
  }

  await registerCommands(client);

  startPresenceRotation(client);
  startSmallGuildSweep(client);

  refreshSupported(true);
  setInterval(() => refreshSupported(), 6 * 3600_000).unref();
  setInterval(cleanupTokens, 5 * 60_000).unref();
}

async function registerCommands(client) {
  try {
    await client.application.commands.set(commandData);
    log.ok(`Registered ${commandData.length} global application commands`);
    if (config.guildId) {
      const guild = client.guilds.cache.get(config.guildId);
      if (guild) {
        await guild.commands.set(commandData);
        log.ok(`Also registered to guild ${guild.id} (instant)`);
      } else {
        log.warn(`GUILD_ID ${config.guildId} set but bot is not in that guild`);
      }
    }
  } catch (e) {
    log.err('Slash command registration failed:', e);
  }
}

/* ------------------------------------------------------------------ */
/* Rotating presence (owner can override via /owner presence)          */
/* ------------------------------------------------------------------ */

function startPresenceRotation(client) {
  const templates = () => [
    { type: ActivityType.Watching, name: 'links get bypassed' },
    { type: ActivityType.Listening, name: `${client.guilds.cache.size} server${client.guilds.cache.size === 1 ? '' : 's'}` },
    { type: ActivityType.Playing, name: 'BypassX Api ⚡' },
  ];
  let i = 0;
  const apply = () => client.user.setActivity(templates()[i++ % templates().length]);
  apply();
  setInterval(apply, 2 * 60_000).unref();
}

/* ------------------------------------------------------------------ */
/* Periodic sweep — leave any server that dropped below the minimum    */
/* member count after we joined (join-time check lives in guildCreate).*/
/* ------------------------------------------------------------------ */

/** One sweep pass — exported so /owner sweep can trigger it on demand. */
export async function runSmallGuildSweep(client) {
  let left = 0;
  for (const guild of client.guilds.cache.values()) {
    const count = guild.memberCount ?? 0;
    if (count && count < config.minGuildMembers) {
      log.warn(`Sweep: leaving ${guild.name} (${guild.id}) — ${count} < ${config.minGuildMembers} members`);
      if (count > 5) await dmOwnerBeforeLeaving(guild);
      await guild.leave().catch(() => {});
      left += 1;
    }
  }
  return left;
}

function startSmallGuildSweep(client) {
  const sweep = () => runSmallGuildSweep(client);
  setTimeout(sweep, 60_000).unref();
  setInterval(sweep, 10 * 60_000).unref();
}

async function dmOwnerBeforeLeaving(guild) {
  try {
    const owner = await guild.fetchOwner();
    await owner.send({ flags: V2, components: [leaveCard(guild)] });
  } catch {
    /* owner DMs closed — proceed with the leave */
  }
}
