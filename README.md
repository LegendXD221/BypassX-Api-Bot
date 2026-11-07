<div align="center">

# BypassX Api

**Bypass gated links directly in Discord — powered by the official BypassX API.**

![Node](https://img.shields.io/badge/node-18.17%2B-339933?logo=nodedotjs&logoColor=white)
![discord.js](https://img.shields.io/badge/discord.js-14-5865F2?logo=discord&logoColor=white)
![Components](https://img.shields.io/badge/Components%20V2-native-57F287)
![License](https://img.shields.io/badge/license-MIT-blue)

</div>

---

## ✨ Features

- ⚡ **One-command bypass** for 45+ gated-link services (Linkvertise, LootLabs, Delta, Rekonise, …)
- 🧩 **Components V2 native** — clean accent cards, never a wall of embeds
- 📱 **Mobile Copy · 💻 PC Copy · 🔗 Open Result** buttons on every result
  (mobile replies plain text for long-press, PC replies a code block with one-click copy,
  Open Result only renders on `https://` results)
- 🔁 **Try Again button** — paced key systems sometimes enforce a checkpoint rhythm;
  a rerun usually picks up where the previous attempt stopped
- 🙌 **Guided OAuth handoff** — when Delta demands a one-time sign-in, the bot renders the
  sign-in button and a modal to paste the redirect URL, then resumes the chain automatically
- 📡 **Auto-bypass mode** — arm a channel and every supported link posted there gets
  bypassed automatically
- 🧠 Result caching, per-user cooldowns, blacklist, persisted lifetime counters
- 🛡️ Minimal & professional by design — honest errors, no noisy output

## 🧭 Commands

| Command | Description | Access |
| --- | --- | --- |
| `/bypass url` | Bypass a supported gated link | Everyone |
| `/services [search]` | Browse all supported services (paginated) | Everyone |
| `/stats` | Live bot & API statistics | Everyone |
| `/ping` | Discord + API latency | Everyone |
| `/help` · `/invite` | Overview & invite | Everyone |
| `/enable-autobypass [channel]` | Arm auto-bypass in a channel | Bot owner |
| `/disable-autobypass [channel]` | Disarm a channel | Bot owner |
| `/autobypass-list` | List armed channels | Bot owner |
| `/owner eval` | Run JavaScript in the bot process | Bot owner |
| `/owner servers` · `leave` | Guild list · leave a guild | Bot owner |
| `/owner presence` | Set status / activity | Bot owner |
| `/owner broadcast` · `dm` | Announce to all guilds · DM a user | Bot owner |
| `/owner blacklist` | Manage the user blacklist | Bot owner |
| `/owner api` · `cache` · `cooldown` | API diagnostics · cache · cooldown overrides | Bot owner |
| `/owner reboot` | Restart the process | Bot owner |

## 🚀 Setup

1. **Node.js 18.17+**
2. Clone and install

   ```bash
   git clone https://github.com/LegendXD221/BypassX-Api-Bot.git
   cd BypassX-Api-Bot
   npm install
   ```

3. Create your application in the [Discord Developer Portal](https://discord.com/developers/applications),
   name it **BypassX Api**, grab the bot token and application ID,
   and enable the **Message Content** privileged intent (required for auto-bypass).
4. `cp .env.example .env` and fill in your values
5. Start it

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
| `GUILD_ID` | – | Test guild for instant command registration |
| `DATA_DIR` | – | Persistence directory (default `data/`) |

## 📡 Auto-bypass

Arm a channel with `/enable-autobypass` (bot owner only). From then on, any message
posted there that contains a supported gated link is bypassed automatically:

- unsupported links are ignored silently
- one bypass per channel every 8 seconds (flood-safe)
- failures react ❌ instead of spamming the channel
- results render with the same Mobile Copy / PC Copy / Open Result buttons

## 🐳 Docker

```bash
docker build -t bypassx-api-bot .
docker run --env-file .env -v ./data:/app/data bypassx-api-bot
```

## 🔍 Verify your install

```bash
npm run smoke   # offline test of every component, command and container
```

CI runs the same suite on every push.

## 📄 License

[MIT](LICENSE) © 2026 LegendXD221
