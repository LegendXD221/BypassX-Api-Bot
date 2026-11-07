import { MessageFlags } from 'discord.js';
import { isOwner } from '../config.js';
import { store } from '../storage.js';
import { cooldowns, truncate } from '../util.js';
import { errorContainer, V2 } from '../components.js';
import { log } from '../logger.js';
import { handleButton } from './buttons.js';
import { handleModal } from './modals.js';

export async function onInteraction(interaction) {
  try {
    if (interaction.isChatInputCommand()) return await handleCommand(interaction);
    if (interaction.isButton()) return await handleButton(interaction);
    if (interaction.isModalSubmit()) return await handleModal(interaction);
  } catch (e) {
    log.err('Interaction handler error:', e);
  }
}

async function handleCommand(interaction) {
  const cmd = interaction.client.commands.get(interaction.commandName);
  if (!cmd) return;

  if (cmd.ownerOnly && !isOwner(interaction.user.id)) {
    return interaction
      .reply({
        flags: V2 | MessageFlags.Ephemeral,
        components: [errorContainer({ title: 'Owner only', description: 'This command is reserved for the bot owner.' })],
      })
      .catch(() => {});
  }

  if (store.isBlacklisted(interaction.user.id)) {
    return interaction
      .reply({
        flags: V2 | MessageFlags.Ephemeral,
        components: [
          errorContainer({
            title: 'You are blacklisted',
            description: 'You are restricted from using this bot. Contact the bot owner if you believe this is a mistake.',
          }),
        ],
      })
      .catch(() => {});
  }

  // Cooldown: owner override → global override → command default.
  const cfg = store.cooldownCfg;
  const defaultSec = (cmd.meta?.cooldownMs ?? 0) / 1000;
  const seconds = cfg[interaction.commandName] ?? cfg['*'] ?? defaultSec;
  if (seconds > 0) {
    const left = cooldowns.hit(`${interaction.commandName}:${interaction.user.id}`, seconds * 1000);
    if (left > 0) {
      return interaction
        .reply({
          flags: V2 | MessageFlags.Ephemeral,
          components: [
            errorContainer({
              title: 'Slow down a little',
              description: `You can use \`/${interaction.commandName}\` again in **${left}s**.`,
            }),
          ],
        })
        .catch(() => {});
    }
  }

  try {
    await cmd.execute(interaction);
  } catch (e) {
    log.err(`/${interaction.commandName} failed:`, e);
    const payload = {
      flags: V2 | MessageFlags.Ephemeral,
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
