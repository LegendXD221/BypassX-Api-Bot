import { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { config } from '../../config.js';
import { store } from '../../db.js';
import { bypassUrl, cacheGet, cacheSet, cacheStats, matchService, refreshSupported } from '../../api.js';
import { V2, card, errorContainer, feedbackContainer, resultButtons, oauthContainer, safeLinkUrl } from '../../components.js';
import { truncate } from '../../util.js';
import { diffBlock, diffStatus, diffFail, codeBlock, kvTable, cut } from '../../format.js';
import { runBypass, normalizeBypassUrl } from '../public/bypass-core.js';

/* ------------------------------------------------------------------ */
/* /bx — the bypass power suite                                        */
/* batch · key · multicheck · last · suggest                           */
/* ------------------------------------------------------------------ */

/** Validate one raw url string the same way /bypass does. */
function safeUrl(raw) {
  if (!raw) return null;
  return normalizeBypassUrl(raw);
}

export default {
  data: new SlashCommandBuilder()
    .setName('bx')
    .setDescription('BypassX power tools — batch runs, key systems, multi-checks and more')
    .addSubcommand((sc) =>
      sc
        .setName('batch')
        .setDescription('Bypass up to 5 supported links in one go')
        .addStringOption((o) => o.setName('link1').setDescription('First gated link').setRequired(true).setMaxLength(1024))
        .addStringOption((o) => o.setName('link2').setDescription('Second gated link').setMaxLength(1024))
        .addStringOption((o) => o.setName('link3').setDescription('Third gated link').setMaxLength(1024))
        .addStringOption((o) => o.setName('link4').setDescription('Fourth gated link').setMaxLength(1024))
        .addStringOption((o) => o.setName('link5').setDescription('Fifth gated link').setMaxLength(1024))
        .addBooleanOption((o) => o.setName('hidden').setDescription('Only you can see the results (default: off)'))
    )
    .addSubcommand((sc) =>
      sc
        .setName('key')
        .setDescription('Run a key system (Delta, Luau, RblxScriptHub… — the key string is the result)')
        .addStringOption((o) => o.setName('url').setDescription('The key-system link').setRequired(true).setMaxLength(1024))
        .addBooleanOption((o) => o.setName('hidden').setDescription('Only you can see the result (default: off)'))
    )
    .addSubcommand((sc) =>
      sc
        .setName('multicheck')
        .setDescription('Check up to 5 links — which ones are supported?')
        .addStringOption((o) => o.setName('links').setDescription('Up to 5 links separated by spaces or new lines').setRequired(true).setMaxLength(2000))
    )
    .addSubcommand((sc) =>
      sc
        .setName('last')
        .setDescription('Re-run your most recent bypass exactly as it was')
    )
    .addSubcommand((sc) =>
      sc
        .setName('chain')
        .setDescription('Bypass a link — and if the result is gated again, keep going (up to 3 hops)')
        .addStringOption((o) => o.setName('url').setDescription('First gated link').setRequired(true).setMaxLength(1024))
        .addBooleanOption((o) => o.setName('hidden').setDescription('Only you can see the result (default: off)'))
    )
    .addSubcommand((sc) =>
      sc
        .setName('export')
        .setDescription('Export your last 10 bypasses as a JSON code block')
    )
    .addSubcommand((sc) =>
      sc
        .setName('cacheinfo')
        .setDescription('Cache stats — entries, hit rate, and whether a link is already cached')
        .addStringOption((o) => o.setName('url').setDescription('Optional link to check against the cache').setMaxLength(1024))
    )
    .addSubcommand((sc) =>
      sc
        .setName('suggest')
        .setDescription('Suggest a service or feature straight to the bot owner')
        .addStringOption((o) => o.setName('idea').setDescription('What should BypassX support or improve?').setRequired(true).setMaxLength(900))
    ),
  meta: { cooldownMs: 5000 },

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    switch (sub) {
      case 'batch':
        return runBatch(interaction);
      case 'key':
        return runKey(interaction);
      case 'multicheck':
        return runMulticheck(interaction);
      case 'last':
        return runLast(interaction);
      case 'chain':
        return runChain(interaction);
      case 'export':
        return runExport(interaction);
      case 'cacheinfo':
        return runCacheinfo(interaction);
      case 'suggest':
        return runSuggest(interaction);
      default:
        return interaction.reply({
          flags: V2 | MessageFlags.Ephemeral,
          components: [errorContainer({ title: 'Unknown subcommand', description: `**${sub}** is not wired up — use \`/help\`.` })],
        });
    }
  },
};

/* ---------------- batch ---------------- */

async function runBatch(interaction) {
  const hidden = interaction.options.getBoolean('hidden') ?? false;
  const raws = [1, 2, 3, 4, 5]
    .map((n) => interaction.options.getString(`link${n}`))
    .filter(Boolean);

  const urls = [...new Set(raws.map(safeUrl).filter(Boolean))];
  if (!urls.length) {
    return interaction.reply({
      flags: V2 | MessageFlags.Ephemeral,
      components: [
        errorContainer({
          title: 'Nothing to bypass',
          description: 'None of the links you gave could be parsed as a public http(s) URL.',
        }),
      ],
    });
  }

  await interaction.deferReply(hidden ? { flags: MessageFlags.Ephemeral } : undefined);

  const results = [];
  for (const url of urls) {
    const cached = cacheGet(url);
    if (cached) {
      results.push({ url, result: cached, ok: true });
      continue;
    }
    try {
      const result = await bypassUrl(url);
      cacheSet(url, result);
      store.bump('bypasses');
      store.logBypass({
        userId: interaction.user.id,
        guildId: interaction.guildId ?? null,
        channelId: interaction.channelId ?? null,
        source: 'bx batch',
        url,
        domain: hostOf(url),
        resultUrl: /^https?:\/\//.test(result.url ?? '') ? result.url : null,
        success: true,
      });
      results.push({ url, result, ok: true });
    } catch (e) {
      store.bump('failures');
      store.logBypass({
        userId: interaction.user.id,
        guildId: interaction.guildId ?? null,
        channelId: interaction.channelId ?? null,
        source: 'bx batch',
        url,
        domain: hostOf(url),
        success: false,
        error: e.message,
      });
      results.push({ url, error: e.message ?? String(e), ok: false });
    }
  }

  const wins = results.filter((r) => r.ok && r.result.kind === 'destination');
  const oauths = results.filter((r) => r.ok && r.result.kind === 'oauth');
  const fails = results.filter((r) => !r.ok);

  const okRows = wins.map((r) => `${r.result.serviceName ?? hostOf(r.url)} → ${cut(r.result.url, 90)}`);
  const warnRows = oauths.map((r) => `${r.result.serviceName ?? hostOf(r.url)} paused for a sign-in — run it alone with /bypass`);
  const failRows = fails.map((r) => `${hostOf(r.url)} — ${cut(r.error, 80)}`);

  const body = [
    `## ⚡ Batch complete\n-# ${wins.length} passed · ${oauths.length} paused · ${fails.length} failed`,
    diffStatus({ ok: okRows, warn: warnRows, fail: failRows, title: 'batch report', max: 1500 }),
  ];

  const rows = [];
  const linkButtons = wins
    .filter((r) => safeLinkUrl(r.result.url))
    .slice(0, 5)
    .map((r) =>
      new ButtonBuilder()
        .setURL(safeLinkUrl(r.result.url))
        .setLabel((hostOf(r.url) || 'result').slice(0, 60))
        .setEmoji('🔗')
        .setStyle(ButtonStyle.Link)
    );
  if (linkButtons.length) rows.push(new ActionRowBuilder().addComponents(...linkButtons));
  const hiddenLong = wins.filter((r) => /^https:\/\//i.test(r.result.url) && !safeLinkUrl(r.result.url)).length;
  if (hiddenLong) {
    body.push(`-# ${hiddenLong} result link${hiddenLong === 1 ? '' : 's'} exceeded Discord's 512-char button limit — copy ${hiddenLong === 1 ? 'it' : 'them'} from the report above.`);
  }

  await interaction.editReply({
    content: '',
    components: [
      card({
        accent: fails.length && !wins.length ? config.colors.error : config.colors.success,
        title: 'Batch Results',
        body,
        rows,
        footerText: 'bx batch',
      }),
    ],
    flags: V2,
  });
}

/* ---------------- key ---------------- */

async function runKey(interaction) {
  const url = safeUrl(interaction.options.getString('url', true));
  if (!url) {
    return interaction.reply({
      flags: V2 | MessageFlags.Ephemeral,
      components: [errorContainer({ title: 'Invalid link', description: 'That does not look like a public http(s) URL.' })],
    });
  }
  return runBypass({
    interaction,
    url,
    source: 'bx key',
    hidden: interaction.options.getBoolean('hidden') ?? false,
  });
}

/* ---------------- multicheck ---------------- */

async function runMulticheck(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await refreshSupported();

  const raw = String(interaction.options.getString('links', true) ?? '');
  const candidates = [...new Set(raw.split(/\s+/).map((s) => s.trim()).filter(Boolean))].slice(0, 5);

  const okRows = [];
  const failRows = [];
  for (const c of candidates) {
    const url = safeUrl(c);
    if (!url) {
      failRows.push(`${cut(c, 60)} — not a valid public URL`);
      continue;
    }
    const svc = matchService(url);
    if (svc) okRows.push(`${hostOf(url)} → ${svc.name}`);
    else failRows.push(`${hostOf(url)} — not in the registry yet (/bx suggest it!)`);
  }

  await interaction.editReply({
    flags: V2,
    components: [
      card({
        accent: config.colors.primary,
        emoji: '🔎',
        title: 'Multi-check',
        subtitle: `${candidates.length} link${candidates.length === 1 ? '' : 's'} · ${okRows.length} supported`,
        body: [diffStatus({ ok: okRows, fail: failRows, title: 'registry verdict', max: 1400 })],
        footerText: 'supported = the API can attempt it right now',
      }),
    ],
  });
}

/* ---------------- last ---------------- */

async function runLast(interaction) {
  const last = await store.lastBypass(interaction.user.id);
  if (!last?.url) {
    return interaction.reply({
      flags: V2 | MessageFlags.Ephemeral,
      components: [
        errorContainer({
          title: 'No history yet',
          description: 'You have not run a bypass yet — try `/bypass url:` first, then `/bx last` re-runs it.',
        }),
      ],
    });
  }
  return runBypass({ interaction, url: last.url, source: 'bx last', userId: interaction.user.id, hidden: true });
}

/* ---------------- suggest ---------------- */

async function runSuggest(interaction) {
  const idea = String(interaction.options.getString('idea', true) ?? '').trim();
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const entry = {
    message: idea.slice(0, 950),
    from: interaction.user.tag ?? 'unknown',
    userId: interaction.user.id,
    guild: interaction.guild?.name ?? null,
    at: new Date().toISOString(),
    kind: 'suggest',
  };
  store.appendFeedback(entry);

  let delivered = false;
  for (const ownerId of config.ownerIds) {
    const owner = await interaction.client.users.fetch(ownerId).catch(() => null);
    if (!owner) continue;
    const sent = await owner
      .send({ flags: V2, components: [feedbackContainer(entry)] })
      .then(() => true)
      .catch(() => false);
    delivered = delivered || sent;
  }

  await interaction.editReply({
    flags: V2,
    components: [
      card({
        accent: config.colors.success,
        emoji: '💡',
        title: 'Suggestion sent',
        body: [
          diffBlock({ add: ['your idea reached the owner' + (delivered ? '' : ' (inbox queued — DMs closed)')], max: 300 }),
          cut(idea, 500),
          '-# Everything you send lands in the owner console too.',
        ],
      }),
    ],
  });
}

/* ---------------- chain ---------------- */

const CHAIN_MAX_HOPS = 3;

async function runChain(interaction) {
  const first = safeUrl(interaction.options.getString('url', true));
  if (!first) {
    return interaction.reply({
      flags: V2 | MessageFlags.Ephemeral,
      components: [errorContainer({ title: 'Invalid link', description: 'That does not look like a public http(s) URL.' })],
    });
  }
  const hidden = interaction.options.getBoolean('hidden') ?? false;
  await interaction.deferReply(hidden ? { flags: MessageFlags.Ephemeral } : undefined);
  await interaction
    .editReply({
      content: `<@${interaction.user.id}> chain-bypassing…\n\`\`\`diff\n+ hop 1 — working on it\n\`\`\``,
      allowedMentions: { users: [interaction.user.id] },
    })
    .catch(() => {});

  const steps = [];
  let url = first;
  let finalResult = null;
  let finalError = null;
  for (let hop = 1; hop <= CHAIN_MAX_HOPS; hop++) {
    let result = null;
    const cached = cacheGet(url);
    if (cached) {
      result = cached;
    } else {
      try {
        result = await bypassUrl(url);
      } catch (e) {
        finalError = e;
        break;
      }
    }
    store.bump('bypasses');
    store.logBypass({
      userId: interaction.user.id,
      guildId: interaction.guildId ?? null,
      channelId: interaction.channelId ?? null,
      source: `bx chain hop${hop}`,
      url,
      domain: hostOf(url),
      resultUrl: result.kind === 'destination' && /^https?:\/\//.test(result.url) ? result.url : null,
      success: true,
    });
    if (result.kind === 'oauth') {
      steps.push({ url, kind: 'oauth', serviceName: result.serviceName });
      return interaction.editReply({
        content: '',
        components: [
          oauthContainer({
            siteName: result.serviceName,
            action: result.action,
            note: result.note,
            sourceUrl: url,
            userId: interaction.user.id,
          }),
        ],
        flags: V2,
      });
    }
    if (result.kind !== 'destination') {
      finalError = new Error('API returned an unexpected result kind — try /bypass directly');
      break;
    }
    if (!cached && result.kind === 'destination') cacheSet(url, result);
    const nextSupported = matchService(result.url);
    steps.push({ url, result, nextSupported: Boolean(nextSupported) });
    if (!nextSupported || hop === CHAIN_MAX_HOPS) {
      finalResult = result;
      break;
    }
    url = result.url;
  }

  if (!finalResult && !finalError) {
    finalError = new Error('chain stalled — no result produced');
  }

  if (finalError && steps.length === 0) {
    store.bump('failures');
    store.logBypass({
      userId: interaction.user.id,
      guildId: interaction.guildId ?? null,
      channelId: interaction.channelId ?? null,
      source: 'bx chain',
      url: first,
      domain: hostOf(first),
      success: false,
      error: finalError.message,
    });
    return interaction.editReply({
      content: '',
      components: [
        errorContainer({
          title: 'Chain failed on hop 1',
          description: finalError instanceof ApiError ? finalError.message : 'Something went wrong while contacting the BypassX API.',
          retryUrl: first,
          retryUserId: interaction.user.id,
        }),
      ],
      flags: V2,
    });
  }

  const lines = steps.map((s, i) => {
    const head = `hop ${i + 1} · ${s.result?.serviceName ?? s.serviceName ?? hostOf(s.url)}`;
    if (s.kind === 'oauth') return `! ${head} — paused for sign-in`;
    if (i === steps.length - 1) return `+ ${head} → ${cut(s.result.url, 110)}`;
    return `> ${head} → still gated, continuing…`; // next hop continues
  });

  const body = [];
  if (finalResult) {
    body.push(`## ⛓️ Chain complete\n-# ${steps.length} hop${steps.length === 1 ? '' : 's'} · ${finalResult.serviceName ?? hostOf(finalResult.url)}`);
    body.push(codeBlock('diff', lines.join('\n'), 1300));
    body.push(`**Final result**\n${diffBlock({ add: [cut(finalResult.url, 300)] })}`);
  } else if (steps.length) {
    // Last hop failed after progress
    store.bump('failures');
    body.push(`## ⛓️ Chain broke on hop ${steps.length + 1}`);
    body.push(codeBlock('diff', lines.join('\n'), 1300));
    body.push(diffFail(cut(finalError?.message ?? 'unknown error', 200)));
    body.push('-# progress steps above are still valid — retry from the last hop');
  }

  const rows = [];
  if (finalResult && /^https:\/\//.test(finalResult.url)) {
    rows.push(resultButtons(finalResult.url));
  }

  await interaction.editReply({
    content: '',
    components: [
      card({
        accent: finalResult ? config.colors.success : config.colors.error,
        title: 'Chain Results',
        body,
        rows,
        footerText: 'bx chain · follows gated→gated hops automatically',
      }),
    ],
    flags: V2,
  });
}

/* ---------------- export ---------------- */

async function runExport(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const rows = await store.userHistory(interaction.user.id, { limit: 10 });
  if (!rows.length) {
    return interaction.editReply({
      flags: V2,
      components: [errorContainer({ title: 'Nothing to export', description: 'No bypass history yet — run `/bypass` first.' })],
    });
  }
  const payload = rows.map((r) => ({
    at: r.created_at ?? null,
    source: r.source,
    url: r.url,
    result: r.result_url ?? null,
    success: r.success,
  }));
  await interaction.editReply({
    flags: V2,
    components: [
      card({
        accent: config.colors.primary,
        emoji: '📦',
        title: 'History export',
        body: [
          diffBlock({ add: [`${payload.length} entr${payload.length === 1 ? 'y' : 'ies'} — newest first`] }),
          codeBlock('json', cut(JSON.stringify(payload, null, 2), 1600)),
          '-# visible only to you · includes successful runs and failures',
        ],
        footerText: 'bx export',
      }),
    ],
  });
}

/* ---------------- cacheinfo ---------------- */

async function runCacheinfo(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const raw = interaction.options.getString('url');
  const stats = cacheStats();
  const rows = [
    ['entries', String(stats.size ?? '—')],
    ['ttl', stats.ttlMs != null ? `${Math.round(stats.ttlMs / 1000)}s` : '—'],
    ['lifetime hits', stats.hits != null ? String(stats.hits) : '—'],
  ];
  let verdict = null;
  if (raw) {
    const url = safeUrl(raw);
    if (!url) {
      return interaction.editReply({
        flags: V2,
        components: [errorContainer({ title: 'Invalid link', description: 'That does not look like a public http(s) URL.' })],
      });
    }
    const hit = cacheGet(url);
    verdict = hit
      ? `+ cached — served instantly on next /bypass${hit.serviceName ? ` (${hit.serviceName})` : ''}`
      : '- not cached — next /bypass will do the full run';
  }
  await interaction.editReply({
    flags: V2,
    components: [
      card({
        accent: config.colors.primary,
        emoji: '🗄️',
        title: 'Cache state',
        body: [kvTable(rows, { title: 'in-memory result cache' }), verdict].filter(Boolean),
        footerText: 'cache lives in RAM — resets on restart',
      }),
    ],
  });
}

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return 'link';
  }
}
