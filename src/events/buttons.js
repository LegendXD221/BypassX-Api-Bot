import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { config } from '../config.js';
import { store } from '../db.js';
import { bypassUrl, ApiError, cacheGet, cacheSet } from '../api.js';
import { runBypass } from '../commands/public/bypass-core.js';
import { truncate } from '../util.js';
import {
  V2,
  card,
  copyContainer,
  errorContainer,
  oauthContainer,
  resultContainer,
  servicesContainer,
} from '../components.js';
import { takeToken } from '../tokens.js';
import { PAGE_SIZE, filterServices } from '../commands/public/services.js';
import { handlePollButton } from '../commands/public/poll.js';
import { supported } from '../api.js';

export async function handleButton(interaction) {
  const id = interaction.customId;
  if (id.startsWith('bxcopy:')) return handleCopy(interaction);
  if (id.startsWith('bxrerun:')) return handleRerun(interaction);
  if (id.startsWith('bxsvc:')) return handleServicesNav(interaction);
  if (id.startsWith('bxretry:')) return handleRetry(interaction);
  if (id.startsWith('bxoauth:')) return handleOauthButton(interaction);
  if (id.startsWith('bxpoll:')) return handlePollButton(interaction);
  // Unknown/stale customIds got silently ignored — the user clicked and
  // nothing happened, no "expired" hint. Answer ephemeral once.
  return interaction
    .reply({
      flags: V2 | MessageFlags.Ephemeral,
      components: [errorContainer({ title: 'Expired', description: 'This button is no longer active — run the command again for a fresh one.' })],
    })
    .catch(() => {});
}

/* ---------------- Mobile / PC copy ---------------- */

async function handleCopy(interaction) {
  const [, mode, token] = interaction.customId.split(':');
  const t = takeToken(token);
  if (!t) {
    return interaction
      .reply({
        flags: V2 | MessageFlags.Ephemeral,
        components: [errorContainer({ title: 'Expired', description: 'This result has expired — run `/bypass` again to get a fresh one.' })],
      })
      .catch(() => {});
  }
  // Mobile → ONLY the raw result (e.g. the key or the bare link), nothing
  // else: no header, no formatting, no card. Long-press copies it cleanly.
  if (mode === 'm') {
    return interaction.reply({
      content: String(t.url).slice(0, 1990),
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
  }
  return interaction.reply({
    flags: V2 | MessageFlags.Ephemeral,
    components: [copyContainer({ url: t.url, mode })],
  }).catch(() => {});
}

/* ---------------- /recent rerun buttons ---------------- */

async function handleRerun(interaction) {
  const t = takeToken(interaction.customId.slice('bxrerun:'.length));
  if (!t || t.kind !== 'rerun') {
    return interaction
      .reply({
        flags: V2 | MessageFlags.Ephemeral,
        components: [errorContainer({ title: 'Expired', description: 'These rerun buttons expired — run `/recent` again for a fresh list.' })],
      })
      .catch(() => {});
  }
  if (t.userId && interaction.user.id !== t.userId) {
    return interaction
      .reply({
        flags: V2 | MessageFlags.Ephemeral,
        components: [errorContainer({ title: 'Not your history', description: 'Only the person who ran `/recent` can rerun these links.' })],
      })
      .catch(() => {});
  }
  await runBypass({
    interaction,
    url: t.url,
    source: 'recent',
    userId: interaction.user.id,
    hidden: true,
  });
}

/* ---------------- Services pagination ---------------- */

async function handleServicesNav(interaction) {
  const [, token, pageRaw] = interaction.customId.split(':');
  const t = takeToken(token);
  if (!t || t.kind !== 'svc') {
    return interaction
      .reply({
        flags: V2 | MessageFlags.Ephemeral,
        components: [errorContainer({ title: 'Expired', description: 'This list expired — run `/services` again.' })],
      })
      .catch(() => {});
  }
  const list = filterServices(t.query);
  const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  const page = Math.min(Math.max(0, Number.parseInt(pageRaw, 10) || 0), totalPages - 1);
  const pageItems = list.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  return interaction.update({
    components: [
      servicesContainer({
        pageItems,
        page,
        totalPages,
        query: t.query,
        count: supported.count,
        domainCount: supported.domainCount,
        token,
      }),
    ],
    flags: V2,
  }).catch(() => {});
}

/* ---------------- Retry ---------------- */

async function handleRetry(interaction) {
  const t = takeToken(interaction.customId.slice('bxretry:'.length));
  if (!t || t.kind !== 'retry') {
    return interaction
      .reply({
        flags: V2 | MessageFlags.Ephemeral,
        components: [errorContainer({ title: 'Expired', description: 'This retry link expired — run `/bypass` again.' })],
      })
      .catch(() => {});
  }
  if (t.userId && interaction.user.id !== t.userId) {
    return interaction
      .reply({
        flags: V2 | MessageFlags.Ephemeral,
        components: [errorContainer({ title: 'Not your bypass', description: 'Only the person who ran the command can retry it.' })],
      })
      .catch(() => {});
  }

  await interaction.deferUpdate();
  await interaction
    .editReply({
      components: [
        card({
          accent: config.colors.warning,
          emoji: '⏳',
          title: 'Retrying…',
          body: [`Running the key chain again for \`${truncate(t.url, 80)}\` — paced key systems can take up to two minutes.`],
        }),
      ],
      flags: V2,
    })
    .catch(() => {});

  try {
    const result = await bypassUrl(t.url);
    cacheSet(t.url, result);
    store.bump('bypasses');
    const component =
      result.kind === 'oauth'
        ? oauthContainer({
            siteName: result.serviceName,
            action: result.action,
            note: result.note,
            sourceUrl: t.url,
            userId: t.userId ?? interaction.user.id,
          })
        : resultContainer({ sourceUrl: t.url, result, auto: false });
    await interaction.followUp({ flags: V2, components: [component] });
    await interaction.deleteReply().catch(() => {});
  } catch (e) {
    store.bump('failures');
    await interaction
      .followUp({
        flags: V2 | MessageFlags.Ephemeral,
        components: [
          errorContainer({
            title: e?.code === 'UNAUTHORIZED' ? 'API key rejected' : 'Bypass failed',
            description: e instanceof ApiError ? e.message : 'Something went wrong while contacting the BypassX API.',
            retryUrl: t.url,
            retryUserId: t.userId,
          }),
        ],
      })
      .catch(() => {});
    await interaction.deleteReply().catch(() => {});
  }
}

/* ---------------- OAuth handoff ---------------- */

async function handleOauthButton(interaction) {
  const token = interaction.customId.slice('bxoauth:'.length);
  const t = takeToken(token);
  if (!t || t.kind !== 'oauth') {
    return interaction
      .reply({
        flags: V2 | MessageFlags.Ephemeral,
        components: [errorContainer({ title: 'Handoff expired', description: 'The sign-in state on the server has expired. Run `/bypass` again to start a fresh key chain.' })],
      })
      .catch(() => {});
  }
  if (t.userId && interaction.user.id !== t.userId) {
    return interaction
      .reply({
        flags: V2 | MessageFlags.Ephemeral,
        components: [errorContainer({ title: 'Not your handoff', description: 'Only the person who started this bypass can resume it.' })],
      })
      .catch(() => {});
  }

  const modal = new ModalBuilder()
    .setCustomId(`bxoauth_submit:${token}`)
    .setTitle('Resume key chain');
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('bxoauth_final_url')
        .setLabel('Final URL after sign-in (?code=…)')
        .setPlaceholder('Paste the URL you landed on after approving')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(1024)
    )
  );
  return interaction.showModal(modal);
}
