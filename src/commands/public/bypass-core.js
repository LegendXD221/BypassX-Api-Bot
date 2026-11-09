import { ApiError, cacheGet, cacheSet, bypassUrl } from '../../api.js';
import { store } from '../../db.js';
import { V2, resultContainer, oauthContainer, errorContainer } from '../../components.js';
import { isBlockedHost } from '../../util.js';
import { MessageFlags } from 'discord.js';

/**
 * Shared bypass flow used by `/bypass`, the "Bypass Link" message command and
 * the retry button. Assumes `url` was validated; handles cache, the API call,
 * OAuth handoffs, error cards and DB logging.
 */
export async function runBypass({ interaction, url, source = 'command', userId = null, hidden = false }) {
  const requester = userId ?? interaction.user.id;

  await interaction.deferReply(hidden ? { flags: MessageFlags.Ephemeral } : undefined);

  // Immediate acknowledgement — the deferred placeholder becomes a
  // diff-styled status line until the result replaces it.
  await interaction
    .editReply({
      content: `<@${requester}> bypassing your link…\n\`\`\`diff\n+ chain started — working on it\n-# result lands in this message when the API answers\n\`\`\``,
      allowedMentions: { users: [requester] },
    })
    .catch(() => {});

  const cached = cacheGet(url);
  let result;
  let wasCached = false;
  if (cached) {
    result = cached;
    wasCached = true;
  } else {
    try {
      result = await bypassUrl(url);
    } catch (e) {
      store.bump('failures');
      store.logBypass({
        userId: requester,
        guildId: interaction.guildId ?? null,
        channelId: interaction.channelId ?? null,
        source,
        url,
        domain: hostOf(url),
        success: false,
        error: e.message,
      });
      const description =
        e instanceof ApiError
          ? e.message
          : 'Something went wrong while contacting the BypassX API.';
      return interaction.editReply({
        content: '',
        components: [
          errorContainer({
            title: e?.code === 'UNAUTHORIZED' ? 'API key rejected' : 'Bypass failed',
            description,
            retryUrl: e?.code === 'NO_KEY' ? null : url,
            retryUserId: requester,
          }),
        ],
        flags: V2,
      });
    }
    if (result.kind === 'destination') cacheSet(url, result);
  }
  store.bump('bypasses');
  store.logBypass({
    userId: requester,
    guildId: interaction.guildId ?? null,
    channelId: interaction.channelId ?? null,
    source,
    url,
    domain: hostOf(url),
    resultUrl: result.kind === 'destination' && /^https?:\/\//.test(result.url) ? result.url : null,
    success: true,
  });

  if (result.kind === 'oauth') {
    return interaction.editReply({
      content: '',
      components: [
        oauthContainer({
          siteName: result.serviceName,
          action: result.action,
          note: result.note,
          sourceUrl: url,
          userId: requester,
        }),
      ],
      flags: V2,
    });
  }

  await interaction.editReply({
    content: '',
    components: [resultContainer({ sourceUrl: url, result, auto: source === 'autobypass' })],
    flags: V2,
  });
}

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/** Validate a raw user string into an http(s) URL pointing at a public host, or null. */
export function normalizeBypassUrl(raw) {
  let value = String(raw ?? '').trim().replace(/^<|>$/g, '');
  if (!value || value.length > 2048) return null;
  // If a scheme is present it must be http(s) — never blindly prepend https://
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(value);
  if (scheme && !/^https?:\/\//i.test(value)) return null;
  if (!scheme) value = `https://${value}`;
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (u.username || u.password) return null;
    if (isBlockedHost(u.hostname)) return null;
    return u.href;
  } catch {
    return null;
  }
}
