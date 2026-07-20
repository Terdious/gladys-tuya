// Ported from server/services/tuya/lib/tuya.poll.js.
//
// Differences with the core service:
// - states are published to Gladys with `gladys.publishState` instead of the
//   core NEW_STATE event bus;
// - the last emitted value/timestamp comes from an in-memory cache on the
//   handler (the core read it from its stateManager), with the device
//   feature `last_value` / `last_value_changed` sent by Gladys as fallback.

import { createLogger } from '@gladysassistant/integration-sdk';

import { readValues } from './device/tuya.deviceMapping.js';
import { API, DEVICE_PARAM_NAME } from './constants.js';
import { CLOUD_STRATEGY, getConfiguredCloudReadStrategy } from './cloud/tuya.cloudStrategy.js';
import { getTuyaDeviceId, getFeatureCode } from './utils/tuya.externalId.js';
import { getParamValue } from './utils/tuya.deviceParams.js';
import { getLocalDpsFromCode, hasDpsKey } from './device/tuya.localMapping.js';

const logger = createLogger({ name: 'tuya' });

export const SAME_VALUE_EMIT_INTERVAL_MS = 3 * 60 * 1000;

const getFeatureReader = (deviceFeature) => {
  if (!deviceFeature || !deviceFeature.category || !deviceFeature.type) {
    return null;
  }
  const categoryReaders = readValues[deviceFeature.category];
  if (!categoryReaders) {
    return null;
  }
  return categoryReaders[deviceFeature.type] || null;
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
  deviceFeature,
  transformedValue,
  previousValue,
  previousValueChangedAt,
) => {
  if (transformedValue === null || transformedValue === undefined) {
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
    self.pendingStates.push(
      self.gladys.publishState(deviceFeature.external_id, transformedValue).catch((e) => {
        logger.warn(`[Tuya][poll] failed to publish state for ${deviceFeature.external_id}`, e);
      }),
    );
  }

  return { emitted, changed };
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
async function readCloudValues(self, strategy, topic) {
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
export async function pollCloudFeatures(self, device, deviceFeatures, topic) {
  const summary = {
    polled: Array.isArray(deviceFeatures) ? deviceFeatures.length : 0,
    handled: 0,
    changed: 0,
    missing: 0,
    skipped: 0,
    strategy: null,
  };
  if (!Array.isArray(deviceFeatures) || deviceFeatures.length === 0) {
    return summary;
  }

  if (!self.connector || typeof self.connector.request !== 'function') {
    logger.warn(`[Tuya][poll][cloud] connector unavailable for device=${topic}`);
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
  try {
    values = await readCloudValues(self, primaryStrategy, topic);
  } catch (e) {
    logger.warn(
      `[Tuya][poll][cloud] read failed for device=${topic} strategy=${primaryStrategy}`,
      e,
    );
    values = {};
  }

  if (requestedCodes.length > 0 && !hasAnyRequestedCode(values, requestedCodes)) {
    try {
      const alternateValues = await readCloudValues(self, alternateStrategy, topic);
      if (hasAnyRequestedCode(alternateValues, requestedCodes)) {
        values = alternateValues;
        strategyUsed = alternateStrategy;
        logger.info(
          `[Tuya][poll][cloud] device=${topic} switched read strategy ${primaryStrategy} -> ${alternateStrategy} (configured endpoint returned no known code)`,
        );
      }
    } catch (e) {
      logger.warn(
        `[Tuya][poll][cloud] alternate read failed for device=${topic} strategy=${alternateStrategy}`,
        e,
      );
    }
  }
  summary.strategy = strategyUsed;

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
    let transformedValue;
    try {
      transformedValue = reader(value, deviceFeature);
    } catch (e) {
      summary.skipped += 1;
      logger.warn(`[Tuya][poll][cloud] reader failed for device=${topic} code=${code}`, e);
      return;
    }
    const { lastValue, lastValueChanged } = getCurrentFeatureState(self, deviceFeature);
    const { changed } = emitFeatureState(
      self,
      deviceFeature,
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
 * @description Poll values of a Tuya device (local mode first when the device
 * opted in through LOCAL_OVERRIDE, with cloud fallback).
 * @param {object} device - The device to poll.
 * @returns {Promise} Promise of nothing.
 * @example
 * await handler.poll(device);
 */
export async function poll(device) {
  const topic = getTuyaDeviceId(device);
  const deviceFeatures = Array.isArray(device.features) ? device.features : [];

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
  const useLocal = localModeEnabled && hasLocalCapability;
  const requestedMode = localModeEnabled ? 'local' : 'cloud';
  logger.debug(
    `[Tuya][poll] device=${topic} requested=${requestedMode} has_local=${useLocal} local_mode=${localModeEnabled} protocol=${protocolVersion || 'none'} ip=${ipAddress || 'none'}`,
  );

  this.pendingStates = [];
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
    await Promise.all(this.pendingStates);
    this.pendingStates = [];
  };

  if (localModeEnabled && !hasLocalCapability && (ipAddress || localKey || protocolVersion)) {
    fallbackReason = 'incomplete_local_config';
    logger.warn(
      `[Tuya][poll] local mode enabled but LAN info is incomplete for device=${topic} (ip/protocol/local_key missing)`,
    );
  }

  if (useLocal) {
    try {
      const localResult = await this.localPoll({
        deviceId: topic,
        ip: ipAddress,
        localKey,
        protocolVersion,
        timeoutMs: 3000,
        fastScan: true,
        logDps: false,
      });

      const dps = localResult && localResult.dps ? localResult.dps : null;
      if (dps && typeof dps === 'object') {
        const pendingCloudFeatures = [];

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
          let transformedValue;
          try {
            transformedValue = reader(rawValue, deviceFeature);
          } catch (e) {
            pendingCloudFeatures.push(deviceFeature);
            logger.warn(
              `[Tuya][poll] local reader failed for device=${topic} code=${code}; falling back to cloud`,
              e,
            );
            return;
          }
          const { lastValue, lastValueChanged } = getCurrentFeatureState(this, deviceFeature);
          const { changed } = emitFeatureState(
            this,
            deviceFeature,
            transformedValue,
            lastValue,
            lastValueChanged,
          );
          if (changed) {
            localChanged += 1;
          }
          localHandled += 1;
        });

        if (pendingCloudFeatures.length === 0) {
          modeUsed = 'local';
          await finish();
          logger.debug(
            `[Tuya][poll] device=${topic} mode=${modeUsed} local_handled=${localHandled} local_changed=${localChanged} cloud_handled=0 cloud_changed=0 cloud_missing=0 fallback=${fallbackReason}`,
          );
          return;
        }

        fallbackReason = 'partial_local_mapping';
        try {
          cloudSummary = await pollCloudFeatures(this, device, pendingCloudFeatures, topic);
        } catch (e) {
          logger.warn(
            `[Tuya][poll] local poll succeeded but cloud fallback failed for ${topic}`,
            e,
          );
          fallbackReason = 'cloud_fallback_failed';
        }
        modeUsed = 'local+cloud';
        await finish();
        logger.debug(
          `[Tuya][poll] device=${topic} mode=${modeUsed} local_handled=${localHandled} local_changed=${localChanged} cloud_handled=${cloudSummary.handled} cloud_changed=${cloudSummary.changed} cloud_missing=${cloudSummary.missing} fallback=${fallbackReason}`,
        );
        return;
      }

      fallbackReason = 'invalid_local_payload';
      logger.warn(
        `[Tuya][poll] local poll returned invalid DPS payload for ${topic}, falling back to cloud`,
      );
    } catch (e) {
      logger.warn(`[Tuya][poll] local poll failed for ${topic}, falling back to cloud`, e);
      fallbackReason = 'local_poll_failed';
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
    await finish();
    logger.debug(
      `[Tuya][poll] device=${topic} mode=${modeUsed} local_handled=${localHandled} local_changed=${localChanged} cloud_handled=0 cloud_changed=0 cloud_missing=0 fallback=${fallbackReason}`,
    );
    return;
  }

  try {
    cloudSummary = await pollCloudFeatures(this, device, deviceFeatures, topic);
  } catch (e) {
    logger.warn(`[Tuya][poll] cloud poll failed for ${topic}`, e);
    fallbackReason =
      fallbackReason === 'none' ? 'cloud_poll_failed' : `${fallbackReason}+cloud_poll_failed`;
  }
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
