import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

/**
 * Tiny JSON persistence for owner-managed state:
 * armed auto-bypass channels, blacklist, cooldown overrides, lifetime counters.
 */
const FILE = path.resolve(process.cwd(), config.dataDir, 'state.json');

const defaultState = () => ({
  autobypass: {}, // guildId -> [channelId, …]
  blacklist: [], // userIds
  cooldownCfg: {}, // commandName | '*' -> seconds
  counters: { bypasses: 0, autoBypasses: 0, failures: 0 },
});

let state = defaultState();
let saveTimer = null;

export function loadState() {
  try {
    if (fs.existsSync(FILE)) {
      const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
      state = {
        ...defaultState(),
        ...raw,
        counters: { ...defaultState().counters, ...(raw?.counters ?? {}) },
      };
    }
  } catch {
    // Corrupt state file — start fresh rather than crash-looping.
  }
}

export function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(path.dirname(FILE), { recursive: true });
      const tmp = `${FILE}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
      fs.renameSync(tmp, FILE);
    } catch {
      // Best-effort persistence; never take the bot down over a write.
    }
  }, 200);
}

export const store = {
  get autobypass() {
    return state.autobypass;
  },
  get blacklist() {
    return state.blacklist;
  },
  get counters() {
    return state.counters;
  },
  get cooldownCfg() {
    return state.cooldownCfg;
  },

  isBlacklisted(id) {
    return state.blacklist.includes(id);
  },
  blacklistAdd(id) {
    if (!state.blacklist.includes(id)) state.blacklist.push(id);
    save();
  },
  blacklistRemove(id) {
    state.blacklist = state.blacklist.filter((x) => x !== id);
    save();
  },

  autobypassChannels(guildId) {
    return state.autobypass[guildId] ?? [];
  },
  autobypassEnable(guildId, channelId) {
    const arr = (state.autobypass[guildId] ??= []);
    if (!arr.includes(channelId)) arr.push(channelId);
    save();
  },
  autobypassDisable(guildId, channelId) {
    const arr = (state.autobypass[guildId] ?? []).filter((c) => c !== channelId);
    if (arr.length) state.autobypass[guildId] = arr;
    else delete state.autobypass[guildId];
    save();
  },
  totalAutobypassChannels() {
    return Object.values(state.autobypass).reduce((n, arr) => n + arr.length, 0);
  },

  bump(metric) {
    state.counters[metric] = (state.counters[metric] ?? 0) + 1;
    save();
  },

  setCooldown(name, seconds) {
    if (seconds > 0) state.cooldownCfg[name] = seconds;
    else delete state.cooldownCfg[name];
    save();
  },
};
