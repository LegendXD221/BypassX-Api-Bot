import { MessageFlags } from 'discord.js';
import { store } from '../db.js';
import { resumeOauth, ApiError } from '../api.js';
import { V2, errorContainer, oauthContainer, resultContainer } from '../components.js';
import { takeToken } from '../tokens.js';
import { log } from '../logger.js';

const EPHEMERAL = V2 | MessageFlags.Ephemeral;

export async function handleModal(interaction) {
  if (!interaction.customId.startsWith('bxoauth_submit:')) return;
  const token = interaction.customId.slice('bxoauth_submit:'.length);
  const pending = takeToken(token);

  if (!pending || pending.kind !== 'oauth') {
    return interaction
      .reply({
        flags: EPHEMERAL,
        components: [
          errorContainer({
            title: 'Handoff expired',
            description: 'The server-side sign-in state has expired. Run `/bypass` again to start a fresh key chain.',
          }),
        ],
      })
      .catch(() => {});
  }
  if (pending.userId && interaction.user.id !== pending.userId) {
    return interaction
      .reply({
        flags: EPHEMERAL,
        components: [errorContainer({ title: 'Not your handoff', description: 'Only the person who started this bypass can resume it.' })],
      })
      .catch(() => {});
  }

  const finalUrl = interaction.fields.getTextInputValue('bxoauth_final_url').trim();
  await interaction.deferReply();

  try {
    const result = await resumeOauth({ url: pending.url, oauthUrl: finalUrl, ref: pending.ref });
    store.bump('bypasses');
    if (result.kind === 'oauth') {
      // The resumed chain demanded another sign-in step — surface it again.
      return interaction.editReply({
        components: [
          oauthContainer({
            siteName: result.serviceName,
            action: result.action,
            note: result.note,
            sourceUrl: pending.url,
            userId: pending.userId,
          }),
        ],
        flags: V2,
      });
    }
    return interaction.editReply({
      components: [resultContainer({ sourceUrl: pending.url, result, auto: false })],
      flags: V2,
    });
  } catch (e) {
    store.bump('failures');
    log.err('OAuth resume failed:', e);
    return interaction.editReply({
      components: [
        errorContainer({
          title: 'Resume failed',
          description: e instanceof ApiError ? e.message : 'Something went wrong while resuming the key chain.',
        }),
      ],
      flags: V2,
    });
  }
}
