import { extractUrls, cooldowns } from '../util.js';
import { ApiError, refreshSupported, matchService, bypassUrl, cacheGet, cacheSet } from '../api.js';
import { V2, resultContainer, oauthContainer, errorContainer } from '../components.js';
import { store } from '../db.js';
import { log } from '../logger.js';

/** How long an auto-bypass attempt (result or failure) stays in the channel. */
const CLEANUP_DELAY_MS = 60_000;

/**
 * 60s after an auto-bypass attempt settles — success card OR failure card —
 * both the card and the user's link message vanish — the channel stays clean
 * without moderator effort. Cards announce their own self-delete so users
 * know to copy first. Deleting the user's message needs **Manage Messages**;
 * when the bot lacks it the bot's cards still clean up and the missing
 * permission is skipped silently.
 */
function scheduleCleanup(resultMsg, userMsg) {
  const timer = setTimeout(() => {
    resultMsg?.delete().catch(() => {});
    userMsg?.delete().catch(() => {});
  }, CLEANUP_DELAY_MS);
  timer.unref?.(); // never hold the process open for housekeeping
}

/** Recently auto-bypassed URLs — a repeat within 10 minutes is skipped. */
const recent = new Map(); // url -> timestamp
const RECENT_TTL_MS = 10 * 60_000;
const RECENT_MAX = 500;

function isRecent(url) {
  const at = recent.get(url);
  if (!at) return false;
  if (Date.now() - at > RECENT_TTL_MS) {
    recent.delete(url);
    return false;
  }
  return true;
}

function markRecent(url) {
  recent.set(url, Date.now());
  if (recent.size > RECENT_MAX) {
    const cutoff = Date.now() - RECENT_TTL_MS;
    for (const [u, t] of recent) if (t < cutoff) recent.delete(u);
  }
}

/**
 * Auto-bypass: in channels armed by a server admin, any message containing a
 * supported gated link is bypassed automatically. Unknown links are ignored
 * silently. Both outcomes are self-cleaning: the result card (or the failure
 * card) AND the user's link message are deleted 60 seconds after the attempt
 * settles (see scheduleCleanup). Failures react ❌ AND post a short error
 * card — never silence-only.
 */
export async function onMessage(message) {
  try {
    if (!message.guild || message.author?.bot) return;
    if (message.client.autobypassDisabled) return;

    // Hot path: one Set lookup against every armed channel.
    const armed = store.allAutobypassChannelIds();
    if (!armed.has(message.channelId)) return;
    if (store.isBlacklisted(message.author.id) || store.isGuildBlacklisted(message.guild.id)) return;

    const content = message.content ?? '';
    if (!content) return;
    const urls = extractUrls(content);
    if (!urls.length) return;

    await refreshSupported();
    let target = null;
    for (const url of urls) {
      if (matchService(url)) {
        target = url;
        break;
      }
    }
    if (!target || isRecent(target)) return;

    // One auto-bypass per channel every 8s keeps floods cheap.
    if (cooldowns.hit(`ab:${message.channelId}`, 8_000) > 0) return;
    markRecent(target);

    await message.channel.sendTyping().catch(() => {});

    const cached = cacheGet(target);
    let result = cached;

    // First feedback — "@user bypassing your link…" while the bypass runs.
    // Skipped for cache hits (the result lands instantly anyway) and removed
    // again once the result card or the ❌ failure reaction takes over.
    let ack = null;
    if (!cached) {
      ack = await message.channel
        .send({
          content: `⚡ ${message.author} bypassing your link…`,
          allowedMentions: { users: [message.author.id] },
        })
        .catch(() => null);
    }

    if (!result) {
      try {
        result = await bypassUrl(target);
        // Cache ONLY concrete destinations (same rule as bypass-core) — a
        // cached oauth action is a stale handoff by the time it's replayed.
        if (result.kind === 'destination') cacheSet(target, result);
      } catch (e) {
        // Un-mark: a failed URL must be RETRYABLE — marking before the call
        // poisoned it for the whole 10-min TTL (every later message with the
        // same link silently dropped, no ❌, no retry).
        recent.delete(target);
        store.bump('failures');
        store.logBypass({
          userId: message.author.id,
          guildId: message.guild.id,
          channelId: message.channelId,
          source: 'autobypass',
          url: target,
          domain: hostOf(target),
          success: false,
          error: e.message,
        });
        log.warn(`Auto-bypass failed (${target}): ${e.message}`);
        if (ack) ack.delete().catch(() => {});
        message.react('❌').catch(() => {});
        // Failure speaks too: a short error card instead of a silent ❌. No
        // Try-Again button — the card self-deletes at 60s and could vanish
        // mid-retry; posting the link again is the natural retry (the failed
        // URL was un-marked above, so the next message runs it fresh).
        const failCard = await message.channel
          .send({
            flags: V2,
            components: [
              errorContainer({
                title: 'Couldn’t bypass this link',
                description:
                  e instanceof ApiError
                    ? e.message
                    : 'Something went wrong while contacting the BypassX API.',
                note: '**What now** — post the link again to retry; every attempt runs fresh.\n-# This card and the link message self-delete in 60s — the channel stays clean.',
                footerText: 'auto-bypass',
              }),
            ],
            allowedMentions: { parse: [] },
          })
          .catch(() => null);
        if (failCard) scheduleCleanup(failCard, message);
        return;
      }
    }
    store.bump('autoBypasses');
    store.logBypass({
      userId: message.author.id,
      guildId: message.guild.id,
      channelId: message.channelId,
      source: 'autobypass',
      url: target,
      domain: hostOf(target),
      resultUrl: /^https?:\/\//.test(result.url) ? result.url : null,
      success: true,
    });

    if (result.kind === 'oauth') {
      // OAuth handoffs render through the oauth container — the generic
      // resultContainer reads result.url (undefined here) and produced a
      // "Key Generated" card with an empty diff + "undefined" copy buttons.
      const sent = await message.channel
        .send({
          flags: V2,
          components: [
            oauthContainer({
              siteName: result.serviceName,
              action: result.action,
              note: result.note,
              sourceUrl: target,
              userId: message.author.id,
              auto: true,
            }),
          ],
          allowedMentions: { parse: [] },
        })
        .catch(() => null);
      if (ack) ack.delete().catch(() => {});
      if (sent) scheduleCleanup(sent, message);
      return;
    }

    const sent = await message.channel
      .send({
        flags: V2,
        components: [resultContainer({ sourceUrl: target, result, auto: true })],
        allowedMentions: { parse: [] },
      })
      .catch(() => null);
    if (ack) ack.delete().catch(() => {});
    if (sent) scheduleCleanup(sent, message);
  } catch (e) {
    log.err('Auto-bypass handler error:', e);
  }
}

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}
