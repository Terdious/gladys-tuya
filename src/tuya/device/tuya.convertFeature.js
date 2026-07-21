// Ported from server/services/tuya/lib/device/tuya.convertFeature.js.
//
// The feature external id is built with the SDK external-ids factory instead
// of the hand-built `tuya:<id>:<code>` of the core; the core-side selector
// generation (addSelector) is left to Gladys.

import {
  createLogger,
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
} from '@gladysassistant/integration-sdk';

import { getFeatureMapping, getIgnoredCloudCodes, normalizeCode } from '../mappings/index.js';
import { buildFeatureSelector } from '../utils/tuya.selector.js';

const logger = createLogger({ name: 'tuya' });

/**
 * @description Transforms Tuya feature as Gladys feature.
 * @param {object} tuyaFunctions - Functions from Tuya.
 * @param {object} ids - Device external ids factory (gladys.externalIds result).
 * @param {object} options - Mapping options.
 * @returns {object} Gladys feature or undefined.
 * @example
 * convertFeature({ code: 'switch', values: '{}', readOnly: false }, ids, { deviceType: 'smart-socket' });
 */
export function convertFeature(tuyaFunctions, ids, options = {}) {
  const { code, values, readOnly } = tuyaFunctions;
  const { deviceType, ignoredCloudCodes, deviceSelector, temperatureUnit, productId } = options;

  const codeLower = normalizeCode(code);
  const ignoredCodes = Array.isArray(ignoredCloudCodes)
    ? ignoredCloudCodes
    : getIgnoredCloudCodes(deviceType, productId);
  if (codeLower && ignoredCodes.includes(codeLower)) {
    return undefined;
  }

  const mappingEntry = getFeatureMapping(code, deviceType, productId);
  if (!mappingEntry) {
    logger.warn(`Tuya function with "${code}" code is not managed`);
    return undefined;
  }
  // tuyaEnum is mapping-only metadata (per-variant mode vocabulary consumed by
  // the read/write pipeline); it must not leak onto the persisted feature.
  const { tuyaEnum: _tuyaEnum, ...featuresCategoryAndType } = mappingEntry;

  let valuesObject = {};
  if (values && typeof values === 'object') {
    valuesObject = values;
  } else if (typeof values === 'string') {
    try {
      valuesObject = JSON.parse(values);
    } catch {
      logger.error(
        `Tuya function as unmappable "${values}" values on "${featuresCategoryAndType.category}/${featuresCategoryAndType.type}" type with "${code}" code`,
      );
    }
  }

  const feature = {
    external_id: ids.feature(code),
    // Scope the selector to the device so two devices exposing a feature with
    // the same code/name do not collide on a globally-unique selector (the
    // core rejects duplicates). When no device selector is provided, let the
    // core derive it from the name (legacy behaviour).
    ...(deviceSelector ? { selector: buildFeatureSelector(deviceSelector, code) } : {}),
    read_only: readOnly,
    has_feedback: false,
    min: 0,
    max: 1,
    ...featuresCategoryAndType,
  };
  // Display name priority: a curated mapping name wins so device-type mappings
  // can fix Tuya typos (e.g. code "energy_forword_a" -> name "Forward energy A").
  // Otherwise the Tuya code is used as the display name, preserving the existing
  // behaviour for device types without curated names. (`code` is always defined
  // here: an empty code is rejected earlier by getFeatureMapping.)
  feature.name = featuresCategoryAndType.name || code;
  if (typeof valuesObject.min === 'number') {
    feature.min = valuesObject.min;
  }
  if (typeof valuesObject.max === 'number') {
    feature.max = valuesObject.max;
  }
  if ('scale' in valuesObject) {
    feature.scale = valuesObject.scale;
  }
  // Some devices report their temperatures in Fahrenheit (temp_unit_convert /
  // unit property): reflect the real device unit on the feature.
  if (
    temperatureUnit &&
    (codeLower === 'temp_set' || codeLower === 'temp_current') &&
    feature.unit !== undefined
  ) {
    feature.unit = temperatureUnit;
  }

  // Scaled target temperatures declare their bounds in device units (an AC
  // spec with min 160 / max 880 and scale 1 means 16..88 degrees): bring the
  // Gladys min/max back to real degrees, like the value transforms do.
  const isScaledTargetTemperature =
    (feature.category === DEVICE_FEATURE_CATEGORIES.AIR_CONDITIONING &&
      feature.type === DEVICE_FEATURE_TYPES.AIR_CONDITIONING.TARGET_TEMPERATURE) ||
    (feature.category === DEVICE_FEATURE_CATEGORIES.THERMOSTAT &&
      feature.type === DEVICE_FEATURE_TYPES.THERMOSTAT.TARGET_TEMPERATURE);
  if (feature.scale !== undefined && isScaledTargetTemperature) {
    const divider = 10 ** feature.scale;
    feature.min /= divider;
    feature.max /= divider;
  }
  // A writable feature reports its state back after a command.
  if (feature.read_only === false) {
    feature.has_feedback = true;
  }

  return feature;
}
