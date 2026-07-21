// Ported from server/services/tuya/lib/utils/tuya.normalize.js.

import { DEVICE_FEATURE_UNITS } from '@gladysassistant/integration-sdk';

export const normalizeBoolean = (value) => {
  if (value === true || value === 1 || value === '1') {
    return true;
  }
  return typeof value === 'string' && ['true', 'on'].includes(value.trim().toLowerCase());
};

// Tuya devices report their temperature unit in many spellings ('c', '℃',
// 'celsius'...): normalize to the Gladys unit, or null when unknown.
export const normalizeTemperatureUnit = (value) => {
  if (value === null || value === undefined) {
    return null;
  }
  const normalized = String(value).trim().toLowerCase();
  if (
    normalized === 'c' ||
    normalized === '℃' ||
    normalized === 'celsius' ||
    normalized === 'centigrade' ||
    normalized === 'celcius' ||
    normalized === DEVICE_FEATURE_UNITS.CELSIUS
  ) {
    return DEVICE_FEATURE_UNITS.CELSIUS;
  }
  if (
    normalized === 'f' ||
    normalized === '℉' ||
    normalized === 'fahrenheit' ||
    normalized === DEVICE_FEATURE_UNITS.FAHRENHEIT
  ) {
    return DEVICE_FEATURE_UNITS.FAHRENHEIT;
  }
  return null;
};
