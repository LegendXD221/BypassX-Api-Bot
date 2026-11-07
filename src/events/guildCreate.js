import { PermissionsBitField } from 'discord.js';
import { config } from '../config.js';
import { log } from '../logger.js';
import { card, leaveCard, V2 } from '../components.js';

/**
 * Guild lifecycle:
 *   - servers under MIN_GUILD_MEMBERS (default 150) are left immediately,
 *     with a polite DM to the owner explaining why
 *   - qualifying servers get a minimal welcome card with a quick start
 */
export async function onGuildCreate(guild) {
  log.info(`Joined ${guild.name} (${guild.id}) — ${guild.memberCount ?? '?'} members`);

  const count = guild.memberCount ?? 0;
  if (config.minGuildMembers > 0 && count < config.minGuildMembers) {
    log.warn(`Leaving ${guild.name} (${guild.id}) — ${count} < ${config.minGuildMembers} members`);
    if (count > 5) {
      try {
        const owner = await guild.fetchOwner();
        await owner.send({ flags: V2, components: [leaveCard(guild)] });
      } catch {
        /* DMs closed — still leave */
      }
    }
    await guild.leave().catch(() => {});
    return;
  }

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
              '**Server admins** — turn on auto-bypass with `/enable-autobypass` and every supported link posted in that channel gets bypassed automatically.',
              `-# This bot only stays in servers with ${config.minGuildMembers}+ members — thanks for qualifying!`,
            ],
          }),
        ],
      })
      .catch(() => {});
  }
}
