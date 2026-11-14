import { SlashCommandBuilder } from 'discord.js';
import { truncate } from '../../util.js';
import { V2, card } from '../../components.js';

/** Clean user card — account age, server membership, roles. Works in DMs too. */
export default {
  data: new SlashCommandBuilder()
    .setName('userinfo')
    .setDescription('Show a clean info card for you or another user')
    .addUserOption((o) => o.setName('user').setDescription('Who to look up (default: you)')),
  meta: { cooldownMs: 2000 },

  async execute(interaction) {
    const user = interaction.options.getUser('user') ?? interaction.user;

    let member = interaction.options.getMember('user') ?? null;
    if (!member && interaction.inGuild()) {
      member =
        interaction.guild.members.cache.get(user.id) ??
        (await interaction.guild.members.fetch(user.id).catch(() => null));
    }

    const body = [
      `**Username** ${user.username}${user.globalName ? ` (${user.globalName})` : ''}`,
      `**ID** \`${user.id}\``,
      `**Account created** <t:${Math.floor(user.createdTimestamp / 1000)}:R>`,
      user.bot ? '**Type** Bot account' : null,
    ];

    if (member) {
      const roles = [...member.roles.cache.values()]
        .filter((r) => r.id !== interaction.guild.id)
        .sort((a, b) => b.position - a.position);
      const joinedAt = member.joinedTimestamp
        ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>`
        : 'unknown';
      body.push(
        `**Joined server** ${joinedAt}`,
        `**Top role** ${member.roles.highest.id === interaction.guild.id ? '@everyone' : member.roles.highest}`,
        roles.length
          ? `**Roles (${roles.length})** ${truncate(roles.slice(0, 15).map((r) => r.name).join(', '), 500)}`
          : '**Roles** none beyond @everyone'
      );
      if (member.premiumSinceTimestamp) {
        body.push(`**Boosting since** <t:${Math.floor(member.premiumSinceTimestamp / 1000)}:R>`);
      }
    } else if (interaction.inGuild()) {
      body.push('*Not a member of this server.*');
    }

    return interaction.reply({
      flags: V2,
      components: [
        card({
          emoji: '👤',
          title: `${truncate(user.displayName, 40)}`,
          subtitle: `@${user.username}`,
          body,
          thumb: user.displayAvatarURL({ extension: 'png', size: 128 }),
        }),
      ],
    });
  },
};
