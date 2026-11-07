import { isOwner } from '../config.js';
import { store } from '../db.js';
import { cooldowns, truncate } from '../util.js';
import { errorContainer, wrapV2 } from '../components.js';
import { log } from '../logger.js';
import { handleButton } from './buttons.js';
import { handleModal } from './modals.js';

export async function onInteraction(interaction) {
  try {
    if (interaction.isChatInputCommand() || interaction.isMessageContextMenuCommand()) {
      return await handleCommand(interaction);
    }
    if (interaction.isButton()) return await handleButton(interaction);
    if (interaction.isModalSubmit()) return await handleModal(interaction);
  } catch (e) {
    log.err('Interaction handler error:', e);
  }
}

async function handleCommand(interaction) {
  const cmd = interaction.client.commands.get(interaction.commandName);
  if (!cmd) return;

  // Owner-only commands are gated twice — here and inside the command itself.
  if (cmd.ownerOnly && !isOwner(interaction.user.id)) {
    return replyEphemeral(interaction, {
      title: 'Owner only',
      description: 'This command is reserved for the bot owner.',
    });
  }

  // Maintenance mode — everything except owner tooling pauses.
  if (!cmd.ownerOnly && !isOwner(interaction.user.id)) {
    const maintenance = await store.getConfig('maintenance', false);
    if (maintenance) {
      return replyEphemeral(interaction, {
        title: '🛠️ Brief maintenance',
        description: 'BypassX Api is being tuned right now — try again in a minute.',
      });
    }
  }

  // Blacklist — users and whole guilds.
  if (
    store.isBlacklisted(interaction.user.id) ||
    store.isGuildBlacklisted(interaction.guildId)
  ) {
    return replyEphemeral(interaction, {
      title: 'Restricted',
      description: 'You cannot use this bot here. Contact the bot owner if you believe this is a mistake.',
    });
  }

  // Cooldown: owner override → global override → command default.
  const defaultSec = (cmd.meta?.cooldownMs ?? 0) / 1000;
  const seconds = store.cooldownSeconds(interaction.commandName, defaultSec);
  if (seconds > 0 && !isOwner(interaction.user.id)) {
    const left = cooldowns.hit(`${interaction.commandName}:${interaction.user.id}`, seconds * 1000);
    if (left > 0) {
      return replyEphemeral(interaction, {
        title: 'Slow down a little',
        description: `You can use \`/${interaction.commandName}\` again in **${left}s**.`,
      });
    }
  }

  try {
    await cmd.execute(interaction);
  } catch (e) {
    log.err(`/${interaction.commandName} failed:`, e);
    const payload = {
      flags: wrapV2,
      components: [
        errorContainer({
          title: 'Something went wrong',
          description: `\`\`\`\n${truncate(String(e?.message ?? e), 500)}\n\`\`\``,
        }),
      ],
    };
    if (interaction.replied || interaction.deferred) interaction.followUp(payload).catch(() => {});
    else interaction.reply(payload).catch(() => {});
  }
}

function replyEphemeral(interaction, { title, description }) {
  return interaction
    .reply({ flags: wrapV2, components: [errorContainer({ title, description })] })
    .catch(() => {});
}
