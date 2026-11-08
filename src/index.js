import http from 'node:http';
import { Client, GatewayIntentBits, Partials, Events } from 'discord.js';
import { config } from './config.js';
import { log } from './logger.js';
import { sleep, truncate } from './util.js';
import { initDb, shutdownDb } from './db.js';
import { commands } from './commands/index.js';
import { onReady } from './events/ready.js';
import { onInteraction } from './events/interactionCreate.js';
import { onMessage } from './events/messageCreate.js';
import { onGuildCreate } from './events/guildCreate.js';
import { onGuildDelete } from './events/guildDelete.js';
import { handleDashboard } from './dashboard.js';

const FULL_INTENTS = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.MessageContent, // privileged — required for auto-bypass
];
const BASE_INTENTS = [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages];

let client = null;
let activeIntents = FULL_INTENTS;

function buildClient(intents) {
  const client = new Client({ intents, partials: [Partials.Message, Partials.Channel] });
  client.commands = commands;
  client.once(Events.ClientReady, onReady);
  client.on(Events.InteractionCreate, onInteraction);
  client.on(Events.MessageCreate, onMessage);
  client.on(Events.GuildCreate, onGuildCreate);
  client.on(Events.GuildDelete, onGuildDelete);
  // Gateway resilience — never die silently on socket trouble.
  client.on(Events.Error, (e) => log.err('Client error:', e));
  client.on(Events.Warn, (m) => log.warn(`client warn: ${m}`));
  client.on(Events.ShardDisconnect, (_e, id) => log.warn(`Shard ${id} disconnected — discord.js will reconnect.`));
  client.on(Events.ShardReconnecting, (id) => log.warn(`Shard ${id} reconnecting…`));
  client.on(Events.ShardResume, (id) => log.ok(`Shard ${id} resumed — session kept.`));
  return client;
}

function buildAndLogin(intents) {
  const client = buildClient(intents);
  return client.login(config.token).then(() => client);
}

/**
 * Login with bounded retries for transient network problems (DNS hiccups,
 * cold Redis/gateway blips). Token and intent errors are config problems —
 * they surface immediately instead of looping.
 */
async function loginResilient(intents, attempts = 3) {
  const delays = [5_000, 15_000];
  for (let attempt = 0; ; attempt++) {
    try {
      return await buildAndLogin(intents);
    } catch (e) {
      const msg = String(e?.message ?? e);
      if (/disallowed intents/i.test(msg)) throw e; // caller handles the intent fallback
      if (/invalid|unauthorized/i.test(msg) && /token/i.test(msg)) throw e; // bad token will not fix itself
      if (attempt >= delays.length) throw e;
      log.warn(`Login attempt ${attempt + 1} failed (${truncate(msg, 120)}) — retrying in ${delays[attempt] / 1000}s…`);
      await sleep(delays[attempt]);
    }
  }
}

/** Health + owner dashboard — Render probes /health to keep us alive. */
function startHealthServer(ctx) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/health' || url.pathname.startsWith('/health')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          ok: true,
          uptime: Math.floor(process.uptime()),
          guilds: ctx.getClient()?.guilds?.cache?.size ?? null,
          ts: Date.now(),
        })
      );
      return;
    }
    if (url.pathname === '/dashboard' || url.pathname.startsWith('/dashboard/')) {
      handleDashboard(req, res, url, ctx);
      return;
    }
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('⚡ BypassX Api is running');
  });
  server.listen(Number(process.env.PORT ?? 3000), () =>
    log.ok(`Health server listening on :${process.env.PORT ?? 3000}`)
  );
}

/** Dashboard action: bounce the gateway without killing the HTTP server. */
function restartClient() {
  return (async () => {
    log.warn('dashboard requested gateway restart — destroying client…');
    try {
      await client?.destroy();
    } catch {
      /* already dead */
    }
    client = await loginResilient(activeIntents);
    client.autobypassDisabled = activeIntents === BASE_INTENTS;
    log.ok('client re-logged in after dashboard restart');
  })().catch((e) => log.err('dashboard restart failed:', e));
}

/** Shared by SIGINT/SIGTERM and the dashboard shutdown action. */
function gracefulShutdown() {
  log.info('shutdown requested — closing.');
  client?.destroy().catch(() => {});
  shutdownDb().finally(() => process.exit(0));
}

async function main() {
  if (!config.token || !config.clientId) {
    log.err('Missing configuration. Set DISCORD_TOKEN and CLIENT_ID in your environment (see .env.example).');
    process.exit(1);
  }

  await initDb();

  let booted;
  try {
    client = await loginResilient(FULL_INTENTS);
    booted = FULL_INTENTS;
  } catch (e) {
    const msg = String(e?.message ?? e);
    if (/disallowed intents/i.test(msg)) {
      log.err('MESSAGE CONTENT intent is not enabled — auto-bypass will be OFF.');
      log.err('Enable it at https://discord.com/developers/applications → your app → Bot → Privileged Gateway Intents.');
      log.err('Everything else (bypass, copy buttons, stats) keeps working.');
      client = await loginResilient(BASE_INTENTS);
      booted = BASE_INTENTS;
    } else {
      throw e;
    }
  }
  activeIntents = booted;
  client.autobypassDisabled = booted === BASE_INTENTS;

  startHealthServer({
    getClient: () => client,
    restart: restartClient,
    shutdown: gracefulShutdown,
  });

  // Render free web services spin down after inactivity — ping ourselves so
  // the bot stays online 24/7.
  const externalUrl = process.env.RENDER_EXTERNAL_URL;
  if (externalUrl) {
    const url = `${externalUrl.replace(/\/+$/, '')}/health`;
    setInterval(() => fetch(url).catch(() => {}), 5 * 60_000).unref();
    log.info(`Keep-alive self-ping enabled → ${url}`);
  }

  process.on('unhandledRejection', (e) => log.err('Unhandled rejection:', e));
  process.on('uncaughtException', (e) => log.err('Uncaught exception:', e));

  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, gracefulShutdown);
  }
}

log.info(`BypassX Api v${config.version} starting…`);
main().catch((e) => {
  log.err('Fatal startup error:', e);
  process.exit(1);
});
