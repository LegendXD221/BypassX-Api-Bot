import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  SeparatorSpacingSize,
} from 'discord.js';
import { config } from './config.js';
import { truncate, formatRate } from './util.js';
import { issueToken } from './tokens.js';

/** Flag that switches a message over to Components V2. */
export const V2 = MessageFlags.IsComponentsV2;

function brand(text = null) {
  return `-# BypassX Api • v${config.version}${text ? ` • ${text}` : ''}`;
}

/**
 * Generic card — an accent-colored container with a big header, optional
 * body paragraphs, action rows and the brand footer.
 */
export function card({
  accent = config.colors.primary,
  emoji = '',
  title,
  subtitle = null,
  body = [],
  rows = [],
  footerText = null,
  footer = true,
}) {
  const c = new ContainerBuilder().setAccentColor(accent);
  const head = `## ${emoji ? `${emoji} ` : ''}${title}${subtitle ? `\n-# ${subtitle}` : ''}`;
  c.addTextDisplayComponents((t) => t.setContent(head));

  const text = Array.isArray(body) ? body.filter(Boolean).join('\n\n') : String(body ?? '');
  if (text.trim()) {
    c.addSeparatorComponents((s) => s.setSpacing(SeparatorSpacingSize.Small).setDivider(true));
    c.addTextDisplayComponents((t) => t.setContent(truncate(text, 3400)));
  }

  for (const row of rows) if (row) c.addActionRowComponents(row);
  if (footer) c.addTextDisplayComponents((t) => t.setContent(brand(footerText)));
  return c;
}

/* ------------------------------------------------------------------ */
/* Result card — Mobile Copy / PC Copy / Open Result                   */
/* ------------------------------------------------------------------ */

/** The three signature buttons. "Open Result" only appears on https:// links. */
export function resultButtons(resultUrl) {
  const token = issueToken({ url: resultUrl });
  const row = new ActionRowBuilder();
  row.addComponents(
    new ButtonBuilder()
      .setCustomId(`bxcopy:m:${token}`)
      .setLabel('Mobile Copy')
      .setEmoji('📱')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`bxcopy:p:${token}`)
      .setLabel('PC Copy')
      .setEmoji('💻')
      .setStyle(ButtonStyle.Secondary)
  );
  if (/^https:\/\//i.test(resultUrl)) {
    row.addComponents(
      new ButtonBuilder()
        .setURL(resultUrl)
        .setLabel('Open Result')
        .setEmoji('🔗')
        .setStyle(ButtonStyle.Link)
    );
  }
  return row;
}

/**
 * The bypass result card. Works for both destinations (links) and key-system
 * results (where the API returns the KEY string itself as `destination`).
 */
export function resultContainer({ sourceUrl, result, auto = false }) {
  const isLink = /^https?:\/\//i.test(result.url);
  let host = '';
  try {
    host = new URL(result.url).hostname;
  } catch {
    host = '';
  }
  const thumb = `https://www.google.com/s2/favicons?sz=128&domain=${encodeURIComponent(host || 'bypassx')}`;

  const c = new ContainerBuilder().setAccentColor(config.colors.success);
  const timing = result.elapsedMs ? ` • ${(result.elapsedMs / 1000).toFixed(1)}s` : '';
  c.addTextDisplayComponents((t) =>
    t.setContent(
      `## ${auto ? '⚡' : '🔗'} ${isLink ? 'Link Bypassed' : 'Key Generated'}\n-# ${result.serviceName ?? 'BypassX'}${result.cached ? ' • served from cache' : ''}${timing}`
    )
  );
  c.addSeparatorComponents((s) => s.setSpacing(SeparatorSpacingSize.Small).setDivider(true));
  c.addSectionComponents((s) =>
    s
      .addTextDisplayComponents(
        (t) => t.setContent(`**Source**\n${truncate(sourceUrl, 100)}`),
        (t) => t.setContent(`**${isLink ? 'Result' : 'Key'}**\n${truncate(result.url, 300)}`)
      )
      .setThumbnailAccessory((th) => th.setURL(thumb).setDescription('Destination site icon'))
  );
  if (result.note) {
    c.addTextDisplayComponents((t) => t.setContent(`-# ${truncate(result.note, 220)}`));
  }
  c.addSeparatorComponents((s) => s.setSpacing(SeparatorSpacingSize.Small).setDivider(true));
  c.addActionRowComponents(resultButtons(result.url));
  c.addTextDisplayComponents((t) => t.setContent(brand(auto ? 'auto-bypass' : null)));
  return c;
}

/* ------------------------------------------------------------------ */
/* OAuth handoff (Delta sign-in pause)                                 */
/* ------------------------------------------------------------------ */

export function oauthContainer({ siteName, action, note, sourceUrl, userId }) {
  const ttl = Math.min(Math.max(action.expiresInMs ?? 600_000, 5 * 60_000), 14 * 60_000);
  const token = issueToken(
    { kind: 'oauth', url: sourceUrl, ref: action.ref, userId, authorizeUrl: action.authorizeUrl },
    ttl
  );
  const providerLabel = action.provider === 'google' ? 'Google' : 'Discord';

  const c = new ContainerBuilder().setAccentColor(config.colors.warning);
  c.addTextDisplayComponents((t) =>
    t.setContent(`## 🙌 One sign-in needed\n-# ${siteName ?? 'Delta'} key chain paused for a human step`)
  );
  c.addSeparatorComponents((s) => s.setSpacing(SeparatorSpacingSize.Small).setDivider(true));
  c.addTextDisplayComponents((t) =>
    t.setContent(
      `${truncate(note, 350)}\n\n**How to finish**\n1. Open the sign-in link below and approve it.\n2. Copy the **final URL** you land on (it contains \`?code=…\`).\n3. Hit **“I signed in”** and paste that URL — the chain resumes exactly where it stopped.`
    )
  );
  c.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setURL(action.authorizeUrl)
        .setLabel(`Sign in with ${providerLabel}`)
        .setEmoji('🔐')
        .setStyle(ButtonStyle.Link),
      new ButtonBuilder()
        .setCustomId(`bxoauth:${token}`)
        .setLabel('I signed in')
        .setEmoji('✅')
        .setStyle(ButtonStyle.Primary)
    )
  );
  c.addTextDisplayComponents((t) => t.setContent(brand('handoff expires soon — finish it in one go')));
  return c;
}

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

export function errorContainer({ title = 'Something went wrong', description, retryUrl = null, retryUserId = null }) {
  const rows = [];
  if (retryUrl) {
    const token = issueToken({ kind: 'retry', url: retryUrl, userId: retryUserId });
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`bxretry:${token}`)
          .setLabel('Try Again')
          .setEmoji('🔁')
          .setStyle(ButtonStyle.Primary)
      )
    );
  }
  return card({
    accent: config.colors.error,
    emoji: '⚠️',
    title,
    body: [description],
    rows,
  });
}

/* ------------------------------------------------------------------ */
/* Copy ephemerals                                                     */
/* ------------------------------------------------------------------ */

/** Mobile → plain text (long-press to copy) · PC → code block (one-click copy). */
export function copyContainer({ url, mode }) {
  const isMobile = mode === 'm';
  const body = isMobile ? String(url) : `\`${url}\``;
  const c = new ContainerBuilder().setAccentColor(config.colors.primary);
  c.addTextDisplayComponents((t) =>
    t.setContent(
      `### 📋 ${isMobile ? 'Mobile copy — long-press the link below' : 'PC copy — click the code block to copy'}\n${truncate(body, 900)}`
    )
  );
  return c;
}

/* ------------------------------------------------------------------ */
/* Services browser                                                    */
/* ------------------------------------------------------------------ */

export function servicesContainer({ pageItems, page, totalPages, query, count, domainCount, token }) {
  const lines = pageItems.map((s) => {
    const domains = (s.domains ?? []).length;
    return `> **${s.name}** · ${domains} domain${domains === 1 ? '' : 's'} · ${formatRate(s.successRate)}${s.tagline ? `\n> *${truncate(s.tagline, 90)}*` : ''}`;
  });

  const nav = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`bxsvc:${token}:${page - 1}`)
      .setLabel('Previous')
      .setEmoji('◀️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page <= 0),
    new ButtonBuilder()
      .setCustomId(`bxsvc:${token}:${page}`)
      .setLabel(`Page ${page + 1}/${totalPages}`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId(`bxsvc:${token}:${page + 1}`)
      .setLabel('Next')
      .setEmoji('▶️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= totalPages - 1)
  );

  return card({
    accent: config.colors.primary,
    emoji: '🌐',
    title: 'Supported Services',
    subtitle: `${count} services · ${domainCount} domains${query ? ` · filter: “${truncate(query, 30)}”` : ''}`,
    body: [lines.length ? lines.join('\n') : 'No services matched that filter.'],
    rows: [nav],
  });
}

/* ------------------------------------------------------------------ */
/* Broadcast                                                           */
/* ------------------------------------------------------------------ */

export function broadcastContainer({ message, requesterTag }) {
  return card({
    accent: config.colors.primary,
    emoji: '📣',
    title: 'Owner Broadcast',
    body: [message],
    footerText: `sent by ${requesterTag}`,
  });
}
