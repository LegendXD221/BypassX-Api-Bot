import { measureApi } from './api.js';
import { log } from './logger.js';

/**
 * API watchdog — probes the BypassX API every few minutes, independent of
 * user traffic, so degradation is visible in logs and /status even when no
 * one has run a bypass recently.
 *
 *   - 3 consecutive failures mark the API "degraded" (warn once).
 *   - Recovery clears the flag and logs that we are back.
 */
const state = {
  consecutiveFailures: 0,
  lastOkAt: 0,
  lastRunAt: 0,
  lastStatus: null,
  degraded: false,
};

export function apiHealth() {
  return { ...state };
}

async function tick() {
  state.lastRunAt = Date.now();
  const probe = await measureApi();
  state.lastStatus = probe.status;
  if (probe.ok) {
    if (state.consecutiveFailures >= 3) {
      log.ok(`BypassX API back online (${probe.ms}ms) after ${state.consecutiveFailures} failed probe(s).`);
    }
    state.consecutiveFailures = 0;
    state.degraded = false;
    state.lastOkAt = Date.now();
  } else {
    state.consecutiveFailures += 1;
    if (state.consecutiveFailures === 3) {
      state.degraded = true;
      log.warn(
        `BypassX API unreachable ${state.consecutiveFailures} probes in a row (last HTTP ${probe.status}) — marked degraded; bypasses will retry transient failures automatically.`
      );
    }
  }
}

export function startApiWatchdog(intervalMs = 5 * 60_000) {
  setTimeout(tick, 15_000).unref();
  setInterval(tick, intervalMs).unref();
}
