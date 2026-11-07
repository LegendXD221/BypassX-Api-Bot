import { ActivityType } from 'discord.js';
import { config } from '../config.js';
import { log } from '../logger.js';
import { commandData } from '../commands/index.js';
import { refreshSupported } from '../api.js';
import { cleanupTokens } from '../tokens.js';

export async function onReady(client) {
  log.ok(`Logged in as ${client.user.tag} (${client.user.id}) — ${client.guilds.cache.size} guild(s)`);
  client.user.setPresence({
    status: 'online',
    activities: [{ type: ActivityType.Watching, name: 'links get bypassed' }],
  });

  await registerCommands(client);

  refreshSupported(true);
  setInterval(() => refreshSupported(), 6 * 3600_000).unref();
  setInterval(cleanupTokens, 5 * 60_000).unref();
}

async function registerCommands(client) {
  try {
    await client.application.commands.set(commandData);
    log.ok(`Registered ${commandData.length} global slash commands`);
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
