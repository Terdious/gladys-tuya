// Ported from server/services/tuya/lib/device/tuya.convertUnit.js.

import { DEVICE_FEATURE_UNITS } from '@gladysassistant/integration-sdk';

/**
 * @description Convert Tuya unit into Gladys unit.
 * @param {string} tuyaUnit - Tuya unit.
 * @returns {string|null} Gladys unit.
 * @example
 * convertUnit('°C');
 */
export function convertUnit(tuyaUnit) {
  switch (tuyaUnit) {
    case '°C':
      return DEVICE_FEATURE_UNITS.CELSIUS;
    case '°F':
      return DEVICE_FEATURE_UNITS.FAHRENHEIT;
    default:
      return null;
  }
}
