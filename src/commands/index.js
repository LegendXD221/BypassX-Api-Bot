import { Collection } from 'discord.js';
import bypass from './public/bypass.js';
import services from './public/services.js';
import stats from './public/stats.js';
import ping from './public/ping.js';
import help from './public/help.js';
import invite from './public/invite.js';
import enableAutobypass from './owner/enable-autobypass.js';
import disableAutobypass from './owner/disable-autobypass.js';
import autobypassList from './owner/autobypass-list.js';
import owner from './owner/owner.js';

const commands = new Collection();
for (const cmd of [
  bypass,
  services,
  stats,
  ping,
  help,
  invite,
  enableAutobypass,
  disableAutobypass,
  autobypassList,
  owner,
]) {
  commands.set(cmd.data.name, cmd);
}

export { commands as default, commands };
export const commandData = [...commands.values()].map((c) => c.data.toJSON());
