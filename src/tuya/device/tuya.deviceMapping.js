// Ported from server/services/tuya/lib/device/tuya.deviceMapping.js.
//
// readValues transforms a raw Tuya value into a Gladys state; writeValues
// transforms a Gladys command value into a raw Tuya value.

import { DEVICE_FEATURE_CATEGORIES, DEVICE_FEATURE_TYPES } from '@gladysassistant/integration-sdk';

import { intToRgb, rgbToHsb, rgbToInt, hsbToRgb } from '../utils/colors.js';
import { normalizeBoolean } from '../utils/tuya.normalize.js';
// Mirror of the core AC_MODE constant (server/utils/constants.js).
import { AC_MODE } from '../../devices/airConditioner.js';
// Mirror of the core PILOT_WIRE_MODE constant (server/utils/constants.js).
import { PILOT_WIRE_MODE } from '../../devices/pilotThermostat.js';

// Mirror of the core COVER_STATE constant (server/utils/constants.js).
export const COVER_STATE = {
  STOP: 0,
  OPEN: 1,
  CLOSE: -1,
};

// Mirror of the core OPENING_SENSOR_STATE constant (server/utils/constants.js).
export const OPENING_SENSOR_STATE = {
  OPEN: 0,
  CLOSE: 1,
};

// Default pilot-wire vocabulary (RP5-style thermostats). Every pilot-wire
// product uses its own mode strings (there is no Tuya standard for fil
// pilote): a cloud-mapping entry can carry a `tuyaEnum` map (tuya string ->
// Gladys PILOT_WIRE_MODE) overriding this default vocabulary.
const TUYA_PILOT_WIRE_MODE_TO_GLADYS = {
  Standby: PILOT_WIRE_MODE.OFF,
  Anti_forst: PILOT_WIRE_MODE.FROST_PROTECTION,
  ECO: PILOT_WIRE_MODE.ECO,
  Comfort_1: PILOT_WIRE_MODE.COMFORT_1,
  Comfort_2: PILOT_WIRE_MODE.COMFORT_2,
  Comfort: PILOT_WIRE_MODE.COMFORT,
  Programming: PILOT_WIRE_MODE.PROGRAMMING,
  Thermostat: PILOT_WIRE_MODE.THERMOSTAT,
};

const getPilotWireTuyaEnum = (mappingEntry) =>
  mappingEntry && mappingEntry.tuyaEnum && typeof mappingEntry.tuyaEnum === 'object'
    ? mappingEntry.tuyaEnum
    : TUYA_PILOT_WIRE_MODE_TO_GLADYS;

// English fallback labels for pilot-wire supported options: the frontend
// renders its own localized label from the option value, these only keep the
// API payload human-readable.
const PILOT_WIRE_MODE_LABELS = {
  [PILOT_WIRE_MODE.OFF]: 'Off',
  [PILOT_WIRE_MODE.FROST_PROTECTION]: 'Frost Protection',
  [PILOT_WIRE_MODE.ECO]: 'Eco',
  [PILOT_WIRE_MODE.COMFORT_1]: 'Comfort -1°C',
  [PILOT_WIRE_MODE.COMFORT_2]: 'Comfort -2°C',
  [PILOT_WIRE_MODE.COMFORT]: 'Comfort',
  [PILOT_WIRE_MODE.PROGRAMMING]: 'Programming',
  [PILOT_WIRE_MODE.THERMOSTAT]: 'Thermostat',
};

// Build the supported_options of a pilot-wire-mode feature: the Gladys modes
// actually reachable on this device. A curated variant vocabulary (explicit
// `tuyaEnum`, e.g. the eCosy) is the COMPLETE truth — it exists precisely
// because the device specs are unreliable, and it already drives what
// setValue accepts. The default vocabulary spans every generic product, so it
// is narrowed by the spec enum range (a status enum may expose fewer values
// than its rw sibling); without a usable range the full default vocabulary is
// assumed.
export const buildPilotWireSupportedOptions = (mappingEntry, range) => {
  const hasCuratedEnum = Boolean(
    mappingEntry && mappingEntry.tuyaEnum && typeof mappingEntry.tuyaEnum === 'object',
  );
  const tuyaEnum = getPilotWireTuyaEnum(mappingEntry);
  const tuyaValues =
    !hasCuratedEnum && Array.isArray(range) && range.length > 0 ? range : Object.keys(tuyaEnum);
  const supportedValues = [
    ...new Set(
      tuyaValues.map((tuyaValue) => tuyaEnum[tuyaValue]).filter((value) => value !== undefined),
    ),
  ].sort((a, b) => a - b);
  return supportedValues.map((value, index) => ({
    value,
    label: PILOT_WIRE_MODE_LABELS[value] || String(value),
    sort_order: index,
  }));
};

const OPEN = 'open';
const CLOSE = 'close';
const STOP = 'stop';

const getScale = (deviceFeature, defaultScale = 0) => {
  const parsedScale =
    deviceFeature && deviceFeature.scale !== undefined && deviceFeature.scale !== null
      ? parseInt(deviceFeature.scale, 10)
      : defaultScale;

  return Number.isNaN(parsedScale) ? defaultScale : parsedScale;
};

const scaleValue = (valueFromDevice, deviceFeature, defaultScale = 0) => {
  const parsedValue = Number(valueFromDevice);
  if (Number.isNaN(parsedValue)) {
    return parsedValue;
  }
  const scale = getScale(deviceFeature, defaultScale);
  return parsedValue / 10 ** scale;
};

const unscaleValue = (valueFromGladys, deviceFeature, defaultScale = 0) => {
  const parsedValue = Number(valueFromGladys);
  if (Number.isNaN(parsedValue)) {
    return parsedValue;
  }
  const scale = getScale(deviceFeature, defaultScale);
  return Math.round(parsedValue * 10 ** scale);
};

// Tuya AC mode vocabulary -> Gladys AC_MODE values (aliases like cold/cool
// come from the many Tuya AC firmwares).
const TUYA_AC_MODE_TO_GLADYS = {
  auto: AC_MODE.AUTO,
  cold: AC_MODE.COOLING,
  cool: AC_MODE.COOLING,
  heat: AC_MODE.HEATING,
  hot: AC_MODE.HEATING,
  wet: AC_MODE.DRYING,
  dry: AC_MODE.DRYING,
  fan: AC_MODE.FAN,
  wind: AC_MODE.FAN,
};

const GLADYS_AC_MODE_TO_TUYA = {
  [AC_MODE.AUTO]: 'auto',
  [AC_MODE.COOLING]: 'cold',
  [AC_MODE.HEATING]: 'heat',
  [AC_MODE.DRYING]: 'wet',
  [AC_MODE.FAN]: 'fan',
};

export const writeValues = {
  [DEVICE_FEATURE_CATEGORIES.LIGHT]: {
    [DEVICE_FEATURE_TYPES.LIGHT.BINARY]: (valueFromGladys) => {
      return valueFromGladys === 1;
    },
    [DEVICE_FEATURE_TYPES.LIGHT.BRIGHTNESS]: (valueFromGladys) => {
      return parseInt(valueFromGladys, 10);
    },
    [DEVICE_FEATURE_TYPES.LIGHT.TEMPERATURE]: (valueFromGladys) => {
      return 1000 - parseInt(valueFromGladys, 10);
    },
    [DEVICE_FEATURE_TYPES.LIGHT.COLOR]: (valueFromGladys) => {
      const rgb = intToRgb(valueFromGladys);
      const hsb = rgbToHsb(rgb, 1000);
      return {
        h: hsb[0],
        s: hsb[1],
        v: hsb[2],
      };
    },
  },

  [DEVICE_FEATURE_CATEGORIES.SWITCH]: {
    [DEVICE_FEATURE_TYPES.SWITCH.BINARY]: (valueFromGladys) => {
      return valueFromGladys === 1;
    },
  },

  [DEVICE_FEATURE_CATEGORIES.CHILD_LOCK]: {
    [DEVICE_FEATURE_TYPES.CHILD_LOCK.BINARY]: (valueFromGladys) => {
      return valueFromGladys === 1;
    },
  },

  [DEVICE_FEATURE_CATEGORIES.THERMOSTAT]: {
    [DEVICE_FEATURE_TYPES.THERMOSTAT.TARGET_TEMPERATURE]: (valueFromGladys, deviceFeature) => {
      return unscaleValue(valueFromGladys, deviceFeature, 0);
    },
  },

  [DEVICE_FEATURE_CATEGORIES.HEATER]: {
    [DEVICE_FEATURE_TYPES.HEATER.PILOT_WIRE_MODE]: (
      valueFromGladys,
      deviceFeature,
      mappingEntry,
    ) => {
      const parsedValue = parseInt(valueFromGladys, 10);
      const tuyaEnum = getPilotWireTuyaEnum(mappingEntry);
      // Returns undefined when the device vocabulary has no such mode (e.g.
      // OFF on a device whose on/off is a separate switch DPS): setValue
      // rejects it instead of sending garbage.
      return Object.keys(tuyaEnum).find((tuyaValue) => tuyaEnum[tuyaValue] === parsedValue);
    },
  },

  [DEVICE_FEATURE_CATEGORIES.AIR_CONDITIONING]: {
    [DEVICE_FEATURE_TYPES.AIR_CONDITIONING.BINARY]: (valueFromGladys) => {
      return valueFromGladys === 1;
    },
    [DEVICE_FEATURE_TYPES.AIR_CONDITIONING.MODE]: (valueFromGladys) => {
      const parsedValue = parseInt(valueFromGladys, 10);
      return GLADYS_AC_MODE_TO_TUYA[parsedValue];
    },
    [DEVICE_FEATURE_TYPES.AIR_CONDITIONING.TARGET_TEMPERATURE]: (
      valueFromGladys,
      deviceFeature,
    ) => {
      // A device declaring scale 1 stores 20.0 degrees as 200.
      return unscaleValue(valueFromGladys, deviceFeature, 0);
    },
  },

  [DEVICE_FEATURE_CATEGORIES.CURTAIN]: {
    [DEVICE_FEATURE_TYPES.CURTAIN.STATE]: (valueFromGladys) => {
      if (valueFromGladys === COVER_STATE.OPEN) {
        return OPEN;
      }
      if (valueFromGladys === COVER_STATE.CLOSE) {
        return CLOSE;
      }
      return STOP;
    },
    [DEVICE_FEATURE_TYPES.CURTAIN.POSITION]: (valueFromGladys) => {
      return parseInt(valueFromGladys, 10);
    },
  },
};

export const readValues = {
  [DEVICE_FEATURE_CATEGORIES.LIGHT]: {
    [DEVICE_FEATURE_TYPES.LIGHT.BINARY]: (valueFromDevice) => {
      return normalizeBoolean(valueFromDevice) ? 1 : 0;
    },
    [DEVICE_FEATURE_TYPES.LIGHT.BRIGHTNESS]: (valueFromDevice) => {
      return valueFromDevice;
    },
    [DEVICE_FEATURE_TYPES.LIGHT.TEMPERATURE]: (valueFromDevice) => {
      return 1000 - parseInt(valueFromDevice, 10);
    },
    [DEVICE_FEATURE_TYPES.LIGHT.COLOR]: (valueFromDevice) => {
      const parsedValue = JSON.parse(valueFromDevice);
      const hsb = [parsedValue.h, parsedValue.s, parsedValue.v];
      const rgb = hsbToRgb(hsb, 1000);
      return rgbToInt(rgb);
    },
  },

  [DEVICE_FEATURE_CATEGORIES.AIR_CONDITIONING]: {
    [DEVICE_FEATURE_TYPES.AIR_CONDITIONING.BINARY]: (valueFromDevice) => {
      return normalizeBoolean(valueFromDevice) ? 1 : 0;
    },
    [DEVICE_FEATURE_TYPES.AIR_CONDITIONING.MODE]: (valueFromDevice) => {
      return Object.prototype.hasOwnProperty.call(TUYA_AC_MODE_TO_GLADYS, valueFromDevice)
        ? TUYA_AC_MODE_TO_GLADYS[valueFromDevice]
        : null;
    },
    [DEVICE_FEATURE_TYPES.AIR_CONDITIONING.TARGET_TEMPERATURE]: (
      valueFromDevice,
      deviceFeature,
    ) => {
      return scaleValue(valueFromDevice, deviceFeature, 0);
    },
  },
  [DEVICE_FEATURE_CATEGORIES.TEMPERATURE_SENSOR]: {
    [DEVICE_FEATURE_TYPES.SENSOR.DECIMAL]: (valueFromDevice, deviceFeature) => {
      return scaleValue(valueFromDevice, deviceFeature, 0);
    },
  },
  [DEVICE_FEATURE_CATEGORIES.THERMOSTAT]: {
    [DEVICE_FEATURE_TYPES.THERMOSTAT.TARGET_TEMPERATURE]: (valueFromDevice, deviceFeature) => {
      return scaleValue(valueFromDevice, deviceFeature, 0);
    },
  },
  [DEVICE_FEATURE_CATEGORIES.HEATER]: {
    [DEVICE_FEATURE_TYPES.HEATER.PILOT_WIRE_MODE]: (
      valueFromDevice,
      deviceFeature,
      mappingEntry,
    ) => {
      const tuyaEnum = getPilotWireTuyaEnum(mappingEntry);
      return Object.prototype.hasOwnProperty.call(tuyaEnum, valueFromDevice)
        ? tuyaEnum[valueFromDevice]
        : null;
    },
  },
  [DEVICE_FEATURE_CATEGORIES.OPENING_SENSOR]: {
    [DEVICE_FEATURE_TYPES.SENSOR.BINARY]: (valueFromDevice) => {
      return normalizeBoolean(valueFromDevice)
        ? OPENING_SENSOR_STATE.OPEN
        : OPENING_SENSOR_STATE.CLOSE;
    },
  },
  [DEVICE_FEATURE_CATEGORIES.CHILD_LOCK]: {
    [DEVICE_FEATURE_TYPES.CHILD_LOCK.BINARY]: (valueFromDevice) => {
      return normalizeBoolean(valueFromDevice) ? 1 : 0;
    },
  },
  [DEVICE_FEATURE_CATEGORIES.SWITCH]: {
    [DEVICE_FEATURE_TYPES.SWITCH.BINARY]: (valueFromDevice) => {
      return normalizeBoolean(valueFromDevice) ? 1 : 0;
    },
    [DEVICE_FEATURE_TYPES.SWITCH.ENERGY]: (valueFromDevice, deviceFeature) => {
      return scaleValue(valueFromDevice, deviceFeature, 2);
    },
    [DEVICE_FEATURE_TYPES.SWITCH.CURRENT]: (valueFromDevice, deviceFeature) => {
      return scaleValue(valueFromDevice, deviceFeature, 0);
    },
    [DEVICE_FEATURE_TYPES.SWITCH.POWER]: (valueFromDevice, deviceFeature) => {
      return scaleValue(valueFromDevice, deviceFeature, 1);
    },
    [DEVICE_FEATURE_TYPES.SWITCH.VOLTAGE]: (valueFromDevice, deviceFeature) => {
      return scaleValue(valueFromDevice, deviceFeature, 1);
    },
  },
  [DEVICE_FEATURE_CATEGORIES.ENERGY_SENSOR]: {
    [DEVICE_FEATURE_TYPES.ENERGY_SENSOR.POWER]: (valueFromDevice, deviceFeature) => {
      return scaleValue(valueFromDevice, deviceFeature, 1);
    },
    [DEVICE_FEATURE_TYPES.ENERGY_SENSOR.INDEX_TODAY]: (valueFromDevice, deviceFeature) => {
      return scaleValue(valueFromDevice, deviceFeature, 0);
    },
    [DEVICE_FEATURE_TYPES.ENERGY_SENSOR.ENERGY]: (valueFromDevice, deviceFeature) => {
      return scaleValue(valueFromDevice, deviceFeature, 2);
    },
    [DEVICE_FEATURE_TYPES.ENERGY_SENSOR.VOLTAGE]: (valueFromDevice, deviceFeature) => {
      return scaleValue(valueFromDevice, deviceFeature, 1);
    },
    [DEVICE_FEATURE_TYPES.ENERGY_SENSOR.CURRENT]: (valueFromDevice, deviceFeature) => {
      return scaleValue(valueFromDevice, deviceFeature, 0);
    },
  },
  [DEVICE_FEATURE_CATEGORIES.ENERGY_PRODUCTION_SENSOR]: {
    [DEVICE_FEATURE_TYPES.ENERGY_PRODUCTION_SENSOR.INDEX]: (valueFromDevice, deviceFeature) => {
      return scaleValue(valueFromDevice, deviceFeature, 2);
    },
  },
  [DEVICE_FEATURE_CATEGORIES.CURTAIN]: {
    [DEVICE_FEATURE_TYPES.CURTAIN.STATE]: (valueFromDevice) => {
      if (valueFromDevice === OPEN) {
        return COVER_STATE.OPEN;
      }
      if (valueFromDevice === CLOSE) {
        return COVER_STATE.CLOSE;
      }
      return COVER_STATE.STOP;
    },
    [DEVICE_FEATURE_TYPES.CURTAIN.POSITION]: (valueFromDevice) => {
      return valueFromDevice;
    },
  },
};
