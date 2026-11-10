import { ActivityType } from 'discord.js';
import { config } from '../config.js';
import { log } from '../logger.js';
import { commandData } from '../commands/index.js';
import { refreshSupported } from '../api.js';
import { startApiWatchdog } from '../watchdog.js';
import { cleanupTokens } from '../tokens.js';

/**
 * Interval stacking guard: every dashboard gateway restart logs a NEW client
 * whose ClientReady re-runs this function. Without the guard below each
 * restart used to double the watchdog/refresh/cleanup intervals and leave
 * the old presence rotation calling setActivity on a destroyed client (one
 * rejection per tick, forever).
 */
const started = {
  watchdog: false,
  registry: false,
  tokenCleanup: false,
};

export async function onReady(client) {
  log.ok(`Logged in as ${client.user.tag} (${client.user.id}) — ${client.guilds.cache.size} guild(s)`);
  if (client.autobypassDisabled) {
    log.warn('Auto-bypass disabled: Message Content intent unavailable.');
  }

  await registerCommands(client);

  startPresenceRotation(client);
  if (!started.watchdog) {
    started.watchdog = true;
    startApiWatchdog();
  }

  if (!started.registry) {
    started.registry = true;
    refreshSupported(true);
    setInterval(() => refreshSupported(), 6 * 3600_000).unref();
  }
  if (!started.tokenCleanup) {
    started.tokenCleanup = true;
    setInterval(cleanupTokens, 5 * 60_000).unref();
  }
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

/** Singleton rotation: a dashboard restart destroys the old client, so the
 *  old timer must be CLEARED and a fresh one must bind to the new client —
 *  never two rotations at once, never setActivity on the dead client. */
let activeRotation = null;

function startPresenceRotation(client) {
  if (activeRotation) clearInterval(activeRotation);
  const templates = () => [
    { type: ActivityType.Watching, name: 'links get bypassed' },
    { type: ActivityType.Listening, name: `${client.guilds.cache.size} server${client.guilds.cache.size === 1 ? '' : 's'}` },
    { type: ActivityType.Playing, name: 'BypassX Api ⚡' },
  ];
  let i = 0;
  const apply = () => {
    // The client can be destroyed by a dashboard restart between ticks —
    // setActivity on a destroyed user throws and used to repeat forever.
    if (!client.user) return;
    try {
      client.user.setActivity(templates()[i++ % templates().length]);
    } catch {
      /* destroyed client — the next restart's onReady replaces this timer */
    }
  };
  apply();
  activeRotation = setInterval(apply, 2 * 60_000);
  activeRotation.unref();
}
