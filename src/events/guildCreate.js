import { PermissionsBitField } from 'discord.js';
import { log } from '../logger.js';
import { card, V2 } from '../components.js';

/**
 * Guild lifecycle — every new server gets a minimal welcome card with a
 * quick start (no size policy: the bot stays in any server that invites it).
 */
export async function onGuildCreate(guild) {
  log.info(`Joined ${guild.name} (${guild.id}) — ${guild.memberCount ?? '?'} members`);

  const channel = guild.systemChannel;
  const me = guild.members.me;
  const canSend =
    channel &&
    channel
      .permissionsFor(me)
      ?.has(PermissionsBitField.Flags.ViewChannel | PermissionsBitField.Flags.SendMessages);

  if (canSend) {
    await channel
      .send({
        flags: V2,
        components: [
          card({
            emoji: '⚡',
            title: 'BypassX Api is here',
            subtitle: 'Bypass gated links straight in Discord — powered by the official BypassX API',
            body: [
              '**Quick start**\n`/bypass url:` — bypass any supported link\n`/services` — browse every supported service\n`/help` — see everything the bot can do',
              '**Server admins** — turn on auto-bypass with `/enable-autobypass` and every supported link posted in that channel gets bypassed automatically. Results and the link message self-clean 60s later.',
              '-# Tip: `/help` shows everything — auto-bypass keeps results one tap away.',
            ],
          }),
        ],
      })
      .catch(() => {});
  }
}
