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
import leaderboard from './public/leaderboard.js';
import history from './public/history.js';
import serviceinfo from './public/serviceinfo.js';
import randomservice from './public/randomservice.js';
import docs from './public/docs.js';
import changelog from './public/changelog.js';
import privacy from './public/privacy.js';
import reminder from './public/reminder.js';
import poll from './public/poll.js';
import faq from './public/faq.js';
import shortcuts from './public/shortcuts.js';
import uptime from './public/uptime.js';
import tip from './public/tip.js';
import commandsCatalog from './public/commands.js';
import bx from './suites/bx.js';
import utility from './suites/utility.js';
import fun from './suites/fun.js';
import server from './suites/server.js';
import info from './suites/info.js';
import tools from './suites/tools.js';
import text from './suites/text.js';
import enableAutobypass from './owner/enable-autobypass.js';
import disableAutobypass from './owner/disable-autobypass.js';
import owner from './owner/owner.js';

const commands = new Collection();
for (const cmd of [
  bypass,
  bypassLink,
  bx,
  check,
  services,
  serviceinfo,
  randomservice,
  recent,
  history,
  leaderboard,
  stats,
  status,
  uptime,
  ping,
  me,
  userinfo,
  botinfo,
  serverinfo,
  info,
  utility,
  tools,
  text,
  fun,
  server,
  reminder,
  poll,
  commandsCatalog,
  shortcuts,
  tip,
  faq,
  docs,
  changelog,
  privacy,
  help,
  invite,
  support,
  website,
  feedback,
  autobypass,
  enableAutobypass,
  disableAutobypass,
  owner,
]) {
  commands.set(cmd.data.name, cmd);
}

export { commands as default, commands };
export const commandData = [...commands.values()].map((c) => c.data.toJSON());
