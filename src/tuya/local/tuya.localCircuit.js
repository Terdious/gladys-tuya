// Per-device local health / circuit breaker.
//
// A device that is locally unreachable (timeout) or misconfigured (local mode
// on but no ip/protocol yet) would otherwise be retried on EVERY poll cycle:
// 3 s wasted per cycle for a timeout, and a WARN line every 10-30 s. This
// state, kept on the handler as a Map<topic, entry>, throttles both:
//   - after N consecutive local failures a device is parked on the cloud for a
//     cooldown, then re-probed once (and re-parked if it fails again);
//   - the "LAN info incomplete" notice is logged at most once per interval.

export const LOCAL_FAILURE_THRESHOLD = 3;
export const LOCAL_COOLDOWN_MS = 5 * 60 * 1000;
export const INCOMPLETE_LOG_INTERVAL_MS = 5 * 60 * 1000;

const getEntry = (map, topic) => {
  let entry = map.get(topic);
  if (!entry) {
    entry = { failures: 0, until: 0, lastIncompleteLog: 0 };
    map.set(topic, entry);
  }
  return entry;
};

/**
 * @description Whether local polling is currently parked (in cooldown) for a device.
 * @param {Map} map - The circuit state.
 * @param {string} topic - Tuya device id.
 * @param {number} now - Current epoch ms.
 * @returns {boolean} True while the cooldown is active.
 * @example
 * isLocalInCooldown(map, 'dev1', Date.now());
 */
export const isLocalInCooldown = (map, topic, now) => {
  const entry = map.get(topic);
  return Boolean(entry && entry.until > now);
};

/**
 * @description Remaining cooldown in ms for a device (0 when not parked).
 * @param {Map} map - The circuit state.
 * @param {string} topic - Tuya device id.
 * @param {number} now - Current epoch ms.
 * @returns {number} Remaining ms.
 * @example
 * localCooldownRemainingMs(map, 'dev1', Date.now());
 */
export const localCooldownRemainingMs = (map, topic, now) => {
  const entry = map.get(topic);
  return entry && entry.until > now ? entry.until - now : 0;
};

/**
 * @description Reset a device after a successful local poll.
 * @param {Map} map - The circuit state.
 * @param {string} topic - Tuya device id.
 * @returns {void}
 * @example
 * recordLocalSuccess(map, 'dev1');
 */
export const recordLocalSuccess = (map, topic) => {
  const entry = map.get(topic);
  if (entry) {
    entry.failures = 0;
    entry.until = 0;
  }
};

/**
 * @description Record a failed local poll and arm the cooldown once the
 * threshold is reached. Once armed, every further failure re-arms the cooldown
 * (so a persistently unreachable device is retried at most once per cooldown).
 * @param {Map} map - The circuit state.
 * @param {string} topic - Tuya device id.
 * @param {number} now - Current epoch ms.
 * @param {number} [threshold] - Consecutive failures before parking.
 * @param {number} [cooldownMs] - Park duration.
 * @returns {{tripped: boolean, cooldownMs: number}} `tripped` is true only on
 * the exact threshold crossing (log once); re-arms afterwards are silent.
 * @example
 * const { tripped, cooldownMs } = recordLocalFailure(map, 'dev1', Date.now());
 */
export const recordLocalFailure = (
  map,
  topic,
  now,
  threshold = LOCAL_FAILURE_THRESHOLD,
  cooldownMs = LOCAL_COOLDOWN_MS,
) => {
  const entry = getEntry(map, topic);
  entry.failures += 1;
  if (entry.failures >= threshold) {
    entry.until = now + cooldownMs;
    return { tripped: entry.failures === threshold, cooldownMs };
  }
  return { tripped: false, cooldownMs: 0 };
};

/**
 * @description Whether the "LAN info incomplete" notice should be logged now
 * (throttled to once per interval per device).
 * @param {Map} map - The circuit state.
 * @param {string} topic - Tuya device id.
 * @param {number} now - Current epoch ms.
 * @param {number} [intervalMs] - Minimum spacing between notices.
 * @returns {boolean} True when it is time to log again.
 * @example
 * if (shouldLogIncompleteLocal(map, 'dev1', Date.now())) logger.warn(...);
 */
export const shouldLogIncompleteLocal = (
  map,
  topic,
  now,
  intervalMs = INCOMPLETE_LOG_INTERVAL_MS,
) => {
  const entry = getEntry(map, topic);
  if (now - entry.lastIncompleteLog >= intervalMs) {
    entry.lastIncompleteLog = now;
    return true;
  }
  return false;
};
