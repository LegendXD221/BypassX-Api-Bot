import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { V2, card, errorContainer } from '../../components.js';
import { diffBlock } from '../../format.js';

const timers = new Map(); // userId -> [{ at, timerId }]
const MAX_ACTIVE = 5;

/** /reminder — the bot DMs you after a delay. Fires in-process (bot uptime). */
export default {
  data: new SlashCommandBuilder()
    .setName('reminder')
    .setDescription('Get a DM reminder after a delay')
    .addIntegerOption((o) => o.setName('minutes').setDescription('Delay in minutes 1-1440 (24h)').setRequired(true).setMinValue(1).setMaxValue(1440))
    .addStringOption((o) => o.setName('text').setDescription('What to remind you about').setRequired(true).setMaxLength(300))
    .addBooleanOption((o) => o.setName('private').setDescription('Only you see the confirmation (default on)')),
  meta: { cooldownMs: 3000 },

  async execute(interaction) {
    const minutes = interaction.options.getInteger('minutes', true);
    const text = interaction.options.getString('text', true);
    const priv = interaction.options.getBoolean('private') ?? true;
    const userId = interaction.user.id;

    const active = (timers.get(userId) ?? []).filter((t) => t.timerId._destroyed === false);
    if (active.length >= MAX_ACTIVE) {
      return interaction.reply({
        flags: V2 | MessageFlags.Ephemeral,
        components: [errorContainer({ title: 'Reminder inbox full', description: `You already have ${MAX_ACTIVE} pending reminders. They fire soon — patience.` })],
      });
    }

    const fireAt = Date.now() + minutes * 60_000;
    const timerId = setTimeout(async () => {
      const list = (timers.get(userId) ?? []).filter((t) => t.timerId !== timerId);
      if (list.length) timers.set(userId, list);
      else timers.delete(userId);
      const user = await interaction.client.users.fetch(userId).catch(() => null);
      if (!user) return;
      await user
        .send({
          content: `⏰ **Reminder** (<t:${Math.floor(fireAt / 1000)}:R>):\n${text}`.slice(0, 1900),
        })
        .catch(() => {});
    }, minutes * 60_000);

    const entry = { at: fireAt, timerId };
    timers.set(userId, [...(timers.get(userId) ?? []), entry]);

    await interaction.reply({
      flags: V2 | (priv ? MessageFlags.Ephemeral : 0),
      components: [
        card({
          emoji: '⏰',
          title: `Reminder set — ${minutes} minute${minutes === 1 ? '' : 's'}`,
          body: [
            diffBlock({ add: [`will DM you <t:${Math.floor(fireAt / 1000)}:R>: ${text.slice(0, 120)}`], max: 400 }),
            '-# reminders live in the bot process — a restart clears pending ones',
          ],
        }),
      ],
    });
  },
};
