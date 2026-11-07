# Worklog — BypassX Api (Discord bot)

Honest running log of decisions, changes and incidents. Newest first.

---

## 2026-11-08 — v1.2.0 "Max out + harden" (this session)

**Goal:** max the bot out, fix every error/bug found, remove GitHub links from the bot
surface entirely, and ship v1.2.0.

### Bugs found & fixed

1. **`setContexts(1)` was wrong on every guild-only command** — `1` is
   `InteractionContextType.BotDM`, not Guild. `/enable-autobypass`,
   `/disable-autobypass`, `/autobypass` (and the first draft of `/serverinfo`)
   were only ever usable in bot DMs — the exact opposite of the intent.
   All four now use `InteractionContextType.Guild` and the smoke test asserts
   `contexts === [0]` so this can never regress.
2. **CI workflow was broken YAML** — `branches: ain]` (stray bracket from an
   earlier edit) meant CI never ran on main pushes. Fixed to `[main]` and added
   a **"no links to the source host in the bot surface"** CI step (`grep -riE
   "github[.]com" src README.md` must find nothing).
3. **GitHub links scrubbed from the entire bot surface** — `/help` had a
   "Source" button, `/support` had a "Report an issue" button + on-screen text,
   and `config.repoUrl` fed them all. All removed; buttons now point to the
   official website and the invite link only. The smoke test now asserts every
   command payload and every card serializes with **zero** links to the source
   host. Result links produced by the API (the bypassed destination
   itself) are untouched, obviously.
4. **SSRF hardening** — `normalizeBypassUrl` now rejects loopback, private
   ranges (10/8, 172.16/12, 192.168/16, 100.64/10, CGNAT, benchmark ranges),
   link-local incl. `169.254.169.254` (cloud metadata), IPv6 loopback/ULA/
   link-local, IPv4-mapped IPv6, `*.local / *.internal / *.lan / *.home /
   *.localhost / *.internal`, bare dot-less hostnames, and URLs with embedded
   credentials. 20 blocked-host + 6 blocked-URL smoke cases added.
5. **Database transport resilience** — the boot probe initially failed with
   `ECONNREFUSED` on hosts where raw Postgres TCP (5432) is blocked. db.js now
   detects transport-level failures (never real SQL errors — those carry a
   `severity` field) and transparently re-opens the same schema over Neon's
   WebSocket transport (HTTPS/443, official `@neondatabase/serverless` driver).
   On this machine TCP was actually fine once a stale shell env var was killed;
   the fallback stays as a permanent safety net.
6. **Stale env var pitfall** — dotenv now runs with `override: true` so a
   leftover `DATABASE_URL` exported in a shell can never silently win over the
   repo's `.env`.
7. **`/owner feedback` subcommand had no handler** — it was registered in the
   command tree but the switch never handled it (users would see "The
   application did not respond"). Wired to `store.recentFeedback()`.
8. **`/bypass url` maxLength raised** 512 → 1024 (some gated links are long;
   validation still caps at 2048 and rejects junk).

### Features added (max-out pass)

- `/check url` — instant "is this link supported?" registry lookup without
  burning a bypass (shows match, success rate, known domains).
- `/me` — personal stats: lifetime bypasses, success rate, 24h/7d activity,
  favourite service (privacy-friendly, ephemeral).
- `/serverinfo` — server card: owner, size, boosts, auto-bypass state and 30-day
  bypass activity for this guild.
- `/botinfo` — full bot card: version, reach, gateway/API/DB health, memory,
  invite + website buttons.
- `/userinfo [user]` — clean user card with roles/boosts, works in DMs.
- `/website` — official site link card.
- `/bypass hidden:` — ephemeral results for people who don't want to spam the
  channel.
- `/owner refresh` — re-register slash commands on demand.
- `/owner sweep` — trigger the sub-150-member sweep immediately.
- `/owner cooldown` now has **autocomplete** for the command picker.
- Copy-button tokens now live 45 min (was 30).
- Registry + cache live where `/stats` & `/botinfo` read from; public stats now
  include unique users.

### Verified live (this machine)

- `npm run smoke` — 11/11 groups green (19 commands, 17 owner subcommands,
  V2 cards, SSRF guards, zero-GitLink hygiene).
- Real gateway login as **BypassX Api#0825** — 19 global slash commands
  registered; Message Content intent accepted (auto-bypass fully armed).
- Neon Postgres: schema bootstrapped (5 tables), counters live, pool max 4.
- Real end-to-end bypass through the official API (paste service → destination
  in ~0.4s, `x-api-key` header).

### Deploy

- v1.2.0 pushed to the public repo (`fb29bf9..fb95374`).
- Render deploy: **in progress** — Render's *public-repo URL* onboarding is
  failing platform-side right now (`passed in repository URL is invalid or
  unfetchable`). Verified non-repo-specific via a control creation with a
  top-100 GitHub repo (same 400). The repo itself is 100% anonymously fetchable
  (HTML 200, codeload tarball 200, `git ls-remote` OK). An idempotent deploy
  script (`scripts/render_deploy_bot.py` outside the public repo) retries
  creation, waits for the first deploy to go live and verifies `/health` —
  scheduled to keep retrying until Render recovers. Plan: free web service,
  Node 20, `npm install` → `npm start`, health check `/health`, auto-deploy on
  push, self-ping keep-alive against the free-tier idle spin-down.

---

## 2026-11-07 — v1.1.0 (recovered session)

- Neon Postgres persistence with memory-only fallback (`autobypass_channels`,
  `blacklist`, `counters`, `bot_config`, `bypass_logs`), pool of 4, fire-and-
  forget writes, 60s reconnect loop.
- Server-managed auto-bypass: `/enable-autobypass` / `/disable-autobypass` for
  the **server owner** (and admins), channel mention/ID parsing, per-channel
  8s flood cooldown, 10-min URL dedupe, ❌ reaction on failure instead of spam.
- Auto-leave for servers < 150 members (DM to the owner first) + 10-min sweep.
- Context-menu **Bypass Link** + Try Again button + guided OAuth handoff for
  paced key systems (sign-in link → modal → chain resumes).
- Opaque server-side tokens back every button custom ID (URLs never ride in
  custom IDs — they are visible to all clients).
- Owner suite v1: eval, stats, servers, leave, presence, broadcast, dm,
  blacklist, logs, maintenance, api, cache, cooldown, reboot.
- Global presence rotation, token cleanup, health endpoint + self-ping,
  graceful SIGTERM shutdown, CI smoke workflow.

## 2026-11-07 — v1.0.0 (initial release)

- `/bypass`, `/services` (paginated), `/stats`, `/ping`, `/help`, `/invite`,
  `/support`, `/autobypass`.
- Components V2 everywhere: accent containers, separators, sections with
  thumbnails, `-#` subtext footers.
- **Mobile Copy / PC Copy / Open Result** signature buttons — mobile gets plain
  text (long-press), PC gets a code block (one-click copy), Open Result only
  renders on `https://` results.
- Result cache (10 min TTL, 250 max) served locally before hitting the API.
- Secret hygiene: `.env` gitignored, `.env.example` placeholder-only, no
  provider details anywhere in the public surface.
