import dotenv from 'dotenv';
// override: the repo's .env is authoritative for local runs — stale values
// exported into a shell must not win (Render injects its own env separately).
dotenv.config({ override: true });

/**
 * Central configuration — everything comes from the environment so no
 * secret ever needs to live in the repo. See .env.example.
 */
export const config = {
  version: '2.2.0',

  // Discord
  token: process.env.DISCORD_TOKEN ?? '',
  clientId: process.env.CLIENT_ID ?? '',
  ownerIds: (process.env.OWNER_IDS ?? '1134757298733064203')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  guildId: process.env.GUILD_ID ?? '',

  // BypassX API
  apiUrl: (process.env.BX_API_URL ?? 'https://bypassx-omega.vercel.app').replace(/\/+$/, ''),
  apiKey: process.env.BX_API_KEY ?? '',

  // Persistence (Neon Postgres, free tier)
  databaseUrl: process.env.DATABASE_URL ?? '',

  // Runtime
  supportServerUrl: process.env.SUPPORT_SERVER_URL ?? '',

  // Owner dashboard (https://…/dashboard?token=…) — disabled entirely when unset
  dashboardToken: process.env.DASHBOARD_TOKEN ?? '',

  colors: {
    primary: 0x5865f2,
    success: 0x57f287,
    warning: 0xfee75c,
    error: 0xed4245,
    neutral: 0x2b2d31,
  },
};

export function isOwner(userId) {
  return config.ownerIds.includes(userId);
}

/** View Channel · Send Messages · Read Message History · Add Reactions · Attach Files */
export const INVITE_PERMISSIONS = 101440;

export function inviteUrl(clientId = config.clientId) {
  return `https://discord.com/oauth2/authorize?client_id=${encodeURIComponent(clientId)}&scope=bot+applications.commands&permissions=${INVITE_PERMISSIONS}`;
}
