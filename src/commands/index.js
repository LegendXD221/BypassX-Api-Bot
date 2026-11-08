import { Collection } from 'discord.js';
import bypass from './public/bypass.js';
import bypassLink from './public/bypass-link.js';
import services from './public/services.js';
import stats from './public/stats.js';
import ping from './public/ping.js';
import help from './public/help.js';
import invite from './public/invite.js';
import support from './public/support.js';
import autobypass from './public/autobypass.js';
import check from './public/check.js';
import feedback from './public/feedback.js';
import userinfo from './public/userinfo.js';
import botinfo from './public/botinfo.js';
import serverinfo from './public/serverinfo.js';
import me from './public/me.js';
import website from './public/website.js';
import status from './public/status.js';
import recent from './public/recent.js';
import enableAutobypass from './owner/enable-autobypass.js';
import disableAutobypass from './owner/disable-autobypass.js';
import owner from './owner/owner.js';

const commands = new Collection();
for (const cmd of [
  bypass,
  bypassLink,
  services,
  stats,
  ping,
  help,
  invite,
  support,
  autobypass,
  check,
  feedback,
  userinfo,
  botinfo,
  serverinfo,
  me,
  website,
  status,
  recent,
  enableAutobypass,
  disableAutobypass,
  owner,
]) {
  commands.set(cmd.data.name, cmd);
}

export { commands as default, commands };
export const commandData = [...commands.values()].map((c) => c.data.toJSON());
