import { log } from '../logger.js';

/**
 * Bot removed from a guild. Armed channels stay in the database so settings
 * survive a kick/re-invite cycle — nothing to clean up.
 */
export async function onGuildDelete(guild) {
  log.info(`Left ${guild?.name ?? 'unknown'} (${guild?.id ?? '?'})`);
}
