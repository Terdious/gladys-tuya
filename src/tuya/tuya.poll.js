// Ported from server/services/tuya/lib/tuya.poll.js.
//
// Differences with the core service:
// - states are published to Gladys with `gladys.publishState` instead of the
//   core NEW_STATE event bus;
// - the last emitted value/timestamp comes from an in-memory cache on the
//   handler (the core read it from its stateManager), with the device
//   feature `last_value` / `last_value_changed` sent by Gladys as fallback.

import { createLogger, DEVICE_FEATURE_CATEGORIES } from '@gladysassistant/integration-sdk';

import { readValues } from './device/tuya.deviceMapping.js';
import {
  MEDIA_CODES,
  MEDIA_CODES_BY_DPS,
  extractMediaValuesFromDps,
  processMediaCodes,
} from './media/tuya.media.js';
import { API, DEVICE_PARAM_NAME } from './constants.js';
import { CLOUD_STRATEGY, getConfiguredCloudReadStrategy } from './cloud/tuya.cloudStrategy.js';
import { getTuyaDeviceId, getFeatureCode } from './utils/tuya.externalId.js';
import { getParamValue } from './utils/tuya.deviceParams.js';
import { getLocalDpsFromCode, hasDpsKey } from './device/tuya.localMapping.js';
import { getDeviceType, getFeatureMapping, getProductIdFromDevice } from './mappings/index.js';
import {
  isLocalInCooldown,
  localCooldownRemainingMs,
  recordLocalSuccess,
  recordLocalFailure,
  shouldLogIncompleteLocal,
  LOCAL_FAILURE_THRESHOLD,
} from './local/tuya.localCircuit.js';

const logger = createLogger({ name: 'tuya' });

export const SAME_VALUE_EMIT_INTERVAL_MS = 3 * 60 * 1000;

// During a cloud outage every device fails every cycle: keep one warn per
// device per window (the rest at debug) so 20 devices at a 10s cadence do not
// flood hundreds of stacktraces per minute into the logs.
const CLOUD_WARN_INTERVAL_MS = 5 * 60 * 1000;

const logCloudReadFailure = (self, topic, label, error) => {
  if (!self.cloudWarnAt) {
    self.cloudWarnAt = new Map();
  }
  const now = Date.now();
  const lastWarnAt = self.cloudWarnAt.get(topic) || 0;
  if (now - lastWarnAt >= CLOUD_WARN_INTERVAL_MS) {
    self.cloudWarnAt.set(topic, now);
    logger.warn(`[Tuya][poll][cloud] ${label} for device=${topic}`, error);
  } else {
    logger.debug(
      `[Tuya][poll][cloud] ${label} for device=${topic}: ${error && error.message ? error.message : error}`,
    );
  }
};

// Categories whose features are NOT read by the poll on purpose: they are
// fired by the media handler (doorbell ring, motion, snapshot) or are
// write-only controls (push buttons). A missing reader there is by design.
export const EVENT_DRIVEN_CATEGORIES = new Set([
  DEVICE_FEATURE_CATEGORIES.DOORBELL,
  DEVICE_FEATURE_CATEGORIES.MOTION_SENSOR,
  DEVICE_FEATURE_CATEGORIES.CAMERA,
  DEVICE_FEATURE_CATEGORIES.BUTTON,
]);

// Warned once per process per category/type: a feature with no reader was
// silently skipped on every poll (this is how the battery of the pet feeder
// and the dock of the vacuum stayed frozen after creation — see PR #40).
const warnedMissingReaders = new Set();

const getFeatureReader = (deviceFeature) => {
  if (!deviceFeature || !deviceFeature.category || !deviceFeature.type) {
    return null;
  }
  const categoryReaders = readValues[deviceFeature.category];
  const reader = categoryReaders ? categoryReaders[deviceFeature.type] : null;
  if (reader) {
    return reader;
  }
  const key = `${deviceFeature.category}/${deviceFeature.type}`;
  if (!warnedMissingReaders.has(key)) {
    warnedMissingReaders.add(key);
    if (EVENT_DRIVEN_CATEGORIES.has(deviceFeature.category)) {
      logger.debug(`[Tuya][poll] no reader for ${key} (event-driven feature, not polled)`);
    } else {
      logger.warn(
        `[Tuya][poll] no reader for ${key}: this feature is never updated by the poll (missing readValues entry)`,
      );
    }
  }
  return null;
};

// Resolve the (possibly product-variant) cloud-mapping entry of a feature
// code for this device.
export const resolveFeatureMappingEntry = (device, code) => {
  const deviceType = device && device.device_type ? device.device_type : getDeviceType(device);
  return getFeatureMapping(code, deviceType, getProductIdFromDevice(device));
};

/**
 * @description Gladys does not persist the feature `scale` (it only exists on
 * the discovery payload), so a feature read back from the created devices
 * loses it and a scaled value (e.g. an AC temperature stored as 230 for 23.0)
 * would be published raw. Restore the scale from the device-type cloud
 * mapping, as the core service does.
 * @param {object} device - The Gladys device (for the device type).
 * @param {object} deviceFeature - The feature as loaded from Gladys.
 * @param {string} code - Tuya feature code.
 * @returns {object} The feature, with its scale restored when known.
 * @example
 * const feature = getFeatureWithFallbackScale(device, deviceFeature, 'temp_set');
 */
export const getFeatureWithFallbackScale = (device, deviceFeature, code) => {
  if (!deviceFeature || deviceFeature.scale !== undefined) {
    return deviceFeature;
  }
  const mapping = resolveFeatureMappingEntry(device, code);
  if (!mapping || mapping.scale === undefined) {
    return deviceFeature;
  }
  return {
    ...deviceFeature,
    scale: mapping.scale,
  };
};

const getCurrentFeatureState = (self, deviceFeature) => {
  const externalId = deviceFeature && deviceFeature.external_id;
  if (externalId && self.featureStates.has(externalId)) {
    return self.featureStates.get(externalId);
  }
  return {
    lastValue: deviceFeature ? deviceFeature.last_value : undefined,
    lastValueChanged: deviceFeature ? deviceFeature.last_value_changed : undefined,
  };
};

const toTimestamp = (value) => {
  if (value === undefined || value === null) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  const timestamp = date.getTime();
  if (Number.isNaN(timestamp)) {
    return null;
  }
  return timestamp;
};

/**
 * @description Publish a feature state when it changed, or re-publish the same
 * value at most every SAME_VALUE_EMIT_INTERVAL_MS (same throttling as the
 * core service).
 * @param {object} self - The TuyaHandler instance.
 * @param {object} deviceFeature - The Gladys device feature.
 * @param {number} transformedValue - The value read from the device.
 * @param {number} previousValue - The last known value.
 * @param {string|Date} previousValueChangedAt - When the last value was emitted.
 * @returns {object} Emitted/changed flags.
 * @example
 * emitFeatureState(this, deviceFeature, 1, 0, undefined);
 */
const emitFeatureState = (
  self,
  pending,
  deviceFeature,
  transformedValue,
  previousValue,
  previousValueChangedAt,
) => {
  if (transformedValue === null || transformedValue === undefined) {
    return { emitted: false, changed: false };
  }
  // A device can emit a non-numeric value (empty string on a power code):
  // scaleValue then returns NaN, which `!==` always flags as changed — skip
  // the sample instead of publishing garbage every cycle.
  if (typeof transformedValue === 'number' && !Number.isFinite(transformedValue)) {
    logger.debug(
      `[Tuya][poll] skipping non-finite value for ${deviceFeature && deviceFeature.external_id}`,
    );
    return { emitted: false, changed: false };
  }

  const changed = previousValue !== transformedValue;
  let emitted = changed;

  if (!emitted) {
    const lastValueChangedTs = toTimestamp(previousValueChangedAt);
    const now = Date.now();
    if (lastValueChangedTs === null || now - lastValueChangedTs >= SAME_VALUE_EMIT_INTERVAL_MS) {
      emitted = true;
    }
  }

  if (emitted) {
    self.featureStates.set(deviceFeature.external_id, {
      lastValue: transformedValue,
      lastValueChanged: new Date(),
    });
    // The SDK's publishState only infers `state` (numeric) unless the value
    // is explicitly wrapped as `{ text }`: a TEXT-category feature (e.g.
    // TEXT/SELECT's raw device string, no int enum — see
    // src/devices/vacuum.js) is rejected by the core as "must have a numeric
    // state or a string text" if sent as a bare string.
    const publishValue =
      deviceFeature.category === DEVICE_FEATURE_CATEGORIES.TEXT
        ? { text: transformedValue }
        : transformedValue;
    pending.push(
      self.gladys.publishState(deviceFeature.external_id, publishValue).catch((e) => {
        logger.warn(`[Tuya][poll] failed to publish state for ${deviceFeature.external_id}`, e);
      }),
    );
  }

  return { emitted, changed };
};

// Effective transport of a device, as shown by the Gladys badge.
export const TRANSPORT = {
  LOCAL: 'local',
  CLOUD: 'cloud',
  UNREACHABLE: 'unreachable',
};

// Multi-language messages shown in the degraded-badge tooltip, keyed by the
// poll fallback reason (why a local-capable device ended up on the cloud).
const DEGRADED_MESSAGES = {
  local_cooldown: {
    en: 'Local unreachable: parked on the cloud after repeated failures. It will retry automatically.',
    fr: 'Local injoignable : basculé sur le cloud après des échecs répétés. Nouvelle tentative automatique.',
  },
  local_poll_failed: {
    en: 'Local session failed, falling back to the cloud.',
    fr: 'La session locale a échoué, repli sur le cloud.',
  },
  invalid_local_payload: {
    en: 'The device returned an invalid local response, falling back to the cloud.',
    fr: 'L’appareil a renvoyé une réponse locale invalide, repli sur le cloud.',
  },
  incomplete_local_config: {
    en: 'Local mode is on but this device has no usable LAN info — using the cloud. Set its IP with the "Detect local protocol" action.',
    fr: 'Le mode local est activé mais cet appareil n’a pas d’info réseau exploitable — cloud utilisé. Renseignez son IP via l’action « Détecter le protocole local ».',
  },
};
const DEGRADED_DEFAULT_MESSAGE = {
  en: 'Local mode is on but this device is running over the cloud.',
  fr: 'Le mode local est activé mais cet appareil fonctionne via le cloud.',
};

/**
 * @description Resolve the degraded-badge message for a cloud fallback reason.
 * @param {string} fallbackReason - The poll fallback reason.
 * @returns {object} A multi-language message.
 * @example
 * degradedMessageFor('local_cooldown');
 */
export const degradedMessageFor = (fallbackReason) => {
  const key = Object.keys(DEGRADED_MESSAGES).find((reason) =>
    String(fallbackReason || '').includes(reason),
  );
  return key ? DEGRADED_MESSAGES[key] : DEGRADED_DEFAULT_MESSAGE;
};

/**
 * @description Whether a device carries the full LAN info needed to be polled
 * locally (ip + local_key + protocol_version).
 * @param {object} device - The Gladys device.
 * @returns {boolean} True when the device is locally addressable.
 * @example
 * deviceHasLocalConfig(device);
 */
export const deviceHasLocalConfig = (device) => {
  const params = (device && device.params) || [];
  return Boolean(
    getParamValue(params, DEVICE_PARAM_NAME.IP_ADDRESS) &&
    getParamValue(params, DEVICE_PARAM_NAME.LOCAL_KEY) &&
    getParamValue(params, DEVICE_PARAM_NAME.PROTOCOL_VERSION),
  );
};

/**
 * @description Publish the effective transport of a device (Gladys renders it
 * as a badge on the device card). Only published on change (transport +
 * degraded flag), fire-and-forget: a badge failure must never break a poll
 * cycle. `degraded: true` adds an orange dot on the badge with `message` as
 * tooltip (SDK 0.9) — orthogonal to the transport; publishing without it
 * clears a previously degraded state.
 * @param {object} self - The TuyaHandler instance.
 * @param {object} device - The polled Gladys device.
 * @param {string} transport - TRANSPORT.LOCAL | CLOUD | UNREACHABLE.
 * @param {boolean} [degraded] - "Works, but not in the nominal mode".
 * @param {object} [message] - Multi-language tooltip (only used when degraded).
 * @returns {void}
 * @example
 * publishTransport(this, device, TRANSPORT.CLOUD, true, degradedMessageFor(reason));
 */
export const publishTransport = (self, device, transport, degraded = false, message = null) => {
  const externalId = device && device.external_id;
  if (!externalId || typeof self.gladys.publishTransports !== 'function') {
    return;
  }
  if (!self.lastTransports) {
    self.lastTransports = new Map();
  }
  const stateKey = `${transport}|${degraded ? 1 : 0}`;
  if (self.lastTransports.get(externalId) === stateKey) {
    return;
  }
  self.lastTransports.set(externalId, stateKey);
  const entry = { external_id: externalId, transport };
  if (degraded === true) {
    entry.degraded = true;
    if (message) {
      entry.message = message;
    }
  }
  self.gladys.publishTransports([entry]).catch((e) => {
    // Roll back so the next poll retries the publication.
    self.lastTransports.delete(externalId);
    logger.debug(`[Tuya][poll] failed to publish transport for ${externalId}: ${e.message}`);
  });
};

const extractValuesFromResultArray = (result) => {
  const values = {};
  const entries = Array.isArray(result) ? result : [];
  entries.forEach((feature) => {
    if (
      !feature ||
      typeof feature !== 'object' ||
      feature.code === undefined ||
      feature.code === null
    ) {
      return;
    }
    values[String(feature.code)] = feature.value;
  });
  return values;
};

const extractShadowValues = (response) => {
  const payload = response && response.result;
  const properties = payload && Array.isArray(payload.properties) ? payload.properties : [];
  return extractValuesFromResultArray(properties);
};

/**
 * @description Read the raw cloud values of a device for one read strategy
 * (legacy status endpoint or thing shadow properties).
 * @param {object} self - The TuyaHandler instance.
 * @param {string} strategy - CLOUD_STRATEGY.LEGACY or CLOUD_STRATEGY.SHADOW.
 * @param {string} topic - Tuya device id used for the API path.
 * @returns {Promise<object>} Map of code -> raw value.
 * @example
 * const values = await readCloudValues(self, CLOUD_STRATEGY.LEGACY, 'dev1');
 */
export async function readCloudValues(self, strategy, topic) {
  if (strategy === CLOUD_STRATEGY.SHADOW) {
    const response = await self.connector.request({
      method: 'GET',
      path: `${API.VERSION_2_0}/thing/${topic}/shadow/properties`,
    });
    return extractShadowValues(response);
  }
  const response = await self.connector.request({
    method: 'GET',
    path: `${API.VERSION_1_0}/devices/${topic}/status`,
  });
  return extractValuesFromResultArray(response && response.result);
}

/**
 * @description Whether any of the requested feature codes is present in the
 * values read from the cloud.
 * @param {object} values - Map of code -> raw value read from the cloud.
 * @param {Array<string>} requestedCodes - Feature codes we expect to read.
 * @returns {boolean} True when at least one code is present.
 * @example
 * const ok = hasAnyRequestedCode({ switch: true }, ['switch']);
 */
const hasAnyRequestedCode = (values, requestedCodes) =>
  requestedCodes.some((code) => values[code] !== undefined);

/**
 * @description Poll the given features against the Tuya cloud API and emit state changes.
 * @param {object} self - The TuyaHandler instance (passed explicitly to avoid `this` rebinding).
 * @param {object} device - The Gladys device (used to resolve the cloud read strategy).
 * @param {Array} deviceFeatures - Features to poll.
 * @param {string} topic - Tuya device id used for the API path and logs.
 * @returns {Promise<object>} Summary with polled/handled/changed/missing/skipped counters.
 * @example
 * const summary = await pollCloudFeatures(this, device, deviceFeatures, topic);
 */
export async function pollCloudFeatures(self, device, deviceFeatures, topic, pending = []) {
  const summary = {
    polled: Array.isArray(deviceFeatures) ? deviceFeatures.length : 0,
    handled: 0,
    changed: 0,
    missing: 0,
    skipped: 0,
    strategy: null,
    // False when the cloud API itself could not be read (transport badge).
    reachable: true,
  };
  if (!Array.isArray(deviceFeatures) || deviceFeatures.length === 0) {
    return summary;
  }

  if (!self.connector || typeof self.connector.request !== 'function') {
    logger.warn(`[Tuya][poll][cloud] connector unavailable for device=${topic}`);
    summary.reachable = false;
    return summary;
  }

  // The read strategy (legacy vs shadow) is resolved once at discovery time
  // from the device specifications. When those specifications are incomplete,
  // the wrong endpoint can be stored, and the configured endpoint then returns
  // none of the device codes on every poll (state feedback silently broken).
  // Read with the configured strategy first, and when it returns none of the
  // requested codes, retry once with the alternate endpoint before giving up.
  const primaryStrategy = getConfiguredCloudReadStrategy(device);
  const alternateStrategy =
    primaryStrategy === CLOUD_STRATEGY.SHADOW ? CLOUD_STRATEGY.LEGACY : CLOUD_STRATEGY.SHADOW;
  const requestedCodes = deviceFeatures.map((feature) => getFeatureCode(feature)).filter(Boolean);

  let strategyUsed = primaryStrategy;
  let values;
  let anyReadOk = false;
  try {
    values = await readCloudValues(self, primaryStrategy, topic);
    anyReadOk = true;
  } catch (e) {
    logCloudReadFailure(self, topic, `read failed strategy=${primaryStrategy}`, e);
    values = {};
  }

  if (requestedCodes.length > 0 && !hasAnyRequestedCode(values, requestedCodes)) {
    try {
      const alternateValues = await readCloudValues(self, alternateStrategy, topic);
      anyReadOk = true;
      if (hasAnyRequestedCode(alternateValues, requestedCodes)) {
        values = alternateValues;
        strategyUsed = alternateStrategy;
        logger.info(
          `[Tuya][poll][cloud] device=${topic} switched read strategy ${primaryStrategy} -> ${alternateStrategy} (configured endpoint returned no known code)`,
        );
      }
    } catch (e) {
      logCloudReadFailure(self, topic, `alternate read failed strategy=${alternateStrategy}`, e);
    }
  }
  summary.strategy = strategyUsed;
  summary.reachable = anyReadOk;

  // Same diagnostic as the local DPS snapshot, for the cloud: what the device
  // really reports, code by code, with the codes no feature consumes flagged.
  logCloudStatusSnapshot(self, device, topic, values);

  // Doorbell/camera snapshot + ring: handled out of the normal read pipeline
  // (a camera/button feature has no reader), gated on a genuinely new image.
  processMediaCodes(self, device, values);

  deviceFeatures.forEach((deviceFeature) => {
    const code = getFeatureCode(deviceFeature);
    if (!code) {
      summary.skipped += 1;
      return;
    }

    const reader = getFeatureReader(deviceFeature);
    if (!reader) {
      summary.skipped += 1;
      return;
    }

    const value = values[code];
    if (value === undefined) {
      summary.missing += 1;
      return;
    }
    const featureWithScale = getFeatureWithFallbackScale(device, deviceFeature, code);
    // The mapping entry gives the reader per-variant metadata (e.g. the
    // tuyaEnum pilot-wire vocabulary).
    const mappingEntry = resolveFeatureMappingEntry(device, code);
    let transformedValue;
    try {
      transformedValue = reader(value, featureWithScale, mappingEntry);
    } catch (e) {
      summary.skipped += 1;
      logger.warn(`[Tuya][poll][cloud] reader failed for device=${topic} code=${code}`, e);
      return;
    }
    const { lastValue, lastValueChanged } = getCurrentFeatureState(self, featureWithScale);
    const { changed } = emitFeatureState(
      self,
      pending,
      featureWithScale,
      transformedValue,
      lastValue,
      lastValueChanged,
    );
    if (changed) {
      summary.changed += 1;
    }
    summary.handled += 1;
  });

  return summary;
}

/**
 * @description Map a local DPS payload onto the device features and publish
 * the changed states. Shared by the poll local branch and the persistent
 * session push path (tuya.localSession.js).
 * @param {object} self - The TuyaHandler instance.
 * @param {object} device - The Gladys device (features + params).
 * @param {object} dps - DPS map (may be partial, e.g. a push).
 * @param {Array} pending - Sink for the in-flight publishState promises.
 * @returns {object} { localHandled, localChanged, pendingCloudFeatures }.
 * @example
 * const result = emitLocalDpsStates(handler, device, { 1: true }, pending);
 */
// A media DP carries a base64 payload of several KB: never log it whole.
const MAX_DPS_VALUE_LOG_LENGTH = 48;

const formatDpsValueForLog = (value) => {
  if (typeof value === 'string') {
    return value.length > MAX_DPS_VALUE_LOG_LENGTH
      ? `"${value.slice(0, MAX_DPS_VALUE_LOG_LENGTH)}…"(${value.length} chars)`
      : `"${value}"`;
  }
  return String(value);
};

/**
 * @description Return the local DPS index of every feature of a device, keyed
 * by DPS index (as a string) -> Tuya code.
 * @param {object} device - The Gladys device.
 * @returns {Map} The resolved DPS indexes.
 * @example
 * const mapped = getMappedLocalDps(device);
 */
const getMappedLocalDps = (device) => {
  const mapped = new Map();
  (Array.isArray(device.features) ? device.features : []).forEach((feature) => {
    const code = getFeatureCode(feature);
    const dpsKey = code ? getLocalDpsFromCode(code, device) : null;
    if (dpsKey !== null && dpsKey !== undefined) {
      mapped.set(String(dpsKey), code);
    }
  });
  return mapped;
};

/**
 * @description Describe a raw DPS map, one entry per key, annotated with the
 * Tuya code each DPS is mapped to (or UNMAPPED). This is how a device type
 * gets its LAN mapping: the indexes are model-specific and only the device
 * can tell them. Used by the poll-time snapshot log below.
 * @param {object} device - The Gladys device.
 * @param {object} dps - The raw DPS map from a local read.
 * @returns {Array<string>} One "key=value (code|UNMAPPED)" entry per DPS key.
 * @example
 * describeDpsSnapshot(device, { 1: true, 3: 2 });
 */
export const describeDpsSnapshot = (device, dps) => {
  if (!dps || typeof dps !== 'object') {
    return [];
  }
  const mapped = getMappedLocalDps(device);
  return Object.keys(dps).map((key) => {
    const code = mapped.get(String(key)) || MEDIA_CODES_BY_DPS[key];
    return `${key}=${formatDpsValueForLog(dps[key])} (${code || 'UNMAPPED'})`;
  });
};

/**
 * @description Log the raw DPS map returned by a local read, annotated with the
 * Tuya code each DPS is mapped to (or UNMAPPED). Logged once per device and
 * re-logged whenever the DPS key set changes, so it never floods a poll loop.
 * @param {object} self - The TuyaHandler instance.
 * @param {object} device - The Gladys device.
 * @param {string} topic - The Tuya device id.
 * @param {object} dps - The raw DPS map from the local read.
 * @returns {void}
 * @example
 * logLocalDpsSnapshot(handler, device, 'bf15...', { 1: true, 3: 2 });
 */
export const logLocalDpsSnapshot = (self, device, topic, dps) => {
  if (!dps || typeof dps !== 'object') {
    return;
  }
  const keys = Object.keys(dps);
  if (keys.length === 0) {
    return;
  }
  self.loggedLocalDpsSignature = self.loggedLocalDpsSignature || {};
  const signature = keys.slice().sort().join(',');
  if (self.loggedLocalDpsSignature[topic] === signature) {
    return;
  }
  self.loggedLocalDpsSignature[topic] = signature;

  const described = describeDpsSnapshot(device, dps);
  logger.info(`[Tuya][poll][local] device=${topic} DPS snapshot: ${described.join(' | ')}`);
};

/**
 * @description Annotate each code of a cloud status read with whether a feature
 * of the device consumes it (the value shape of an UNMAPPED code is what a
 * mapping for a new model needs — e.g. the pet feeder variants exposing
 * feed_record / battery_val instead of feed_report / battery_percentage).
 * Media codes (snapshot payloads) are left out: their value is a URL/JSON blob.
 * @param {object} device - The Gladys device.
 * @param {object} values - The code -> value map of the cloud read.
 * @returns {Array<string>} One "code=value (mapped|UNMAPPED)" entry per code.
 * @example
 * describeCloudStatusSnapshot(device, { switch: true, feed_record: '{"value":2}' });
 */
export const describeCloudStatusSnapshot = (device, values) => {
  if (!values || typeof values !== 'object') {
    return [];
  }
  const featureCodes = new Set(
    (Array.isArray(device.features) ? device.features : [])
      .map((feature) => getFeatureCode(feature))
      .filter(Boolean),
  );
  return Object.keys(values)
    .filter((code) => !MEDIA_CODES.includes(code))
    .map(
      (code) =>
        `${code}=${formatDpsValueForLog(values[code])} (${
          featureCodes.has(code) ? 'mapped' : 'UNMAPPED'
        })`,
    );
};

/**
 * @description Log the cloud status of a device annotated per code, once per
 * device and again whenever the code set changes (never floods the poll loop).
 * @param {object} self - The TuyaHandler instance.
 * @param {object} device - The Gladys device.
 * @param {string} topic - The Tuya device id.
 * @param {object} values - The code -> value map of the cloud read.
 * @returns {void}
 * @example
 * logCloudStatusSnapshot(handler, device, 'bf15...', { switch: true });
 */
export const logCloudStatusSnapshot = (self, device, topic, values) => {
  if (!values || typeof values !== 'object') {
    return;
  }
  const keys = Object.keys(values);
  if (keys.length === 0) {
    return;
  }
  self.loggedCloudStatusSignature = self.loggedCloudStatusSignature || {};
  const signature = keys.slice().sort().join(',');
  if (self.loggedCloudStatusSignature[topic] === signature) {
    return;
  }
  self.loggedCloudStatusSignature[topic] = signature;
  const described = describeCloudStatusSnapshot(device, values);
  if (described.length > 0) {
    logger.info(`[Tuya][poll][cloud] device=${topic} status snapshot: ${described.join(' | ')}`);
  }
};

export function emitLocalDpsStates(self, device, dps, pending) {
  const deviceFeatures = Array.isArray(device.features) ? device.features : [];
  const pendingCloudFeatures = [];
  let localHandled = 0;
  let localChanged = 0;

  // Doorbell/camera media DPs (115/154) are handled out of the normal DPS
  // pipeline (a camera/button feature has no reader), gated on a new image.
  processMediaCodes(self, device, extractMediaValuesFromDps(dps));

  deviceFeatures.forEach((deviceFeature) => {
    const code = getFeatureCode(deviceFeature);
    const dpsKey = getLocalDpsFromCode(code, device);
    const reader = getFeatureReader(deviceFeature);

    if (!code || dpsKey === null || !reader || !hasDpsKey(dps, dpsKey)) {
      pendingCloudFeatures.push(deviceFeature);
      return;
    }

    const rawValue = Object.prototype.hasOwnProperty.call(dps, String(dpsKey))
      ? dps[String(dpsKey)]
      : dps[dpsKey];
    if (rawValue === undefined) {
      pendingCloudFeatures.push(deviceFeature);
      return;
    }
    const featureWithScale = getFeatureWithFallbackScale(device, deviceFeature, code);
    const mappingEntry = resolveFeatureMappingEntry(device, code);
    let transformedValue;
    try {
      transformedValue = reader(rawValue, featureWithScale, mappingEntry);
    } catch (e) {
      pendingCloudFeatures.push(deviceFeature);
      logger.warn(
        `[Tuya][poll] local reader failed for device feature ${deviceFeature.external_id}; falling back to cloud`,
        e,
      );
      return;
    }
    const { lastValue, lastValueChanged } = getCurrentFeatureState(self, featureWithScale);
    const { changed } = emitFeatureState(
      self,
      pending,
      featureWithScale,
      transformedValue,
      lastValue,
      lastValueChanged,
    );
    if (changed) {
      localChanged += 1;
    }
    localHandled += 1;
  });

  return { localHandled, localChanged, pendingCloudFeatures };
}

/**
 * @description Apply cloud CODE values (keyed by Tuya code, not DPS) to a
 * device's features and emit their new states. Used by the Pulsar real-time
 * reports (#10) with the exact reader/scale/event pipeline of the cloud poll,
 * without the poll summaries — so a value pushed by Pulsar and the same value
 * seen by the next poll share one state cache and never double-emit.
 * @param {object} self - The TuyaHandler instance.
 * @param {object} device - The Gladys device (features + params).
 * @param {object} values - Reported values keyed by Tuya code.
 * @param {Array} [pending] - Sink for the in-flight publishState promises.
 * @returns {object} { handled, changed } summary.
 * @example
 * const { changed } = emitCloudCodeStates(handler, device, { switch_1: true }, pending);
 */
export function emitCloudCodeStates(self, device, values, pending = []) {
  let handled = 0;
  let changed = 0;
  if (!device || !values || typeof values !== 'object') {
    return { handled, changed };
  }
  const deviceFeatures = Array.isArray(device.features) ? device.features : [];
  deviceFeatures.forEach((deviceFeature) => {
    const code = getFeatureCode(deviceFeature);
    if (
      !code ||
      !Object.prototype.hasOwnProperty.call(values, code) ||
      values[code] === undefined
    ) {
      return;
    }
    const reader = getFeatureReader(deviceFeature);
    if (!reader) {
      return;
    }
    const featureWithScale = getFeatureWithFallbackScale(device, deviceFeature, code);
    const mappingEntry = resolveFeatureMappingEntry(device, code);
    let transformedValue;
    try {
      transformedValue = reader(values[code], featureWithScale, mappingEntry);
    } catch (e) {
      logger.warn(`[Tuya][pulsar] reader failed for code=${code}`, e);
      return;
    }
    const { lastValue, lastValueChanged } = getCurrentFeatureState(self, featureWithScale);
    const emitResult = emitFeatureState(
      self,
      pending,
      featureWithScale,
      transformedValue,
      lastValue,
      lastValueChanged,
    );
    handled += 1;
    if (emitResult.changed) {
      changed += 1;
    }
  });
  return { handled, changed };
}

/**
 * @description Poll values of a Tuya device (local mode first when the device
 * opted in through LOCAL_OVERRIDE, with cloud fallback).
 * @param {object} device - The device to poll.
 * @returns {Promise} Promise of nothing.
 * @example
 * await handler.poll(device);
 */
export async function poll(device) {
  const topic = getTuyaDeviceId(device);

  // One poll at a time per device: a slow failing cycle (local timeouts) must
  // not overlap the next one — two concurrent get() calls interleave on the
  // single session socket and each overlapped failure double-counts on the
  // circuit breaker.
  if (!this.pollsInFlight) {
    this.pollsInFlight = new Set();
  }
  if (this.pollsInFlight.has(topic)) {
    logger.debug(`[Tuya][poll] device=${topic} previous poll still running, skipping this cycle`);
    return;
  }
  this.pollsInFlight.add(topic);
  try {
    await pollDevice.call(this, device, topic);
  } finally {
    this.pollsInFlight.delete(topic);
  }
}

async function pollDevice(device, topic) {
  const deviceFeatures = Array.isArray(device.features) ? device.features : [];

  // A device with no feature has nothing to publish: polling it would open a
  // LAN session (and burn a cloud call) every cycle for nothing. This happens
  // on a device type that is not mapped yet — the user still created it from
  // the Discovery screen.
  if (deviceFeatures.length === 0) {
    logger.debug(`[Tuya][poll] device=${topic} has no feature, nothing to poll`);
    return;
  }

  const params = device.params || [];
  const ipAddress = getParamValue(params, DEVICE_PARAM_NAME.IP_ADDRESS);
  const localKey = getParamValue(params, DEVICE_PARAM_NAME.LOCAL_KEY);
  const protocolVersionRaw = getParamValue(params, DEVICE_PARAM_NAME.PROTOCOL_VERSION);
  const protocolVersion =
    protocolVersionRaw !== null && protocolVersionRaw !== undefined
      ? String(protocolVersionRaw).trim()
      : undefined;
  // Live decision (point 3): the "Mode local (LAN)" toggle is a GLOBAL, live
  // preference read at poll time from the current config — NOT a per-device
  // flag frozen at discovery. A device is polled locally when the toggle is on
  // AND it is locally reachable (ip + local_key + protocol known); otherwise
  // (toggle off, or no LAN info) it is polled over the cloud. The stored
  // LOCAL_OVERRIDE param is no longer read here; it only drives the discovery
  // poll frequency.
  const hasLocalCapability = Boolean(ipAddress && localKey && protocolVersion);
  const localModeEnabled = Boolean(this.config && this.config.localMode === true);
  // A device type with no LAN mapping (or none matching its features) can only
  // be read over the cloud: opening a local session every cycle would time out
  // for nothing before the existing cloud fallback kicks in. One local read is
  // still attempted (until the DPS snapshot below is captured) because that
  // snapshot is the only way to learn the model-specific DPS indexes such a
  // device type is missing.
  const hasMappableLocalDps = deviceFeatures.some((feature) => {
    const featureCode = getFeatureCode(feature);
    return featureCode ? getLocalDpsFromCode(featureCode, device) !== null : false;
  });
  const localSnapshotCaptured = Boolean(
    this.loggedLocalDpsSignature && this.loggedLocalDpsSignature[topic],
  );
  const skipLocalMapping = !hasMappableLocalDps && localSnapshotCaptured;
  const useLocal = localModeEnabled && hasLocalCapability && !skipLocalMapping;
  if (localModeEnabled && hasLocalCapability && skipLocalMapping) {
    logger.debug(
      `[Tuya][poll] device=${topic} has no local DPS mapping for its features -> cloud only`,
    );
  }
  const requestedMode = localModeEnabled ? 'local' : 'cloud';
  logger.debug(
    `[Tuya][poll] device=${topic} requested=${requestedMode} has_local=${useLocal} local_mode=${localModeEnabled} protocol=${protocolVersion || 'none'} ip=${ipAddress || 'none'}`,
  );

  // Per-call sink for the in-flight publishState promises: a push received on
  // a persistent session must never interleave with a running poll cycle.
  const pending = [];
  let modeUsed = 'cloud';
  let localHandled = 0;
  let localChanged = 0;
  let cloudSummary = {
    polled: 0,
    handled: 0,
    changed: 0,
    missing: 0,
    skipped: 0,
  };
  let fallbackReason = 'none';
  const finish = async () => {
    await Promise.all(pending);
    pending.length = 0;
  };

  if (!this.localCircuit) {
    this.localCircuit = new Map();
  }

  if (localModeEnabled && !hasLocalCapability && (ipAddress || localKey || protocolVersion)) {
    fallbackReason = 'incomplete_local_config';
    // Stable condition (device not seen on the LAN): warn once, then stay quiet
    // and use the cloud. It recovers on its own once the IP is provided.
    if (shouldLogIncompleteLocal(this.localCircuit, topic, Date.now())) {
      logger.warn(
        `[Tuya][poll] local mode on but LAN info incomplete for device=${topic} (ip/protocol/local_key missing) — using cloud; set the IP to enable local`,
      );
    }
  }

  // Circuit breaker: after repeated local failures, a device is parked on the
  // cloud for a cooldown instead of wasting a 3s local timeout every cycle.
  const localParked = useLocal && isLocalInCooldown(this.localCircuit, topic, Date.now());
  if (localParked) {
    fallbackReason = 'local_cooldown';
    logger.debug(
      `[Tuya][poll] device=${topic} local parked (${Math.round(
        localCooldownRemainingMs(this.localCircuit, topic, Date.now()) / 1000,
      )}s left) -> cloud`,
    );
  }

  // Leaving the local path (toggle off or parked by the breaker): release the
  // device's single local slot so nothing holds a stale socket.
  if ((!useLocal || localParked) && this.localSessions && this.localSessions.has(topic)) {
    this.closeLocalSession(topic).catch(() => {});
  }

  if (useLocal && !localParked) {
    try {
      // Persistent-session read (issue #9): fresh push cache when available,
      // otherwise an active read over the live socket — no per-poll handshake.
      const localResult = await this.localRead({
        deviceId: topic,
        ip: ipAddress,
        localKey,
        protocolVersion,
      });

      const dps = localResult && localResult.dps ? localResult.dps : null;
      if (dps && typeof dps === 'object') {
        // Local read succeeded: clear any accumulated failures / cooldown.
        recordLocalSuccess(this.localCircuit, topic);
        // Trace what the device really exposes on the LAN: this is the only
        // source of truth for the (model-specific) DPS indexes of a device type
        // whose LAN mapping is still incomplete.
        logLocalDpsSnapshot(this, device, topic, dps);
        const localResultStates = emitLocalDpsStates(this, device, dps, pending);
        localHandled = localResultStates.localHandled;
        localChanged = localResultStates.localChanged;
        const { pendingCloudFeatures } = localResultStates;

        if (pendingCloudFeatures.length === 0) {
          modeUsed = 'local';
          publishTransport(this, device, TRANSPORT.LOCAL);
          await finish();
          logger.debug(
            `[Tuya][poll] device=${topic} mode=${modeUsed} local_handled=${localHandled} local_changed=${localChanged} cloud_handled=0 cloud_changed=0 cloud_missing=0 fallback=${fallbackReason}`,
          );
          return;
        }

        fallbackReason = 'partial_local_mapping';
        try {
          cloudSummary = await pollCloudFeatures(
            this,
            device,
            pendingCloudFeatures,
            topic,
            pending,
          );
        } catch (e) {
          logger.warn(
            `[Tuya][poll] local poll succeeded but cloud fallback failed for ${topic}`,
            e,
          );
          fallbackReason = 'cloud_fallback_failed';
        }
        modeUsed = 'local+cloud';
        // The LAN link answered: the device counts as local even when some
        // features complete over the cloud.
        publishTransport(this, device, TRANSPORT.LOCAL);
        await finish();
        logger.debug(
          `[Tuya][poll] device=${topic} mode=${modeUsed} local_handled=${localHandled} local_changed=${localChanged} cloud_handled=${cloudSummary.handled} cloud_changed=${cloudSummary.changed} cloud_missing=${cloudSummary.missing} fallback=${fallbackReason}`,
        );
        return;
      }

      fallbackReason = 'invalid_local_payload';
      {
        const { tripped, cooldownMs } = recordLocalFailure(this.localCircuit, topic, Date.now());
        if (tripped) {
          if (this.closeLocalSession) {
            this.closeLocalSession(topic).catch(() => {});
          }
          logger.info(
            `[Tuya][poll] device=${topic} local parked ${Math.round(
              cooldownMs / 1000,
            )}s after ${LOCAL_FAILURE_THRESHOLD} failures (invalid payload) -> cloud`,
          );
        } else {
          logger.debug(
            `[Tuya][poll] local poll returned invalid DPS payload for ${topic}, falling back to cloud`,
          );
        }
      }
    } catch (e) {
      fallbackReason = 'local_poll_failed';
      const { tripped, cooldownMs } = recordLocalFailure(this.localCircuit, topic, Date.now());
      if (tripped) {
        // Parked: also release the local slot so nothing keeps a dead socket.
        if (this.closeLocalSession) {
          this.closeLocalSession(topic).catch(() => {});
        }
        logger.info(
          `[Tuya][poll] device=${topic} local parked ${Math.round(
            cooldownMs / 1000,
          )}s after ${LOCAL_FAILURE_THRESHOLD} failures (${e.message}) -> cloud`,
        );
      } else {
        logger.debug(
          `[Tuya][poll] local poll failed for ${topic}, falling back to cloud: ${e.message}`,
        );
      }
    }
  }

  // When the device explicitly opted into local mode and the cloud connector
  // is missing, skip the cloud fallback to avoid flooding the logs with a
  // `connector unavailable` warning on every poll cycle. The cloud-direct
  // path (LOCAL_OVERRIDE=false) still goes through pollCloudFeatures, which
  // surfaces the warn so a missing connector is visible.
  if (useLocal && (!this.connector || typeof this.connector.request !== 'function')) {
    fallbackReason =
      fallbackReason === 'none' ? 'cloud_unavailable' : `${fallbackReason}+cloud_unavailable`;
    // The LAN did not answer and there is no cloud either.
    publishTransport(this, device, TRANSPORT.UNREACHABLE);
    await finish();
    logger.debug(
      `[Tuya][poll] device=${topic} mode=${modeUsed} local_handled=${localHandled} local_changed=${localChanged} cloud_handled=0 cloud_changed=0 cloud_missing=0 fallback=${fallbackReason}`,
    );
    return;
  }

  try {
    cloudSummary = await pollCloudFeatures(this, device, deviceFeatures, topic, pending);
  } catch (e) {
    logger.warn(`[Tuya][poll] cloud poll failed for ${topic}`, e);
    fallbackReason =
      fallbackReason === 'none' ? 'cloud_poll_failed' : `${fallbackReason}+cloud_poll_failed`;
  }
  // Badge: the cloud answered (even codes-missing counts as reachable) ->
  // cloud; the cloud API itself could not be read -> unreachable. Exception:
  // when the device's persistent session pushed recently, the states ARE
  // flowing over the LAN — keep the Local badge instead of flapping to Cloud
  // because one active read failed.
  const session = this.localSessions && this.localSessions.get(topic);
  const hasFreshLocalPush = Boolean(
    session && session.lastDpsAt && Date.now() - session.lastDpsAt < 60 * 1000,
  );
  let transport = TRANSPORT.CLOUD;
  if (hasFreshLocalPush) {
    transport = TRANSPORT.LOCAL;
  } else if (fallbackReason.includes('cloud_poll_failed') || cloudSummary.reachable === false) {
    transport = TRANSPORT.UNREACHABLE;
  }
  // Degraded (issue #15): the device COULD run locally (LAN info known and the
  // "prefer local" toggle on) but ended up on the cloud — the badge stays blue
  // with an orange dot and a tooltip explaining why. A genuine cloud-only
  // device (no LAN info) or a user who turned the local preference off are
  // nominal, not degraded. Unreachable is already its own alarming state.
  let degraded = false;
  let degradedMessage = null;
  if (transport === TRANSPORT.CLOUD && localModeEnabled) {
    if (hasLocalCapability) {
      degraded = true;
      degradedMessage = degradedMessageFor(fallbackReason);
    } else if (fallbackReason === 'incomplete_local_config') {
      degraded = true;
      degradedMessage = degradedMessageFor(fallbackReason);
    }
  }
  publishTransport(this, device, transport, degraded, degradedMessage);
  await finish();
  const summaryLine = `[Tuya][poll] device=${topic} requested=${requestedMode} has_local=${useLocal} mode=${modeUsed} strategy=${
    cloudSummary.strategy || 'n/a'
  } features=${deviceFeatures.length} local_handled=${localHandled} local_changed=${localChanged} cloud_handled=${cloudSummary.handled} cloud_changed=${cloudSummary.changed} cloud_missing=${cloudSummary.missing} fallback=${fallbackReason}`;
  // Surface a poll that actually published states at info level so the local
  // vs cloud path and state feedback are visible without LOG_LEVEL=debug. Also
  // surface a device that returns none of its codes ("online but silent"):
  // state feedback is broken for it. Steady unchanged polls stay at debug.
  const cloudBlind = modeUsed === 'cloud' && cloudSummary.handled === 0 && cloudSummary.missing > 0;
  if (localChanged > 0 || cloudSummary.changed > 0 || cloudBlind) {
    logger.info(summaryLine);
  } else {
    logger.debug(summaryLine);
  }
}
