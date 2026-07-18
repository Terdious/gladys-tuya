// External-id parsing helpers.
//
// External ids are built with the SDK factory `gladys.externalIds`:
//   device : `ext:<selector>:<type>:<tuyaDeviceId>`
//   feature: `ext:<selector>:<type>:<tuyaDeviceId>:<code>`
// (the core service used `tuya:<id>` / `tuya:<id>:<code>`).

import { DEVICE_PARAM_NAME, DEVICE_EXTERNAL_ID_TYPE } from '../constants.js';
import { getParamValue } from './tuya.deviceParams.js';

/**
 * @description Extract the Tuya device id from a Gladys device.
 * @param {object} device - Gladys device.
 * @returns {string} Tuya device id.
 * @example
 * const tuyaDeviceId = getTuyaDeviceId(device);
 */
export const getTuyaDeviceId = (device) => {
  const externalId = device && device.external_id ? String(device.external_id) : '';
  // The DEVICE_ID param is the authoritative source (set at discovery).
  const fromParam = getParamValue(device && device.params, DEVICE_PARAM_NAME.DEVICE_ID);
  if (fromParam) {
    return String(fromParam);
  }
  const parts = externalId.split(':');
  const typeIndex = parts.indexOf(DEVICE_EXTERNAL_ID_TYPE);
  const fromExternalId = typeIndex >= 0 ? parts[typeIndex + 1] : null;
  if (!parts[0] || parts[0] !== 'ext' || !fromExternalId) {
    throw new Error(`Tuya device external_id is invalid: "${externalId}"`);
  }
  return fromExternalId;
};

/**
 * @description Extract the Tuya code from a Gladys device feature.
 * @param {object} deviceFeature - Gladys device feature.
 * @returns {string|null} Tuya code.
 * @example
 * const code = getFeatureCode(deviceFeature);
 */
export const getFeatureCode = (deviceFeature) => {
  if (!deviceFeature || !deviceFeature.external_id) {
    return null;
  }
  const parts = String(deviceFeature.external_id).split(':');
  if (parts.length >= 2) {
    return parts[parts.length - 1] || null;
  }
  return null;
};
