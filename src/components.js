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
import { diffBlock, codeBlock, cut, ansi, ansiBlock } from './format.js';

/** Flag that switches a message over to Components V2. */
export const V2 = MessageFlags.IsComponentsV2;

/** V2 + ephemeral — the standard combo for private interaction replies. */
export const wrapV2 = MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral;

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
  thumb = null,
}) {
  const c = new ContainerBuilder().setAccentColor(accent);
  const head = `## ${emoji ? `${emoji} ` : ''}${title}${subtitle ? `\n-# ${subtitle}` : ''}`;

  const text = Array.isArray(body) ? body.filter(Boolean).join('\n\n') : String(body ?? '');
  if (thumb && text.trim()) {
    // Header + body share one section so the thumbnail sits beside both.
    c.addSectionComponents((s) =>
      s
        .addTextDisplayComponents((t) => t.setContent(head), (t) => t.setContent(truncate(text, 3200)))
        .setThumbnailAccessory((th) => th.setURL(thumb).setDescription('Avatar'))
    );
  } else {
    c.addTextDisplayComponents((t) => t.setContent(head));
    if (text.trim()) {
      c.addSeparatorComponents((s) => s.setSpacing(SeparatorSpacingSize.Small).setDivider(true));
      c.addTextDisplayComponents((t) => t.setContent(truncate(text, 3400)));
    }
  }

  for (const row of rows) if (row) c.addActionRowComponents(row);
  if (footer) c.addTextDisplayComponents((t) => t.setContent(brand(footerText)));
  return c;
}

/**
 * Incoming user feedback — DM'd to the bot owner and stored in Postgres.
 */
export function feedbackContainer({ from, userId, guild, message }) {
  return card({
    accent: config.colors.warning,
    emoji: '📝',
    title: 'User feedback',
    body: [
      truncate(message, 950),
      `-# from **${truncate(from, 60)}** (\`${userId}\`)${guild ? ` · in **${truncate(guild, 40)}**` : ''}`,
    ],
    footerText: 'sent via /feedback',
  });
}

/* ------------------------------------------------------------------ */
/* Result card — Mobile Copy / PC Copy / Open Result                   */
/* ------------------------------------------------------------------ */

/** The three signature buttons. "Open Result" only appears on https:// links. */
export function resultButtons(resultUrl) {
  const token = issueToken({ url: resultUrl }, 45 * 60_000);
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
      .addTextDisplayComponents((t) => t.setContent(`**Source**\n${truncate(sourceUrl, 100)}`))
      .setThumbnailAccessory((th) => th.setURL(thumb).setDescription('Destination site icon'))
  );
  // The result itself in a ```diff block — a fat green + line, impossible
  // to miss and identical on desktop and mobile.
  c.addTextDisplayComponents((t) =>
    t.setContent(
      `**${isLink ? 'Result' : 'Key'}**\n${diffBlock({ add: [cut(result.url, 380)] })}`
    )
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
  // Error detail inside a ```diff block — a red `-` line reads as failure
  // even when the user never reads a word of prose.
  const detail = description
    ? `${description}\n\n${diffBlock({ del: [cut(String(description).replace(/\*\*/g, ''), 260)] })}`
    : null;
  return card({
    accent: config.colors.error,
    emoji: '⚠️',
    title,
    body: [detail],
    rows,
  });
}

/* ------------------------------------------------------------------ */
/* Copy ephemerals                                                     */
/* ------------------------------------------------------------------ */

/** Mobile → plain text (long-press to copy) · PC → diff block (one-click copy). */
export function copyContainer({ url, mode }) {
  const isMobile = mode === 'm';
  const body = isMobile ? String(url) : diffBlock({ add: [cut(String(url), 800)] });
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
    body: [
      message,
      diffBlock({ add: ['message delivered by the owner'], max: 400 }),
    ],
    footerText: `sent by ${requesterTag}`,
  });
}

/* ------------------------------------------------------------------ */
/* Live status panel — the ```ansi heartbeat                            */
/* ------------------------------------------------------------------ */

/**
 * Terminal-style status panel. Rows are [label, value, tone] where tone is
 * 'ok' | 'warn' | 'err' | 'info' — colors come straight from the ANSI set
 * Discord highlights natively.
 */
export function statusPanel(rows, { title = 'SYSTEM STATUS' } = {}) {
  const tones = {
    ok: (v) => ansi.green(v),
    warn: (v) => ansi.yellow(v),
    err: (v) => ansi.red(v),
    info: (v) => ansi.cyan(v),
  };
  const width = Math.max(0, ...rows.map(([k]) => String(k).length));
  const lines = [
    ansi.bold(`┌─ ${title} ${'─'.repeat(Math.max(0, 26 - title.length))}`),
    ...rows.map(([k, v, tone = 'info']) => {
      const paint = tones[tone] ?? tones.info;
      return `│ ${String(k).padEnd(width)} ${paint(String(v))}`;
    }),
    ansi.bold(`└${'─'.repeat(width + 24)}`),
  ];
  return ansiBlock(lines);
}
