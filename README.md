<div align="center">

# BypassX Api

**Bypass gated links directly in Discord — powered by the official BypassX API.**

![Node](https://img.shields.io/badge/node-18.17%2B-339933?logo=nodedotjs&logoColor=white)
![discord.js](https://img.shields.io/badge/discord.js-14-5865F2?logo=discord&logoColor=white)
![Components](https://img.shields.io/badge/Components%20V2-native-57F287)
![Postgres](https://img.shields.io/badge/Neon%20Postgres-free%20tier-00E599?logo=neon&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-blue)

</div>

---

## ✨ Features

- ⚡ **One-command bypass** for 48+ gated-link services (Linkvertise, LootLabs, Delta, Rekonise, …)
- 🖱️ **Bypass Link** — right-click any message → Apps → the first supported link gets bypassed
- 🧩 **Components V2 native** — clean accent cards, never a wall of embeds
- 📱 **Mobile Copy · 💻 PC Copy · 🔗 Open Result** buttons on every result
  (mobile replies the **raw result only** — bare key or link, perfect for long-press copy —
  PC replies a code block with one-click copy,
  Open Result only renders on `https://` results)
- 🔁 **Try Again button** — paced key systems sometimes enforce a checkpoint rhythm;
  a rerun usually picks up where the previous attempt stopped
- 🙌 **Guided OAuth handoff** — when Delta demands a one-time sign-in, the bot renders the
  sign-in button and a modal to paste the redirect URL, then resumes the chain automatically
- 🧰 **100+ commands (106 invokable actions across 40 top-level commands)** —
  the bypass core (`/bypass`, `/bx batch` ×5 links, `/bx key`, `/bx multicheck`,
  `/bx last`, right-click **Bypass Link**, `/check`, `/recent`, `/history` with reruns),
  a dev pocket-knife (`/utility`: encode/decode/hash/uuid/password/timestamp/
  snowflake/math/color/baseconvert), party tricks (`/fun`), perm-gated server
  tools (`/server`: purge/lock/slowmode/announce/embed/pin…), lookups (`/info`),
  community surfaces (`/leaderboard`, `/poll`, `/reminder`, `/faq`, `/privacy`,
  `/changelog`, `/tip`, `/commands`) and a 23-subcommand owner suite
  (`/owner`: eval, sql, cmdstats, config, avatar, broadcast…)
- ✍️ **diff/ansi message formats** — results land in green `+` diff blocks,
  failures in red `-`, status panels in ANSI — plus JSON dumps and aligned
  pipe tables everywhere
- 🗳️ **Button polls** with live vote bars, ⏰ DM reminders, 🏆 leaderboards
- 🛡️ **Self-healing runtime** — API calls retry transient failures with backoff, an independent
  watchdog probes the BypassX API every 5 minutes, the gateway logs disconnect/resume events,
  and login retries network hiccups before giving up
- 📡 **Auto-bypass, managed by server owners** — arm channels and every supported link
  posted there gets bypassed automatically (state lives in Postgres, survives restarts);
  the bot pings the poster with **“bypassing your link…”** while it works
- 👋 **Live acknowledgement** — `/bypass` (and its retry/rerun buttons) immediately shows
  **“@you bypassing your link…”** until the result card replaces it
- 🧠 Result caching, per-user cooldowns, user & guild blacklist, bypass audit logs,
  lifetime counters — all persisted in **Neon Postgres (free tier)**
- 🔄 **Dual database transport** — raw TCP first, automatic failover to Neon's
  WebSocket transport (HTTPS/443) on networks that block Postgres ports
- 🛡️ **No-exploit posture** — env-only secrets, server-side permission gates on every
  privileged command, opaque button tokens instead of raw URLs, strict URL validation,
  memory-only degradation if the database blips
- 🛡️ Minimal & professional by design — honest errors, no noisy output

## 🧭 Commands

| Command | Description | Access |
| --- | --- | --- |
| `/bypass url [hidden]` | Bypass a supported gated link (`hidden` = only you see it) | Everyone |
| **Bypass Link** (message menu) | Right-click a message → Apps → bypass | Everyone |
| `/check url` | Is this link supported? Instant registry lookup, no bypass | Everyone |
| `/services [search]` | Browse all supported services (paginated) | Everyone |
| `/stats` | Live bot & API statistics | Everyone |
| `/status` | System health — gateway, API, database, cache diagnostics | Everyone |
| `/recent` | Your recent successful bypasses with one-tap rerun buttons | Everyone |
| `/me` | Your personal usage — totals, success rate, favourite service | Everyone |
| `/ping` | Discord + API latency | Everyone |
| `/botinfo` | Version, health, reach — everything about the bot | Everyone |
| `/serverinfo` | This server at a glance + 30-day bypass activity | Everyone |
| `/userinfo [user]` | Clean user card — account age, roles, boosts | Everyone |
| `/website` | Open the official BypassX website | Everyone |
| `/autobypass` | See which channels are armed in this server | Everyone |
| `/help` · `/invite` · `/support` · `/feedback` | Overview, invite, support, contact the owner | Everyone |
| `/enable-autobypass [channel] [channels]` | Arm auto-bypass in up to 10 channels | Server owner / admins |
| `/disable-autobypass [channel] [channels] [all]` | Disarm channels — or the whole server | Server owner / admins |

> Owner access = the Discord user IDs in `OWNER_IDS`. Auto-bypass management =
> the **server owner** and members with **Administrator** — enforced server-side,
> and the commands are hidden from non-admins by Discord itself. Private
> owner-maintenance commands exist but are intentionally not documented here.

## 🚀 Setup

1. **Node.js 18.17+**
2. Clone this repository (or your fork) and install

   ```bash
   npm install
   ```

3. Create your application in the [Discord Developer Portal](https://discord.com/developers/applications),
   name it **BypassX Api**, grab the bot token and application ID,
   and enable the **Message Content** privileged intent (required for auto-bypass —
   without it the bot still runs, auto-bypass is just disabled).
4. Create a free database at [neon.tech](https://neon.tech) and copy the connection string.
5. `cp .env.example .env` and fill in your values
6. Start it

   ```bash
   npm start
   ```

Slash commands register globally on boot (can take up to an hour on a brand-new
application — set `GUILD_ID` for instant registration in your test server).

### Environment

| Variable | Required | Description |
| --- | --- | --- |
| `DISCORD_TOKEN` | ✅ | Bot token |
| `CLIENT_ID` | ✅ | Application ID |
| `OWNER_IDS` | – | Comma-separated owner Discord IDs (default: bot author) |
| `BX_API_URL` | – | Official API base (default: production) |
| `BX_API_KEY` | ✅* | BypassX API key — *needed for bypasses* |
| `DATABASE_URL` | – | Neon Postgres connection string — state persistence (memory-only without it) |
| `SUPPORT_SERVER_URL` | – | Optional invite shown by `/support` |
| `GUILD_ID` | – | Test guild for instant command registration |
| `DASHBOARD_TOKEN` | – | Unlocks the owner web console at `/dashboard` — **dashboard stays 404-hidden when unset** |

## 🎛️ Owner dashboard

The bot serves a private web console on the same port as `/health`:

```
https://<your-service-url>/dashboard?token=<DASHBOARD_TOKEN>
```

- **Token-gated** — every route checks the token (timing-safe compare, header or query param);
  a wrong token gets `401`, and with `DASHBOARD_TOKEN` unset the whole dashboard answers `404` like it doesn't exist
- **Live overview** — every guild with name, ID, member count, channel count, armed
  auto-bypass channels, blacklist state + bot uptime, WS ping, memory, cache, API health,
  lifetime counters, recent bypass log — auto-refreshing every 15s
- **32 owner actions** in five groups:
  - *Messaging* — DM a user, send to a channel, broadcast to every armed auto-bypass channel, broadcast to one guild
  - *Guilds* — full guild details, channel list, one-tap invite link, find-user (with shared servers), force-leave
  - *Bot control* — presence, avatar, username, maintenance mode, global auto-bypass kill switch, gateway restart, shutdown
  - *Moderation* — blacklist/whitelist users & guilds, per-command cooldowns, per-command disable/enable
  - *Data & API* — clear cache, refresh service registry, API probe, log export (JSON), log pruning, counter reset, sandboxed `eval_js`
- Danger-zone actions require an extra confirm; every run is echoed to the console pane and logged

## 📡 Auto-bypass

Arm a channel with `/enable-autobypass` (server owners & admins). From then on, any
message posted there that contains a supported gated link is bypassed automatically:

- unsupported links are ignored silently
- one bypass per channel every 8 seconds (flood-safe)
- the same link is never auto-bypassed twice within 10 minutes
- failures react ❌ instead of spamming the channel
- results render with the same Mobile Copy / PC Copy / Open Result buttons
- armed channels are stored in Postgres — restarts and re-invites keep your setup

## 🐳 Docker

```bash
docker build -t bypassx-api-bot .
docker run --env-file .env bypassx-api-bot
```

## ☁️ Deploy free on Render

1. Push this repo to GitHub (or fork it).
2. On [render.com](https://render.com) create a **Web Service** → *Build and deploy from a Git repository* → paste the repo URL (public repos don't need the GitHub connection).
3. Runtime **Node**, build command `npm install`, start command `npm start`, instance type **Free**.
4. Add the environment variables from the table above.
5. Health check path: `/health` — the bot answers there and self-pings to stay awake.

## 🔍 Verify your install

```bash
npm run smoke   # offline test of every component, command and container
```

CI runs the same suite on every push. Runtime: Node 18.17+ (Node 20 recommended).

## 📄 License

[MIT](LICENSE) © 2026 LegendXD221
