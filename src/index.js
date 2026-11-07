import { Client, GatewayIntentBits, Partials, Events } from 'discord.js';
import { config } from './config.js';
import { log } from './logger.js';
import { loadState } from './storage.js';
import { commands } from './commands/index.js';
import { onReady } from './events/ready.js';
import { onInteraction } from './events/interactionCreate.js';
import { onMessage } from './events/messageCreate.js';

loadState();

if (!config.token || !config.clientId) {
  log.err('Missing configuration. Set DISCORD_TOKEN and CLIENT_ID in your .env file (see .env.example).');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // privileged — required for auto-bypass
  ],
  partials: [Partials.Message, Partials.Channel],
});

client.commands = commands;

client.once(Events.ClientReady, onReady);
client.on(Events.InteractionCreate, onInteraction);
client.on(Events.MessageCreate, onMessage);

process.on('unhandledRejection', (e) => log.err('Unhandled rejection:', e));
process.on('uncaughtException', (e) => log.err('Uncaught exception:', e));

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    log.info(`${sig} received — shutting down.`);
    client.destroy();
    process.exit(0);
  });
}

log.info(`BypassX Api v${config.version} starting…`);
client.login(config.token).catch((e) => {
  const msg = String(e?.message ?? e);
  if (/disallowed intents/i.test(msg)) {
    log.err(
      'Login failed: the MESSAGE CONTENT intent is not enabled. Open the Discord Developer Portal → your app → Bot → Privileged Gateway Intents → enable "Message Content Intent", then start again.'
    );
  } else {
    log.err('Login failed:', msg);
  }
  process.exit(1);
});
