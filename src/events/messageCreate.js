import { extractUrls, cooldowns } from '../util.js';
import { refreshSupported, matchService, bypassUrl, cacheGet, cacheSet } from '../api.js';
import { V2, resultContainer } from '../components.js';
import { store } from '../storage.js';
import { log } from '../logger.js';

/**
 * Auto-bypass: in channels armed by the owner, any message containing a
 * supported gated link is bypassed automatically. Unknown links are ignored
 * silently; failures react ❌ instead of spamming the channel.
 */
export async function onMessage(message) {
  try {
    if (!message.guild || message.author?.bot) return;
    const channels = store.autobypassChannels(message.guild.id);
    if (!channels.includes(message.channelId)) return;
    if (store.isBlacklisted(message.author.id)) return;

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
    if (!target) return;

    // One auto-bypass per channel every 8s keeps floods cheap.
    if (cooldowns.hit(`ab:${message.channelId}`, 8_000) > 0) return;

    await message.channel.sendTyping().catch(() => {});

    const cached = cacheGet(target);
    let result = cached;
    if (!result) {
      try {
        result = await bypassUrl(target);
        cacheSet(target, result);
      } catch (e) {
        store.bump('failures');
        log.warn(`Auto-bypass failed (${target}): ${e.message}`);
        message.react('❌').catch(() => {});
        return;
      }
    }
    store.bump('autoBypasses');

    await message.channel.send({
      flags: V2,
      components: [resultContainer({ sourceUrl: target, result, auto: true })],
      allowedMentions: { parse: [] },
    });
  } catch (e) {
    log.err('Auto-bypass handler error:', e);
  }
}
