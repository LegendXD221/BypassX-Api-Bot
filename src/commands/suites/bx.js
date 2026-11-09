import { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { config } from '../../config.js';
import { store } from '../../db.js';
import { bypassUrl, cacheGet, cacheSet, matchService, refreshSupported } from '../../api.js';
import { V2, card, errorContainer, feedbackContainer } from '../../components.js';
import { truncate } from '../../util.js';
import { diffBlock, diffStatus, cut } from '../../format.js';
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
    .filter((r) => /^https:\/\//i.test(r.result.url))
    .slice(0, 5)
    .map((r) =>
      new ButtonBuilder()
        .setURL(r.result.url)
        .setLabel((hostOf(r.url) || 'result').slice(0, 60))
        .setEmoji('🔗')
        .setStyle(ButtonStyle.Link)
    );
  if (linkButtons.length) rows.push(new ActionRowBuilder().addComponents(...linkButtons));

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

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return 'link';
  }
}
