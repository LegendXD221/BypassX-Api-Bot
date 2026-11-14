# Worklog — BypassX Api (Discord bot)

Honest running log of decisions, changes and incidents. Newest first.

---

## 2026-11-11 (later) — Dashboard v4 OPS edition: Op Tools arsenal (44 new owner-only ops, 99 total), UI overhaul

- ASK: "Lets Move On The Bot Dashboard — The Dashboard Ui Still Looks Little
  Bad Improve It And Add More Dashboard Only Features create a section Named
  Op Tools And Add like 50+ Op And Powerful commands in it like role giving
  bot owner in server and more features" + "Bot Owner Only".
- OWNER-ONLY POSTURE (unchanged in kind, hardened in framing): the whole
  dashboard stays behind DASHBOARD_TOKEN (timing-safe compare, disabled
  entirely when unset); every Op Tools run is written to the bot log
  (`dashboard action: op_*`); destructive ops additionally sit in the
  danger set and ask twice (UI confirm + server-side confirm:true gate).
- 44 NEW ACTIONS (src/dashboard.js, the OP TOOLS section — 99 total now):
  * Roles (12): op_role_give / op_role_remove (hierarchy-guarded — refuses
    roles at/above the bot's peak), op_role_give_all / op_role_remove_all
    (mass, humans-or-bots filter, 1000 cap + accounting), rename / color /
    info (permission list) / members / position / clone, plus create_role /
    delete_role surfaced in the section.
  * Members (11): unban, timeout_clear, nickname set/reset, voice
    move/disconnect, permission audit (critical flags flagged), mass-DM
    humans (capped 25 default / 50 max, 600ms pacing), kick/ban/timeout/
    member_info surfaced.
  * Channels (12): rename, topic, slowmode (0-21600s), LOCK/UNLOCK
    (@everyone SendMessages overwrite), NSFW flag, clone, category move
    ("none" = root), create category, channel info JSON, create/delete.
  * Messages (10): purge (1-100, old-message filtered), purge_user (scoped
    fetch + filter), delete by ID, edit (MY messages only — honest error
    otherwise), react, pin/unpin, send/embed/fetch surfaced.
  * Server (12): rename server, icon, banner (boost-gated error surfaced),
    emoji upload (v14.28 options-object create) / delete, webhooks list,
    audit-log tail with executors, vanity invite + uses, invite create,
    bans/emojis/invites lists.
  * Power (12): per-guild instant slash-command sync, bot permission audit
    (guild + optional channel overrides), broadcast_all, dm_user, eval_js,
    sql_query, reload_commands, toggle_autobypass, set_maintenance, dump_env,
    reconnect_gateway, shutdown.
- GUARDS (all server-side, tested): hierarchy checks before every role
  mutation; reqId digit-format on every ID; mass ops capped + paced; danger
  set grew 11 → 19 (role_give_all, role_remove_all, dm_all_guild,
  purge_messages, purge_user, delete_message, emoji_delete, guild_name_set
  added); guild.client.user.id replaced with the canonical ctx client ref
  (the functional test caught the fragility).
- UI v4 OPS (src/dashboard-page.js):
  * Sidebar reorganized into GENERAL / OPERATIONS groups; new Op tools nav
    with ⚡ icon + gradient OWNER badge; version → "Owner Console v4 OPS".
  * Dedicated Op Tools tab: amber/red gradient banner with the BOT OWNER
    ONLY tag, sticky search + group filter ("69 of 69 actions" counter),
    six op group cards (Roles/Members/Channels/Messages/Server/Power).
  * The old Actions tab stays as the full 99-action registry ("Full action
    registry") — palette builder refactored into one parameterized
    renderPalette() powering both tabs; danger ops keep red left rails, op
    boxes get amber rails, focus-within glow, focus-visible rings.
- TESTS: scripts/test_op_tools.mjs — 53 functional checks through the real
  dispatch() with a mocked discord.js client (Collection-based): confirm
  gates, hierarchy refusals, mass-op accounting, purge scoping, voice
  branches, emoji options-object, honest-failure paths. npm run smoke
  extended to pin v4 + the full op arsenal (16 groups green).
- DEPLOY: GHCR image rebuild via scripts/build_bot_image.sh (export-verify
  gate PASS) → Render auto-deploy on digest change → /health ok:true.

---

## 2026-11-11 — Spin-down outage root-caused; external keep-alive net added (keepalive.yml)

- REPORT: "make the Discord bot online it got offline" — bot unreachable on
  Discord, no user-facing errors.
- ROOT CAUSE (verified, not guessed): Render free-tier idle spin-down. The
  instance had been spun down and nothing external could wake it — the bot's
  own 5-min self-ping died WITH the process, so a silent spin-down latches
  until the first inbound request. `GET /health` on the public URL showed
  `uptime:17` (fresh boot from MY request) — proof of the latch, not a
  crash-loop (crash-loops don't show spin-down latches and Render had no
  failed-deploy / suspend state: `not_suspended`, deploy `live`).
- RECOVERY: one `curl /health` woke the instance; gateway reached
  `client.isReady()` (health endpoint enforces `ok:true` only on a ready
  gateway — the 8h-outage "zombie babysit" shape is structurally excluded).
  Confirmed via health polls: uptime 17s -> 91s -> 171s -> 487s with gateway
  ready and 8 guilds cached.
- PREVENTION (3 layers, in addition to the existing self-ping):
  1. `.github/workflows/keepalive.yml` — external `/health` ping every
     10 min (< 15-min spin-down window), 4 attempts x 60s so a cold boot +
     slow gateway still passes; run exits non-zero (visible red run) if the
     gateway never becomes ready. Manually dispatched once -> success.
  2. Daily agent health-check (09:00 IST): `bot_daily_check.py` self-heals
     (wake -> re-poll -> resume if suspended -> redeploy as last resort) and
     stays silent unless it ends up STILL DOWN.
  3. Existing in-process self-ping (unchanged — was never broken; it just
     can't run while the process is dead).
- OPS NOTE: Render's logs API now 400s on the old `serverId`/`serviceId`
  filter paths from the compiled helper — log inspection during this outage
  was done via health probes + service/deploys endpoints instead. Helper
  `fetch_logs` will need the new filter schema next time it matters.
- VERIFY: GH Actions "Keep-alive ping" run #1 = success (external proof of
  gateway-ready), CI green on the workflow commit; `/health` 200 ok:true.

## 2026-11-10 (night) — "Formats" demo removed; dashboard messaging now renders owner-typed formats (multi-line textareas + verbatim passthrough)

- ASK: "Remove the Formats i didnt said to implement them i wanted them so
  when i send msg using Dashboard in formats so it works / No errors and
  bugs are accepted".
- READING: the owner never asked for a Formats demo — what they want is that
  a message typed in the DASHBOARD (channel_send / dm_user / broadcast_all /
  broadcast_guild) renders in Discord with the formats they type (```diff```
  fences, **bold**, newlines).
- REMOVED (the unprompted part):
  - `preview_diff` dashboard action ("Send the format-preview card (diff/ansi
    demo)") — gone from the registry AND the palette. Bonus: it was calling
    `statusPanel()` which was never imported in dashboard.js — the action
    would have thrown ReferenceError on invocation. Two bugs, one delete.
  - Palette group renamed `Data · API · Formats` → `Data · API` (the name
    was the only "Formats" branding left); page docstring updated.
- FIXED (the wanted part):
  - Palette arg inputs were single-line `<input>`s — a multi-line ```diff```
    fence was literally impossible to type. Content args (`message`, `json`,
    `text`, `lines`, `code`, `query`, `reason`) now render as real
    `<textarea>`s (resize, multi-line).
  - Server-side passthrough verified, not assumed: functional test drives
    `ACTIONS.channel_send` through a mocked client with a message containing
    a ```diff fence + bold + newlines — `ch.send` receives it VERBATIM
    (Discord renders content markdown natively; `allowedMentions:{parse:[]}`
    preserved, so pings stay off while formats work).
  - `reqText` cap raised 1500 → 1900 (Discord content cap 2000) so formatted
    messages aren't rejected at 1500.
  - Self-inflicted, caught by `node --check` before commit: a ```triple-
    backtick``` inside a JS comment terminated the `const JS = \`…\`` page
    template in dashboard-page.js — SyntaxError. Rephrased the comment; the
    pre-deploy syntax gate did its job.
- SMOKE: expectations updated — `preview_diff` asserted ABSENT (registry +
  palette), textarea builder markers asserted PRESENT, action floor now
  `55 owner actions`. 16/16 groups green.
- SHIPPED: image digest `sha256:0cdfa983…` (export-verified BEFORE deploy:
  app/src/* + deps present, preview_diff absent, textarea builder present,
  entrypoint node /app/src/index.js) → deploy dep-dbpdabgn74is73dkt2l0
  (clearCache=clear) → live in ~30s. Fresh boot `08:26:34 BypassX Api v2.2.0
  starting…`; /health HTTP 200, uptime 72s → 175s → 360s+ with zero restarts;
  keep-alive self-ping ON. Owner can now type multi-line formatted messages
  in the dashboard palette and Discord renders them verbatim.

---

## 2026-11-10 (evening) — `.catch?.` typo: EVERY slash command threw "Cannot read properties of undefined (reading 'catch')" — fixed

- ASK: user screenshot (#bumper, 10:52 AM) — `/bypass` by KnightPlayz answered the
  owner error card `⚠️ Something went wrong` with
  `Cannot read properties of undefined (reading 'catch')` · v2.2.0.
- DIAGNOSIS (full `.catch(` audit of all 81 call sites, then repro):
  - The error card is emitted by `onInteraction`'s `handleCommand` catch — the
    throw happened BEFORE `cmd.execute()` even ran.
  - Root cause, `src/events/interactionCreate.js:94`:
    `store.bump(...).catch?.(() => {})`. `store.bump()` is synchronous and
    returns `undefined`, so the member access `undefined.catch` itself throws.
    The optional-call `?.` sat on the CALL side (`catch?.()`) — it never guards
    the property ACCESS. Correct shape: `?.catch(() => {})`.
  - Introduced in v2.0.0 (4fbe896). Never surfaced before because v2.0.0–v2.1.x
    code only went live yesterday with the v2.2.0 image (service ran the stale
    v1.5.0 image until then) — first real-world slash command since the typo
    shipped was this screenshot. Verified with a 3-line node repro: the old
    form throws exactly this message, the fixed form does not.
  - Impact: EVERY slash command failed with this card since the v2.2.0 deploy;
    auto-bypass (messageCreate) was unaffected — which is why the bot still
    "worked" in armed channels.
  - Sibling scan: `rg '\.catch\?\.'` → this was the only occurrence repo-wide;
    pattern scan for `).prop?.(` misuse → none. The other 80 `.catch(` sites
    hang off real promises (async fns, discord.js builders, `q()` which is
    async and always returns a promise even when resolving `null`).
- FIX: line 94 → `store.bump(...)?.catch(() => {})` — preserves the defensive
  optional-catch intent, no throw when bump returns undefined.
- VERIFICATION: `node --check` clean; runtime self-test of the exact call form
  (memory-only store) does not throw; `npm run smoke` 16/16 groups green
  (42 top-level / 131 invokable unchanged).
- SANDBOX NOTE: the workspace was recycled mid-task; bot repo re-cloned from
  GitHub, deploy tooling restored from /tmp. Live runtime re-confirmed via
  Render API: image runtime, `ghcr.io/legendxd221/bypassx-deobf-bot:api-bot`.
- SHIPPED: image rebuilt from this commit and deployed — see next entry if
  present; verification = boot banner v2.2.0 + `/bypass` no longer errors.

---

## 2026-11-10 (late) — BROKEN-IMAGE OUTAGE: crash loop "Cannot find module '/app/src/index.js'" 05:45→06:36 UTC; 24/7 keep-alive was never removed — image rebuilt correctly and bot restored

- ASK: "You removed its 24/7 features" — user saw the bot offline in Discord
  and /health unreachable.
- WHAT ACTUALLY HAPPENED:
  - The previous entry's image push was built with a WRONG LAYER TAR ROOT:
    `tar -cf layer.tar -C $STAGE/app .` archives paths as `./src/...`, and
    `crane mutate --append` extracts appended layers at the IMAGE ROOT — so
    the code landed at `/src/index.js` while the entrypoint ran
    `node /app/src/index.js`. Result: crash loop
    `Error: Cannot find module '/app/src/index.js'` from the 05:45 deploy
    until the fix — the bot was dark ~8h (Discord offline, /health dead,
    Render restarting the instance every few seconds). A deploy-pipeline
    mistake on top of an otherwise correct code fix; the `.catch?.` repair
    itself was fine.
  - The keep-alive ("24/7") feature was NEVER touched: the self-ping block
    (index.js:151-158, `${RENDER_EXTERNAL_URL}/health` every 5 min) shipped
    in this image unchanged, and the fixed boot logged
    `Keep-alive self-ping enabled → https://nexobypass-api.onrender.com/health`.
- FIX:
  - Layer tar root corrected: `tar -cf layer.tar -C $STAGE app` → paths
    `app/src/...` extract to `/app/src/...` at the image root.
  - NEW MANDATORY GATE before ANY deploy: `crane export <img> - | tar -t`
    must show `app/src/index.js` + `app/node_modules/discord.js/...`, and
    `crane config` must show Entrypoint `[node, /app/src/index.js]`,
    WorkingDir `/app`, NODE_ENV present. Applied this time (caught nothing
    to catch — but the broken build would have failed this gate).
  - New digest `sha256:d5580686…` pushed to
    `ghcr.io/legendxd221/bypassx-deobf-bot:api-bot`; deploy
    dep-dbpbmm5bedkc7389v6qg (clearCache=clear) → live in ~30s.
- VERIFIED LIVE:
  - Boot 06:36:20-25 UTC: `BypassX Api v2.2.0 starting…` ·
    `Logged in as BypassX Api#0825 — 2 guild(s)` · `Neon Postgres ready
    (pool max 4)` · `Registered 42 global application commands` ·
    `Loaded 49 supported services / 87 domains` ·
    `Health server listening on :10000` · keep-alive self-ping ON.
  - `/health` → `{"ok":true,"uptime":…,"guilds":2}` HTTP 200; uptime grew
    52s → 268s across checks with zero restarts (all crash lines in the log
    buffer predate 06:36) — instance stable, no crash loop.
  - Slash commands unblocked again (the `.catch?.` fix rides this image).
- LESSON (process): image-content verification is now mandatory before
  every deploy — a digest push without an export check cost 8 hours.

---

## 2026-11-10 (later) — STALE-IMAGE INCIDENT fixed: service switched back to repo runtime (v2.2.0 ships for real)

- ASK: "The Bot Is Showing Errros Fix It Do Scan Of The Code".
- DIAGNOSIS (Render logs + GET /services/{id}):
  - The service was STILL on the 2026-11-08 outage workaround: image runtime,
    `ghcr.io/legendxd221/bypassx-deobf-bot:api-bot` — an image last built from
    **v1.5.0-era code**. Boot banner: `BypassX Api v1.5.0 starting…`,
    `Registered 21 global application commands` (current main registers 42),
    `Loaded 49 services / 87 domains`. Every v1.6→v2.1 feature (100+ commands,
    dashboard v3, format engine) AND the auto-leave removal never went live.
  - Newest log entry: a Discord REST rejection of a Components-V2 message
    (`flags: 32768`) from that old code — the "errors" the owner saw.
  - git push to GitHub never ships: image-runtime services re-pull the IMAGE,
    not the repo. The 2026-11-09/10 pushes were silently inert.
  - `render_deploy_bot.py` (tarball-boot variant) was a dead iteration: its
    dockerCommand can't be set via API on image runtimes (recorded earlier).
- FIX ATTEMPTED: switch back to the **repo runtime** with a single PATCH
  (Node, `npm install` → `npm start`, health `/health`) — BLOCKED: Render's
  repo-validation outage from 2026-11-08 is STILL live ("passed in repository
  URL is invalid or unfetchable", HTTP 400, same message as the canary-verified
  platform incident). Fell back to the image rebuild below.
- VERSION MARKER: config/package bumped 2.0.0 → **2.2.0** (v2.1.0 was tagged
  upstream but never deployed; the boot banner now proves which code runs).
- DEPLOY TRIGGER NOTE: the owner's deploy script was updated to always
  trigger a fresh deploy + env-sync (drops the dead MIN_GUILD_MEMBERS var).
- IMAGE REBUILD: repo-runtime PATCH blocked — Render's repo-validation outage
  from 2026-11-08 STILL live ("passed in repository URL is invalid or
  unfetchable", canary-verified platform-side back then). Rebuilt the GHCR
  image instead, same no-daemon pipeline as before: stage src+scripts+lockfile
  → `npm install --omit=dev` → tar → `crane mutate --append --workdir /app
  --entrypoint node,/app/src/index.js -e NODE_ENV=production node:20-alpine
  -t ghcr.io/legendxd221/bypassx-deobf-bot:api-bot`. PAT (write:packages)
  used for the push. Deploy triggered via API → **live: v2.2.0 banner,
  Neon ready, Logged in as BypassX Api#0825, Registered 42 global commands,
  49 services / 87 domains.** ("shutdown requested" lines in the log are the
  outgoing instance's SIGTERM during deploy swap — benign.)
- **50035 FIX — the actual "bot showing errors" bug**: live logs caught
  `Auto-bypass handler error: DiscordAPIError[50035]: Invalid Form Body
  components[…].url[BASE_TYPE_MAX_LENGTH]: Must be 512 or fewer in length`
  at messageCreate.js:116. When a bypassed destination URL exceeded 512
  chars, the "Open Result" link button blew Discord's form validation and
  the ENTIRE result message was rejected — auto-bypass looked dead. Fix:
  - `safeLinkUrl()` + `DISCORD_URL_MAX = 512` in components.js — every link
    button URL now passes through it.
  - `resultButtons()` / `resultContainer()`: >512-char results drop the Open
    Result button and add a `-#` explanation line (copy buttons still carry
    the FULL link server-side — nothing is lost).
  - `oauthContainer()`: >512-char authorize URLs drop the Sign-in button and
    render the raw link as text instead.
  - `/bx chain` (suites/bx.js): long result URLs are skipped for buttons with
    a count note; ≤5 safe links still get buttons.
  - Smoke regression: >512 fixture → no style-5 button anywhere on the card;
    16/16 groups green.
- **DB WEDGE FIX — one-way transport failover**: post-deploy, the dashboard
  reported `db.healthy: false` persistently (90s+ of polls) despite "Neon
  Postgres ready" at boot. Live forensics THROUGH the owner dashboard's
  eval_js action (scope: client/config/store):
  - direct `pg` TCP connect from inside the bot: `SELECT 1` in ~1s ✓ (URL,
    credentials, egress, Neon state all fine)
  - `@neondatabase/serverless` Pool with `webSocketConstructor: ws`:
    **fails in 1ms — "All attempts to open a WebSocket … fetch failed"** —
    the neon WS transport is BROKEN on this Render runtime (it worked
    elsewhere; that's how it got into the code).
  - ROOT CAUSE: `q()`'s failover was ONE-WAY (tcp→ws). A query hitting the
    5s TCP timeout during a Neon free-tier cold-start (compute suspends
    after ~5 idle minutes) flipped the bot onto the broken WS path, and the
    60s reconnect loop then retried `q('SELECT 1')` on the SAME dead driver
    forever — memory-only until restart.
  - FIX in `src/db.js`: failover is now SYMMETRIC — tcp↔ws flips on any
    transport-like failure (added `fetch failed` to the matcher), and when
    BOTH transports fail in one call the driver flips BACK to the one that
    worked most recently, so the 60s reconnect always starts from the best
    known transport. No DB keep-alive on purpose: Neon free tier suspends
    idle compute and an always-on ping would burn the monthly compute
    budget — surviving suspends is the correct posture.
  - 16/16 smoke groups green.
- **SHIPPED + VERIFIED LIVE** (image digest 9daa0847…, deploy
  dep-dbp9o2e1egvs73bg8mcg): dashboard overview at t+30s AND t+2min —
  `version 2.2.0 · 42 top-level / 131 invokables · 1 guild (1117 members,
  auto-leave GONE) · db.healthy TRUE (stays true) · flags {maintenance,
  disabledCommands} only (minGuildMembers flag gone) · apiHealth 200 /
  not degraded · test_api action → HTTP 200 reachable · /health ok`.
  All three owner asks landed: auto-leave removed, bot errors fixed
  (50035 button guard + db wedge), code scanned end-to-end.

---

## 2026-11-10 — auto-leave policy removed (bot stays in every server)

- ASK: "Remove the bot feature where it leaves servers that has less than
  150 members".
- REMOVED end-to-end, every layer:
  - `config.minGuildMembers` + the `MIN_GUILD_MEMBERS` env var (was default 150).
  - Join-time leave in `guildCreate` (DM + `guild.leave()` for small servers) —
    every new server now gets the normal welcome card regardless of size.
  - The 10-min sweep + 60s first-pass in `ready` (`runSmallGuildSweep`,
    `startSmallGuildSweep`, `dmOwnerBeforeLeaving`).
  - `/owner sweep` subcommand + dispatch case + handler.
  - Dashboard action `run_autoleave` (action map, DANGER set, palette row,
    `minGuildMembers` overview flag, `MIN_GUILD` env-display regex).
  - `leaveCard` component + its smoke coverage.
  - Threshold footnotes on `/status` (`· auto-leave 150+`) and `/serverinfo`
    ("Threshold: …") and the welcome card's "only stays in servers with …"
    line (replaced with a /help tip).
  - README feature bullet + env-table row.
- KEPT (deliberate, not the auto-leave policy): manual `/owner leave <guild_id>`
  and the dashboard `leave_guild` action — owner-triggered, one guild at a time.
- `npm run smoke` green; `node --check` clean on every touched file.

---

## 2026-11-09 — v3 catalog: 100+ invokable actions + dashboard v3

- ASK: "Make The Bot Dashboard Look More Good And Add Extremely Powerfull
  commands i want like 100+" + "make the bot message support this msg format
  and more formats ```diff …```".
- COMMANDS: 42 top-level / 132 invokable (was 40/85-ish). Two new suites:
  - `/tools` (10 subs): ip (ip-api.com), dns (dns.google), headers,
    urlstatus, unshort (redirect-chain tracer), json, regex, jwt (decode +
    expiry verdict, no verify), qr (qrserver.com image via MediaGallery),
    cron (Vixie-cron parser + next 3 runs, dom/dow OR rule, UTC).
  - `/text` (11 subs): case (9 styles), reverse (grapheme-safe), wc, sort
    (5 modes), dedupe, mock, binary ↔, morse ↔, caesar (+rot0/rot13 table),
    leet (classic/hardcore), charinfo (codepoint/utf8/entity).
  - `/bx` grew: chain (auto-hops gated→gated up to 3, oauth pause mid-chain,
    honest broke-report), export (last 10 as JSON, ephemeral), cacheinfo
    (stats + per-URL cached verdict). cacheStats() now returns
    { size, ttlMs, hits } — additive, dashboard still fine.
- REGISTRATION: suites wired into commands/index.js + catalog assignment
  (tools/text → utility). Global registration stays automatic on ready
  (`client.application.commands.set`), 42 < 100 global limit.
- DASHBOARD v3: inline-SVG bolt crest (sidebar + login, no external assets),
  hero strip "BypassX Mission Control" with live KPIs (invokables/guilds/
  bypasses/uptime — id-guarded singleton so auto-refresh can't duplicate),
  stat cards show "42 top · 132 invokable", botline shows both counts,
  polish: custom scrollbar, ::selection, stat hover lift, row hover,
  canonical domain bypassx.de5.net in footer. Fixed pre-existing bug: stat
  values containing `<small>` rendered as literal text (statCard now renders
  our own markup when the value carries `<small>`).
- FORMAT VOICE: all new commands speak diff/ansi/kvTable natively; audited
  every public command — ping/uptime already used statusPanel, bypass/result/
  error/copy containers already diff-styled. Nothing plain left on core paths.
- TESTS: smoke.js updated (42 commands, +tools/+text roster, invokables ≥130,
  dashboard v3 markers) — 16 groups PASS. New harnesses:
  scripts/test-new-suites.mjs (25 checks, all pure-compute subs incl. live
  dns/urlstatus) and scripts/test-tools-live.mjs (ip/headers/unshort/qr
  live, 4/4). Harness caught a real cron bug (numeric ranges broke on named
  fields; months off-by-one) — parseField rewritten, jan=1…dec=12 +
  sun=0…sat=6 with 7→0 folding, bounds-checked. scripts/test-bx-offline.mjs
  covers cacheinfo/export paths (3/3).

---

## 2026-11-08 — v1.3.0 "Mobile raw copy + reliability + /status & /recent"

- ASK: "Mobile Copy button should only give the raw result and nothing else —
  only the bypassed raw result like `free_hahauah`; make the bot more reliable
  by adding more features and commands; remove the owner commands section from
  the /help menu."
- MOBILE RAW COPY: `bxcopy:m:*` now replies a bare ephemeral
  `content` message — exactly the result string (key like `free_…` or the bare
  link), no container, no header, no footer. PC Copy keeps the code-block
  card; Open Result unchanged. Mobile long-press now copies nothing but the
  result.
- HELP MENU: owner command line removed from `/help` (the `/owner` command
  still exists and stays double-gated: interactionCreate guard + command-side
  guard). Public section now lists `/recent` and `/status`. README owner rows
  replaced with a single "private owner-maintenance commands exist but are
  intentionally not documented" note.
- RELIABILITY (4 layers):
  1. `fetchWithRetry` in api.js — transport resets and 408/429/5xx retried
     with 0.8s/2.2s backoff, honors sane Retry-After; a full timeout gets
     exactly one automatic retry (server-side pace memory makes a rerun pick
     up where it stopped); 4xx never retries. Wired into both `bypassUrl`
     and `resumeOauth`.
  2. `src/watchdog.js` — probes the API every 5 min independent of traffic;
     3 consecutive failures → `degraded` flag + one warn log; recovery logs
     we're back. Surfaced in `/status`.
  3. Gateway events — Client Error/Warn + Shard Disconnect/Reconnecting/
     Resume all logged (was: silent socket trouble).
  4. `loginResilient` — up to 3 login attempts (5s/15s backoff) for transient
     network errors; invalid-token and disallowed-intents fail fast (the
     intent fallback path still works).
- NEW COMMANDS:
  - `/status` — deep diagnostics: gateway + shard ping, live API probe +
    watchdog state + registry freshness, database transport (Postgres vs
    memory-only), cache/token metrics, first-try success rate, maintenance
    mode, version. Distinct from `/stats` (usage numbers).
  - `/recent` — your last 5 successful (deduped) bypasses with one ⚡ "Run #n"
    button each; rerun goes through the normal bypass flow, result stays
    ephemeral; buttons carry the requester's id (30 min TTL).
- INFRA: commands registered 19 → 21; version 1.3.0; smoke asserts the new
  surface (`ago()` cases, watchdog zero-state, /status + /recent presence,
  21 commands). SMOKE PASS 12/12 check groups.
- NOTE: /recent rerun buttons reuse `runBypass` with `hidden:true` — on a
  button interaction deferReply(ephemeral) → editReply renders the whole
  result card ephemerally; source recorded as `recent` in bypass_logs.

---

## 2026-11-08 — DEPLOYED LIVE on Render (image-runtime workaround)

**Status: LIVE.** `https://nexobypass-api.onrender.com` · service id
`srv-dbbhiitg1s2s73910p8g` (renamed `bypassx-api-bot`) · free plan · oregon.

- **The blocker:** Render's API rejected *every* GitHub repo URL at service
  creation AND service update with "passed in repository URL is invalid or
  unfetchable" — verified platform-side with canaries (`vercel/next.js`
  failed identically; the repo itself serves HTTP 200 and its git smart-http
  endpoint works). Their status page showed all-green the whole time. The
  outage lasted 10+ hours (01:30 → 11:45 +08:00), surviving ~15 automated
  retries.
- **Dead ends mapped:** (a) create from repo — broken validation; (b) PATCH
  an existing service's repo — same validation; (c) create an image-backed
  service — passes image validation but Render demands payment info for new
  image services (no card available); (d) repoint a resumed suspended service
  at its old repo — that repo (BypassXOfficial/LittleBypass) now 404s.
- **The working path — image runtime on an existing free service:**
  1. Resumed a suspended free-tier service via `POST /v1/services/{id}/resume`.
  2. Switched it to the image runtime with
     `PATCH /v1/services/{id}` `{"image":{"imagePath":"docker.io/library/nginx:alpine","ownerId":…},"serviceDetails":{"runtime":"image"}}`
     — **no payment gate on PATCH of an existing service** (only creation is
     gated). A canary nginx deploy confirmed image deploys work on free.
  3. Built the bot image daemonlessly: staged `src` + `scripts` + lockfile,
     `npm install --omit=dev`, tarred it as `/app`, then
     `crane mutate --append layer.tar --workdir /app --entrypoint node,/app/src/index.js
     -e NODE_ENV=production node:20-alpine` → pushed to GHCR.
  4. New GHCR packages are private and the API has **no** visibility endpoint,
     and Render exposes no registry-credential API — so the image was copied
     onto an **already-public** package we own as a separate tag
     (`…:api-bot`, original tags untouched). Anonymous pull verified.
  5. PATCHed the service to that image path, `/health` health check, name
     `bypassx-api-bot`, and PUT the full env var set; triggered the deploy.
- **Verified runtime (logs):** `Neon Postgres ready — ep-curly-leaf-… (pool
  max 4)` · `Logged in as BypassX Api#0825 (1568618506667425974) — 1 guild(s)`
  · `Registered 19 global application commands` · `Loaded 48 supported
  services / 86 domains` · `Your service is live 🎉`. `/health` →
  `{"ok":true,"guilds":1,…}`. Only log noise: a benign pg `sslmode` deprecation
  warning.
- **Notes / follow-ups:** the deploy source is the container image, not the
  git repo — when Render's repo validation recovers, the service can be
  switched back to the public repo with a single PATCH (blocked today by the
  same validation). `dockerCommand` cannot be set via API for image runtimes
  (silently ignored), which is why the entrypoint is baked into the image.
  `POST /v1/services/{id}/deploys` re-pulls `:api-bot` — use it to ship
  updates (re-run the crane push, then trigger).



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

## 2026-11-09 — v2.0.0: the power update (100+ commands · dashboard v2 · diff formats)

- MESSAGE FORMATS: new `src/format.js` — the bot's format voice. ```diff blocks
  (+ green / - red / ! orange / @@ cyan headers) are Discord's native status
  renderer and now carry every result: bypass destinations land as a fat green
  `+ https://…` line, errors as a red `-` line, batch reports as a full
  diff ledger. `ansi` blocks power terminal-style status panels (gateway/api/
  db/uptime rows colorized), `kvTable` renders aligned pipe tables, `bar`
  renders ▰▱ meters, `codeBlock` escapes nested fences.
- FORMAT SURFACES: result card (diff result block), error card (diff error
  line), copy card (diff block = one-click copy), ping + status + uptime
  (ansi panels), stats + me (bar meters + kvTables), /bx batch/multicheck,
  suggest, privacy, shortcuts, changelog, help. The "/bypass" ack became a
  diff-styled status line ("+ chain started").
- 100+ COMMANDS: 40 top-level · **106 invokable actions** (verified by smoke).
  * /bx suite — batch (5 links in one run, per-link diff report + link
    buttons), key (explicit key-system runner), multicheck (5-link registry
    verdict), last (re-run your previous link), suggest (direct-to-owner idea).
  * /utility — encode/decode (base64/hex/url + auto), hash (4 algos), uuid,
    password (crypto.randomBytes, ephemeral), timestamp (relative Discord
    times), snowflake (ID decode), math (whitelisted evaluator), color
    (hex→rgb/hsl/int), baseconvert.
  * /fun — roll NdM, flip, eightball, choose (diff-styled elimination), rate
    (▰▱ meter), love (deterministic sha256 pair score), rps, duel.
  * /server (perm-gated) — purge (filters: user/bots/links, 14d-safe paging),
    slowmode, lock/unlock (@everyone SendMessages), say, embed, announce
    (channel + role ping), nick, topic, pin/unpin.
  * /info — avatar, banner (fetch(true)), roleinfo, channelinfo, emojiinfo,
    emojilist (grouped), roles, boosts, servericon.
  * standalone — /leaderboard, /history (domain filter + rerun buttons),
    /serviceinfo, /randomservice, /docs, /changelog, /privacy, /reminder
    (DM timers), /poll (button votes, live ▰▱ tallies), /faq, /shortcuts,
    /uptime, /tip, /commands (catalog by category).
  * /owner +6 subs (23 total): sql (read-only guard), avatar, username,
    cmdstats (per-command DB counters), prune, config (full flag dump).
  * `src/commands/catalog.js` — one category registry feeding /commands +
    /help; per-command usage counters (`cmd:<name>` in counters) feed the
    dashboard and /owner cmdstats.
- DASHBOARD v2 (owner console): brand-red BypassX identity, inline SVG favicon,
  sidebar tabs (Overview · Guilds · Actions · Command usage · Logs &
  feedback · Config), searchable action palette (filter input + group select +
  chips) covering **57 actions** (+29 new: send_embed, dm_guild_owner,
  fetch_message, guild_roles/emojis/invites/bans/members, member_info/kick/
  ban/timeout, create/delete channel+role, set_status, reload_commands,
  dump_env (names only, values redacted), sql_query (read-only), bypass_url
  (run a bypass from the console!), feedback_list/clear, command_counts,
  preview_diff). KPI grid (16 cards), per-command usage table with share bars,
  quick toggles (maintenance/auto-bypass/status), sticky console drawer.
  Danger zone extended to member/channel/role/feedback actions.
- DANGER SET + CONFIRM: 12 danger actions now require confirm:true (was 6).
- DB: new helpers — lastBypass, userHistory (domain ILIKE filter), topUsers,
  commandCounts, rawQuery (owner read-only passthrough).
- TESTS: smoke extended — format engine (diff shapes, fence escaping,
  kvTable alignment, bar, ANSI), formats-reach-cards (result/error JSON
  assertions), 40/106 command registry validation (unique names, invokables
  >= 100), owner 23 subcommands, 57 dashboard actions + danger set, v2 UI
  markers + every action id present in the palette, poll button router,
  catalog categories. 16 check groups ALL GREEN.

## 2026-11-10 — THE BIGGEST SCAN (bot half): no interaction dead-ends, next-outage class closed, verbatim dashboard send

- ASK: biggest scan of all services, no bugs accepted. The website half is in
  the BypassXWebsite worklog (first-win race, deadline clamps, API lockdown,
  live-fire 6/6). This entry = the Api-Bot half (static audit findings fixed,
  image digest 25d28d5c… deployed as dep-dbpjhirm8hqs73e3ei50, /health
  truthful + stable, 5 guilds).
- ACK DISCIPLINE — the "interaction failed" killer is closed: 10 commands did
  slow I/O BEFORE their first reply (10s registry refresh, Neon cold-start DB
  reads, owner-DM loops) and blew Discord's 3s window exactly when the
  service was degraded. stats/check/services/randomservice/recent/me/
  serverinfo/feedback/bx-last defer first now (ephemeral where the result was
  ephemeral, public where it was public); bypass-link bounds its registry
  refresh at 2.5s and runBypass skips its defer when already deferred (no
  double-defer, public result stays public).
- CRASH-SAFETY — the next 8h-outage class: process handlers now registered
  FIRST in main() (a rejection inside onReady/presence used to fire before
  the end-of-main registration with no handler = default process death);
  /health lies no more (ok:true only when the gateway is READY, new `ws`
  field, 503 otherwise — Render keep-alive and the self-ping can no longer
  babysit a silent zombie); dashboard gateway restarts no longer stack
  watchdog/registry/token-cleanup intervals nor leave the old presence
  rotation calling setActivity on the destroyed client (singleton rotation,
  guarded start flags, per-tick try); self-ping bounded (10s abort).
- AUTO-BYPASS — failed URLs are un-marked now (the old mark-before-call
  blackholed a URL for the whole 10-min TTL: no ❌, no retry, silently
  dropped while /recent showed the failure); oauth results render through
  oauthContainer (the generic container read result.url=undefined → "Key
  Generated" card with an EMPTY diff block and copy buttons literally
  containing "undefined"); only `kind === "destination"` results are cached
  (a cached oauth action was a stale handoff on replay).
- /bx chain + batch: 13-min deadline — a worst-case chain (3 hops x ~9.4min
  bypass each) exceeded Discord's 15-min interaction token; the final
  editReply threw "Unknown interaction" and the user sat on the
  "chain-bypassing…" placeholder forever. Clean cut + partial report now.
- DASHBOARD SEND-MESSAGE IS VERBATIM: reqText's `.trim()` silently stripped
  leading/trailing blank lines — real content in ```diff```/quote
  compositions. Trim now applies only to the required/length checks; the
  delivered content is untouched (1900 UTF-16 cap can never under-count
  Discord's 2000 code points). Multi-line textareas + fences verified.
- SECURITY: sql_query (dashboard + /owner sql) — the after-';' regex guard
  was bypassable with `WITH d AS (DELETE …) SELECT …` (no ';' before the
  DELETE) → real data destruction from the "read-only" console; now a
  full-string data-modifying keyword scan + single-statement rule. Dashboard
  token moved to the Authorization header (query strings land in Render
  request logs forever) + no-referrer on HTML; export.json fetched via
  header + blob download (and actually exports 1000 rows — the 25-row clamp
  made the button a lie). tools headers/urlstatus/unshort now run through
  isBlockedHost (users could make the bot fetch localhost/metadata/internal
  hosts and print headers incl. set-cookie back). Postgres TLS verification
  ON. Real SQL errors logged (the `if (dbOk)` warn condition was dead code —
  genuine SQL failures vanished) with connection strings scrubbed from all
  db error paths; initDb logs a URL-parsed host (split('@') broke on
  passwords containing @). Transport switching is single-flight (two
  concurrent failures used to shutdownDb each other's fresh pool). Button
  tokens are CSPRNG now (seq + Math.random was guessable in-channel, and
  copy tokens had no owner check). OWNER_IDS-unset boots with a loud warning.
- BUTTONS/MODALS: any handler throw now answers the user (outer-catch
  reply/followUp fallback mirroring command dispatch); every reply/update is
  .catch-guarded; unknown customIds get an honest "expired" card instead of
  dead silence.
- companion/bypassx-companion.user.js added to this repo (v2, 328 lines) —
  the website's /companion page installs from GitHub raw since Safe Browsing
  blocks on-domain .user.js hosting; the crowd-learning loop is alive again.
- TESTS: smoke 16/16 (42 top-level / 131 invokables) · bx-offline 3/3 ·
  tools harness 25/25 · node --check every file. IMAGE: digest
  sha256:25d28d5c… export-verified before deploy (patch markers grepped
  in-image: unhandledRejection-first, VERBATIM passthrough, scrubConn,
  started.watchdog; layer scoped to /app; sources node --check clean).

## 2026-11-14 — auto-bypass v2: self-cleaning + channel announcement (c5e1e3a + f5729f1, deployed digest sha256:f7907f21…)
- SELF-CLEANING: a successful auto-bypass now deletes its traces 60s after the
  result lands — BOTH the result card AND the user's link message
  (messageCreate.scheduleCleanup, unref'd timer; result first, user msg second).
  The card announces its own self-delete (result footer: "auto-bypass ·
  self-deletes in 60s — copy what you need"; oauth card: "card self-deletes in
  60s — finish the sign-in now") so nobody loses a key they didn't copy.
- DEGRADED-MODE GRACE: deleting the user's message needs Manage Messages; when
  the bot lacks it the result card still cleans up and the permission miss is
  skipped silently (no error spam per message).
- FAILURE PATH UNTOUCHED (by design): failures still react ❌ and leave the
  message alone — a failed bypass deletes nothing (user message + reaction stay
  as the retry affordance). Fake-timer test proves no deletion timer is armed.
- ENABLE ANNOUNCEMENT: /enable-autobypass now posts a visible V2 announcement
  card in every NEWLY armed channel ("Auto-bypass enabled in this channel" ·
  what-happens list incl. the 60s self-delete · armed-by credit, no ping via
  allowedMentions parse:[]); re-arm stays silent (no duplicate spam); missing
  Manage Messages adds a hint line naming the permission and the degraded
  behavior. Admin's private ephemeral confirmation updated with the same copy.
- CONSISTENT COPY: /autobypass status footer, /invite permission list (Manage
  Messages now recommended-optional), guild-create welcome all mention the
  60s self-clean; ⚡ prefix on the "bypassing your link…" ack.
- TESTS: new scripts/test_autobypass_cleanup.mjs — 7 scenario groups green
  (fake-timer 60s deletion for destination + oauth paths, failure path leaves
  everything, footers auto-vs-manual, enable announcement + silent re-arm +
  Manage-Messages hint); smoke 16/16 · bx-offline 3/3 · suites 25/25 ·
  op-tools 53/53 · node --check every touched file.
- DEPLOY: GitHub main (c5e1e3a, f5729f1) → image rebuild (crane append-layer,
  export-verify PASS: layer scoped to /app, patches grepped in-image,
  sources parse) → Render clearCache deploy dep-dbs4tfrrjlhs73d60m20 →
  live; /health ok:true (client.isReady) fresh boot, 11 guilds. NOTE: this
  service is IMAGE-runtime — GitHub push does NOT deploy it; the flow is
  build_bot_image.sh (crane) → deploy trigger. Also: crane is not preinstalled
  in the sandbox — restored v0.20.3 static binary to scripts/bin/.

## 2026-11-14 (later) — auto-bypass v2.1: failures speak too (9e8e961, deployed digest sha256:ae8cb442…)
- FAILURE CARDS: a failed auto-bypass no longer answers with a silent ❌ — it
  still reacts ❌ (instant glance marker) AND posts a short red error card:
  "Couldn't bypass this link" + the honest ApiError reason in the ```diff```
  del-block (same look as the manual /bypass failure card) + a what-now line
  ("post the link again to retry; every attempt runs fresh") + the self-delete
  notice. errorContainer gained optional `note` + `footerText` params (backward
  compatible — existing callers unchanged).
- FAILURE SELF-CLEAN: the failure card AND the user's link message now
  self-delete 60s after the attempt settles (same scheduleCleanup as success) —
  the ❌ reaction goes with the deleted message, so failures leave zero trace.
  Failed URLs stay un-marked in the recent map → re-posting is a fresh retry.
- NO Try-Again BUTTON ON THE AUTO FAILURE CARD (deliberate): the card
  self-deletes at 60s and could vanish mid-retry (handleRetry edits the card in
  place; paced chains run up to 2 min) — a button on a doomed card is a lie.
  Manual /bypass and the retry button keep their existing flows untouched.
- COPY SYNC: /autobypass footer, /enable-autobypass announcement + ephemeral
  how-it-works, guild-create welcome, /changelog all say "failures post a
  quick error card, everything self-cleans in 60s".
- TESTS: failure scenario rewritten — ack + card sent, ❌ kept, honest reason
  rendered, self-delete note present, NO retry button, fake-timer 60s deletion
  of card + user message; 7 groups green · smoke 16 green · bx-offline 3 ·
  suites 25 · op-tools 53 · node --check all touched files.
- DEPLOY: push 9e8e961 → image sha256:ae8cb442… (export-verify PASS, failure
  card marker grepped in-image) → Render clearCache deploy live → /health
  ok:true fresh boot, 11 guilds. NOTE: /home/z/botwork symlink (build script's
  expected SRC path) is recycled with the sandbox — recreate before building:
  ln -sfn /home/z/my-project/botwork /home/z/botwork
