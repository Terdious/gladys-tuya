// Ported from server/services/tuya/lib/device/tuya.convertFeature.js.
//
// The feature external id is built with the SDK external-ids factory instead
// of the hand-built `tuya:<id>:<code>` of the core; the core-side selector
// generation (addSelector) is left to Gladys.

import { createLogger } from '@gladysassistant/integration-sdk';

import { getFeatureMapping, getIgnoredCloudCodes, normalizeCode } from '../mappings/index.js';

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
  const { deviceType, ignoredCloudCodes } = options;

  const codeLower = normalizeCode(code);
  const ignoredCodes = Array.isArray(ignoredCloudCodes)
    ? ignoredCloudCodes
    : getIgnoredCloudCodes(deviceType);
  if (codeLower && ignoredCodes.includes(codeLower)) {
    return undefined;
  }

  const featuresCategoryAndType = getFeatureMapping(code, deviceType);
  if (!featuresCategoryAndType) {
    logger.warn(`Tuya function with "${code}" code is not managed`);
    return undefined;
  }

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
  if ('min' in valuesObject) {
    feature.min = valuesObject.min;
  }
  if ('max' in valuesObject) {
    feature.max = valuesObject.max;
  }
  if ('scale' in valuesObject) {
    feature.scale = valuesObject.scale;
  }

  return feature;
}
