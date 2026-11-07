import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { config } from '../../config.js';
import { refreshSupported, matchService, supported } from '../../api.js';
import { truncate, formatRate } from '../../util.js';
import { V2, card, errorContainer } from '../../components.js';

/** Registry lookup without burning a bypass — answers in one registry hit. */
export default {
  data: new SlashCommandBuilder()
    .setName('check')
    .setDescription('Check whether a link is supported — without bypassing it')
    .addStringOption((o) =>
      o.setName('url').setDescription('The link to check').setRequired(true).setMaxLength(512)
    ),
  meta: { cooldownMs: 2000 },

  async execute(interaction) {
    const raw = interaction.options.getString('url', true).trim().replace(/^<|>$/g, '');
    let url;
    try {
      url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('scheme');
    } catch {
      return interaction.reply({
        flags: V2 | MessageFlags.Ephemeral,
        components: [
          errorContainer({
            title: 'Invalid link',
            description: `\`${truncate(raw, 90)}\` is not a valid URL.\n\n**Example**\n\`/check url:https://linkvertise.com/1234/name\``,
          }),
        ],
      });
    }

    await refreshSupported();
    const svc = matchService(url.href);

    if (!svc) {
      return interaction.reply({
        flags: V2,
        components: [
          card({
            accent: config.colors.warning,
            emoji: '❔',
            title: 'Not in the registry yet',
            subtitle: truncate(url.hostname, 80),
            body: [
              `\`${truncate(url.hostname, 80)}\` is not in the supported-services list right now.`,
              'The registry grows constantly — you can still run **/bypass** on it; the API often handles more than the registry lists, and it will tell you honestly if it cannot.',
            ],
          }),
        ],
      });
    }

    const domains = (svc.domains ?? []).slice(0, 6);
    return interaction.reply({
      flags: V2,
      components: [
        card({
          accent: config.colors.success,
          emoji: '✅',
          title: `${svc.name} is supported`,
          subtitle: `${supported.count} services · ${supported.domainCount} domains in the registry`,
          body: [
            `**Match** \`${truncate(url.hostname, 80)}\` → **${svc.name}**${
              svc.successRate != null ? ` · ${formatRate(svc.successRate)} success` : ''
            }`,
            domains.length ? `**Known domains**\n${domains.map((d) => `> \`${d}\``).join('\n')}` : null,
            svc.tagline ? `*${truncate(svc.tagline, 150)}*` : null,
            '-# Run **/bypass** to bypass it now.',
          ],
        }),
      ],
    });
  },
};
