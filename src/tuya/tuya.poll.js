// Ported from server/services/tuya/lib/tuya.poll.js (cloud path).
//
// Differences with the core service:
// - states are published to Gladys with `gladys.publishState` instead of the
//   core NEW_STATE event bus;
// - the last emitted value/timestamp comes from an in-memory cache on the
//   handler (the core read it from its stateManager), with the device
//   feature `last_value` / `last_value_changed` sent by Gladys as fallback;
// - the local (LAN) poll path arrives with the local-mode PR.

import { createLogger } from '@gladysassistant/integration-sdk';

import { readValues } from './device/tuya.deviceMapping.js';
import { API } from './constants.js';
import { CLOUD_STRATEGY, getConfiguredCloudReadStrategy } from './cloud/tuya.cloudStrategy.js';
import { getTuyaDeviceId, getFeatureCode } from './utils/tuya.externalId.js';

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
  };
  if (!Array.isArray(deviceFeatures) || deviceFeatures.length === 0) {
    return summary;
  }

  if (!self.connector || typeof self.connector.request !== 'function') {
    logger.warn(`[Tuya][poll][cloud] connector unavailable for device=${topic}`);
    return summary;
  }

  const cloudReadStrategy = getConfiguredCloudReadStrategy(device);
  const response =
    cloudReadStrategy === CLOUD_STRATEGY.SHADOW
      ? await self.connector.request({
          method: 'GET',
          path: `${API.VERSION_2_0}/thing/${topic}/shadow/properties`,
        })
      : await self.connector.request({
          method: 'GET',
          path: `${API.VERSION_1_0}/devices/${topic}/status`,
        });

  const values =
    cloudReadStrategy === CLOUD_STRATEGY.SHADOW
      ? extractShadowValues(response)
      : extractValuesFromResultArray(response && response.result);

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
 * @description Poll values of a Tuya device (cloud mode).
 * @param {object} device - The device to poll.
 * @returns {Promise} Promise of nothing.
 * @example
 * await handler.poll(device);
 */
export async function poll(device) {
  const topic = getTuyaDeviceId(device);
  const deviceFeatures = Array.isArray(device.features) ? device.features : [];

  this.pendingStates = [];
  let cloudSummary = {
    polled: 0,
    handled: 0,
    changed: 0,
    missing: 0,
    skipped: 0,
  };

  try {
    cloudSummary = await pollCloudFeatures(this, device, deviceFeatures, topic);
  } catch (e) {
    logger.warn(`[Tuya][poll] cloud poll failed for ${topic}`, e);
  }
  await Promise.all(this.pendingStates);
  this.pendingStates = [];
  logger.debug(
    `[Tuya][poll] device=${topic} mode=cloud cloud_handled=${cloudSummary.handled} cloud_changed=${cloudSummary.changed} cloud_missing=${cloudSummary.missing}`,
  );
}
