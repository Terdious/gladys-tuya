// Ported from server/services/tuya/lib/device/tuya.deviceMapping.js.
//
// readValues transforms a raw Tuya value into a Gladys state; writeValues
// transforms a Gladys command value into a raw Tuya value.

import { DEVICE_FEATURE_CATEGORIES, DEVICE_FEATURE_TYPES } from '@gladysassistant/integration-sdk';

import { intToRgb, rgbToHsb, rgbToInt, hsbToRgb } from '../utils/colors.js';
import { normalizeBoolean } from '../utils/tuya.normalize.js';
// Mirrors of the core AC_* constants (server/utils/constants.js).
import {
  AC_MODE,
  AC_FAN_SPEED,
  AC_SWING_HORIZONTAL,
  AC_SWING_VERTICAL,
} from '../../devices/airConditioner.js';
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
export const PILOT_WIRE_MODE_LABELS = {
  [PILOT_WIRE_MODE.OFF]: 'Off',
  [PILOT_WIRE_MODE.FROST_PROTECTION]: 'Frost Protection',
  [PILOT_WIRE_MODE.ECO]: 'Eco',
  [PILOT_WIRE_MODE.COMFORT_1]: 'Comfort -1°C',
  [PILOT_WIRE_MODE.COMFORT_2]: 'Comfort -2°C',
  [PILOT_WIRE_MODE.COMFORT]: 'Comfort',
  [PILOT_WIRE_MODE.PROGRAMMING]: 'Programming',
  [PILOT_WIRE_MODE.THERMOSTAT]: 'Thermostat',
};

// Turn a list of tuya enum strings into sorted Gladys supported_options
// (aliases like cold/cool dedupe through the Set; unknown strings are skipped).
const buildSupportedOptionsFromVocabulary = (vocabulary, tuyaValues, labels) => {
  const supportedValues = [
    ...new Set(
      tuyaValues.map((tuyaValue) => vocabulary[tuyaValue]).filter((value) => value !== undefined),
    ),
  ].sort((a, b) => a - b);
  return supportedValues.map((value, index) => ({
    value,
    label: labels[value] || String(value),
    sort_order: index,
  }));
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
  return buildSupportedOptionsFromVocabulary(tuyaEnum, tuyaValues, PILOT_WIRE_MODE_LABELS);
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

// Some models report a compound record where another reports a plain number
// (the F14-W pet feeder sends feed_record = {"value":3,"type":2} instead of
// feed_report = 3). The mapping names the key to read; without that hint the
// value is passed through untouched.
const unwrapRecordValue = (valueFromDevice, mappingEntry) => {
  const key = mappingEntry && mappingEntry.jsonValueKey;
  if (!key) {
    return valueFromDevice;
  }
  let parsed = valueFromDevice;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== 'object') {
    return null;
  }
  return Object.prototype.hasOwnProperty.call(parsed, key) ? parsed[key] : null;
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

// Tuya AC fan-speed vocabulary -> Gladys AC_FAN_SPEED values (aliases come
// from the many Tuya AC firmwares; `mute` is the Tuya string for QUIET).
const TUYA_AC_FAN_SPEED_TO_GLADYS = {
  auto: AC_FAN_SPEED.AUTO,
  low: AC_FAN_SPEED.LOW,
  low_mid: AC_FAN_SPEED.LOW_MID,
  level_2: AC_FAN_SPEED.LOW_MID,
  mid: AC_FAN_SPEED.MID,
  middle: AC_FAN_SPEED.MID,
  mid_high: AC_FAN_SPEED.MID_HIGH,
  level_4: AC_FAN_SPEED.MID_HIGH,
  high: AC_FAN_SPEED.HIGH,
  mute: AC_FAN_SPEED.QUIET,
  quiet: AC_FAN_SPEED.QUIET,
  turbo: AC_FAN_SPEED.TURBO,
  strong: AC_FAN_SPEED.TURBO,
};

const GLADYS_AC_FAN_SPEED_TO_TUYA = {
  [AC_FAN_SPEED.AUTO]: 'auto',
  [AC_FAN_SPEED.LOW]: 'low',
  [AC_FAN_SPEED.LOW_MID]: 'low_mid',
  [AC_FAN_SPEED.MID]: 'mid',
  [AC_FAN_SPEED.MID_HIGH]: 'mid_high',
  [AC_FAN_SPEED.HIGH]: 'high',
  [AC_FAN_SPEED.QUIET]: 'mute',
  [AC_FAN_SPEED.TURBO]: 'turbo',
};

// The observed kt vocabulary is off/same/opposite: `same` is the standard
// sweep (SWING), `opposite` the counter-phase sweep (SWING_OPPOSITE). The
// Gladys POSITION_1..5 values have no Tuya string on this vocabulary — they
// stay unreachable (writing them is rejected) until a device documents them.
const TUYA_AC_SWING_HORIZONTAL_TO_GLADYS = {
  off: AC_SWING_HORIZONTAL.OFF,
  same: AC_SWING_HORIZONTAL.SWING,
  opposite: AC_SWING_HORIZONTAL.SWING_OPPOSITE,
};

const GLADYS_AC_SWING_HORIZONTAL_TO_TUYA = {
  [AC_SWING_HORIZONTAL.OFF]: 'off',
  [AC_SWING_HORIZONTAL.SWING]: 'same',
  [AC_SWING_HORIZONTAL.SWING_OPPOSITE]: 'opposite',
};

// The observed kt vertical vocabulary is angles: `15` is the full sweep
// (SWING), `1`..`5` the fixed positions.
const TUYA_AC_SWING_VERTICAL_TO_GLADYS = {
  off: AC_SWING_VERTICAL.OFF,
  15: AC_SWING_VERTICAL.SWING,
  1: AC_SWING_VERTICAL.POSITION_1,
  2: AC_SWING_VERTICAL.POSITION_2,
  3: AC_SWING_VERTICAL.POSITION_3,
  4: AC_SWING_VERTICAL.POSITION_4,
  5: AC_SWING_VERTICAL.POSITION_5,
};

const GLADYS_AC_SWING_VERTICAL_TO_TUYA = {
  [AC_SWING_VERTICAL.OFF]: 'off',
  [AC_SWING_VERTICAL.SWING]: '15',
  [AC_SWING_VERTICAL.POSITION_1]: '1',
  [AC_SWING_VERTICAL.POSITION_2]: '2',
  [AC_SWING_VERTICAL.POSITION_3]: '3',
  [AC_SWING_VERTICAL.POSITION_4]: '4',
  [AC_SWING_VERTICAL.POSITION_5]: '5',
};

// English fallback labels + vocabulary per AC enum feature type. AC models
// vary a lot (a cold-only unit has no heat, many lack quiet/turbo): the spec
// enum range is the per-device truth here — there is no curated per-variant
// vocabulary like the pilot wire, the maps above cover every known alias.
export const AC_SUPPORTED_OPTION_SOURCES = {
  [DEVICE_FEATURE_TYPES.AIR_CONDITIONING.MODE]: {
    vocabulary: TUYA_AC_MODE_TO_GLADYS,
    labels: {
      [AC_MODE.AUTO]: 'Auto',
      [AC_MODE.COOLING]: 'Cooling',
      [AC_MODE.HEATING]: 'Heating',
      [AC_MODE.DRYING]: 'Drying',
      [AC_MODE.FAN]: 'Fan',
    },
  },
  [DEVICE_FEATURE_TYPES.AIR_CONDITIONING.FAN_SPEED]: {
    vocabulary: TUYA_AC_FAN_SPEED_TO_GLADYS,
    labels: {
      [AC_FAN_SPEED.AUTO]: 'Auto',
      [AC_FAN_SPEED.LOW]: 'Low',
      [AC_FAN_SPEED.LOW_MID]: 'Low-mid',
      [AC_FAN_SPEED.MID]: 'Mid',
      [AC_FAN_SPEED.MID_HIGH]: 'Mid-high',
      [AC_FAN_SPEED.HIGH]: 'High',
      [AC_FAN_SPEED.QUIET]: 'Quiet',
      [AC_FAN_SPEED.TURBO]: 'Turbo',
    },
  },
  [DEVICE_FEATURE_TYPES.AIR_CONDITIONING.SWING_HORIZONTAL]: {
    vocabulary: TUYA_AC_SWING_HORIZONTAL_TO_GLADYS,
    labels: {
      [AC_SWING_HORIZONTAL.OFF]: 'Off',
      [AC_SWING_HORIZONTAL.SWING]: 'Swing',
      [AC_SWING_HORIZONTAL.SWING_OPPOSITE]: 'Swing (opposite)',
    },
  },
  [DEVICE_FEATURE_TYPES.AIR_CONDITIONING.SWING_VERTICAL]: {
    vocabulary: TUYA_AC_SWING_VERTICAL_TO_GLADYS,
    labels: {
      [AC_SWING_VERTICAL.OFF]: 'Off',
      [AC_SWING_VERTICAL.SWING]: 'Swing',
      [AC_SWING_VERTICAL.POSITION_1]: 'Position 1',
      [AC_SWING_VERTICAL.POSITION_2]: 'Position 2',
      [AC_SWING_VERTICAL.POSITION_3]: 'Position 3',
      [AC_SWING_VERTICAL.POSITION_4]: 'Position 4',
      [AC_SWING_VERTICAL.POSITION_5]: 'Position 5',
    },
  },
};

// Build the supported_options of an AC enum feature from the spec range (full
// vocabulary without one); returns null for non-enum AC feature types (binary,
// target temperature...).
export const buildAcSupportedOptions = (featureType, range) => {
  const source = AC_SUPPORTED_OPTION_SOURCES[featureType];
  if (!source) {
    return null;
  }
  const tuyaValues =
    Array.isArray(range) && range.length > 0 ? range : Object.keys(source.vocabulary);
  return buildSupportedOptionsFromVocabulary(source.vocabulary, tuyaValues, source.labels);
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

  [DEVICE_FEATURE_CATEGORIES.SIREN]: {
    // Without this, setValue sent the raw Gladys integer (1/0) to a boolean DP.
    [DEVICE_FEATURE_TYPES.SIREN.BINARY]: (valueFromGladys) => {
      return valueFromGladys === 1;
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

  [DEVICE_FEATURE_CATEGORIES.VACUUM_CLEANER]: {
    [DEVICE_FEATURE_TYPES.VACUUM_CLEANER.DOCK]: (valueFromGladys) => {
      return valueFromGladys === 1;
    },
  },

  [DEVICE_FEATURE_CATEGORIES.TEXT]: {
    // The Gladys value of a TEXT/SELECT feature already IS the raw device
    // string (last_value_string) — no enum translation, unlike CLEAN_MODE or
    // PILOT_WIRE_MODE which map to a fixed Gladys integer vocabulary.
    [DEVICE_FEATURE_TYPES.TEXT.SELECT]: (valueFromGladys) => {
      return valueFromGladys;
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
    [DEVICE_FEATURE_TYPES.AIR_CONDITIONING.FAN_SPEED]: (valueFromGladys) => {
      const parsedValue = parseInt(valueFromGladys, 10);
      return GLADYS_AC_FAN_SPEED_TO_TUYA[parsedValue];
    },
    [DEVICE_FEATURE_TYPES.AIR_CONDITIONING.SWING_HORIZONTAL]: (valueFromGladys) => {
      const parsedValue = parseInt(valueFromGladys, 10);
      return GLADYS_AC_SWING_HORIZONTAL_TO_TUYA[parsedValue];
    },
    [DEVICE_FEATURE_TYPES.AIR_CONDITIONING.SWING_VERTICAL]: (valueFromGladys) => {
      const parsedValue = parseInt(valueFromGladys, 10);
      return GLADYS_AC_SWING_VERTICAL_TO_TUYA[parsedValue];
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
  // No BUTTON/PUSH writer here on purpose: unlike a boolean SWITCH, a push
  // has no fixed raw shape to convert to — petFeeder.js's manual_feed needs
  // the plain Gladys value (1, an integer DP) sent through unchanged, and
  // the Honiture Q6 Pro's clean_switch (a genuine boolean DP) relies on the
  // exact same passthrough (see the file header of src/devices/vacuum.js).
  // A per-device-type write transform belongs in that mapping entry if a
  // future product ever needs one, not here.
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
    [DEVICE_FEATURE_TYPES.AIR_CONDITIONING.FAN_SPEED]: (valueFromDevice) => {
      return Object.prototype.hasOwnProperty.call(TUYA_AC_FAN_SPEED_TO_GLADYS, valueFromDevice)
        ? TUYA_AC_FAN_SPEED_TO_GLADYS[valueFromDevice]
        : null;
    },
    [DEVICE_FEATURE_TYPES.AIR_CONDITIONING.SWING_HORIZONTAL]: (valueFromDevice) => {
      return Object.prototype.hasOwnProperty.call(
        TUYA_AC_SWING_HORIZONTAL_TO_GLADYS,
        valueFromDevice,
      )
        ? TUYA_AC_SWING_HORIZONTAL_TO_GLADYS[valueFromDevice]
        : null;
    },
    [DEVICE_FEATURE_TYPES.AIR_CONDITIONING.SWING_VERTICAL]: (valueFromDevice) => {
      return Object.prototype.hasOwnProperty.call(TUYA_AC_SWING_VERTICAL_TO_GLADYS, valueFromDevice)
        ? TUYA_AC_SWING_VERTICAL_TO_GLADYS[valueFromDevice]
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
  [DEVICE_FEATURE_CATEGORIES.VACUUM_CLEANER]: {
    [DEVICE_FEATURE_TYPES.VACUUM_CLEANER.STATE]: (valueFromDevice, deviceFeature, mappingEntry) => {
      const tuyaEnum = (mappingEntry && mappingEntry.tuyaEnum) || {};
      return Object.prototype.hasOwnProperty.call(tuyaEnum, valueFromDevice)
        ? tuyaEnum[valueFromDevice]
        : null;
    },
    // Mirrors writeValues[VACUUM_CLEANER][DOCK] above (Gladys 1/0 <-> Tuya
    // boolean). Missing here (and BATTERY.INTEGER below) meant those two
    // features were silently skipped on every poll — getFeatureReader
    // returns null for a category/type with no reader, so the DPS was read
    // but never published — found by the "state.state = value" pipeline
    // (see tuya.poll.js emitFeatureState) simply never running for them.
    [DEVICE_FEATURE_TYPES.VACUUM_CLEANER.DOCK]: (valueFromDevice) => {
      return normalizeBoolean(valueFromDevice) ? 1 : 0;
    },
  },
  [DEVICE_FEATURE_CATEGORIES.BATTERY]: {
    [DEVICE_FEATURE_TYPES.BATTERY.INTEGER]: (valueFromDevice) => {
      const parsedValue = Number(valueFromDevice);
      return Number.isFinite(parsedValue) ? parsedValue : null;
    },
  },
  [DEVICE_FEATURE_CATEGORIES.TEXT]: {
    [DEVICE_FEATURE_TYPES.TEXT.SELECT]: (valueFromDevice) => {
      return valueFromDevice;
    },
  },
  [DEVICE_FEATURE_CATEGORIES.MAINTENANCE]: {
    // Generic: the raw DPS is elapsed usage in seconds (counting UP from 0
    // since the part was last replaced/reset), `mappingEntry.fullLifeSeconds`
    // is the device-type mapping's confirmed full-life reference for THIS
    // component (there is no cloud spec range/unit to read it from — see the
    // Honiture Q6 Pro main brush cross-check in src/devices/vacuum.js).
    // Without a confirmed reference, a mapping must leave this DPS unwired
    // rather than guess one.
    [DEVICE_FEATURE_TYPES.MAINTENANCE.LIFE_REMAINING]: (
      valueFromDevice,
      deviceFeature,
      mappingEntry,
    ) => {
      const fullLifeSeconds = mappingEntry && mappingEntry.fullLifeSeconds;
      const elapsedSeconds = Number(valueFromDevice);
      if (!fullLifeSeconds || !Number.isFinite(elapsedSeconds)) {
        return null;
      }
      const remainingPercent = Math.round(100 - (elapsedSeconds / fullLifeSeconds) * 100);
      return Math.min(100, Math.max(0, remainingPercent));
    },
  },
  [DEVICE_FEATURE_CATEGORIES.SIREN]: {
    // Camera sirens (siren_switch) are plain booleans, like SWITCH.BINARY.
    [DEVICE_FEATURE_TYPES.SIREN.BINARY]: (valueFromDevice) => {
      return normalizeBoolean(valueFromDevice) ? 1 : 0;
    },
  },
  [DEVICE_FEATURE_CATEGORIES.COUNTER_SENSOR]: {
    // Plain counters (e.g. the pet feeder's last amount fed): the raw value,
    // scale-aware like every other numeric sensor. A mapping declaring
    // `jsonValueKey` first extracts that key from a compound record.
    [DEVICE_FEATURE_TYPES.SENSOR.INTEGER]: (valueFromDevice, deviceFeature, mappingEntry) => {
      const rawValue = unwrapRecordValue(valueFromDevice, mappingEntry);
      return rawValue === null ? null : scaleValue(rawValue, deviceFeature, 0);
    },
    [DEVICE_FEATURE_TYPES.SENSOR.DECIMAL]: (valueFromDevice, deviceFeature, mappingEntry) => {
      const rawValue = unwrapRecordValue(valueFromDevice, mappingEntry);
      return rawValue === null ? null : scaleValue(rawValue, deviceFeature, 0);
    },
  },
  // The device's own low-battery verdict (pet feeder `battery_alarm`).
  [DEVICE_FEATURE_CATEGORIES.BATTERY_LOW]: {
    [DEVICE_FEATURE_TYPES.BATTERY_LOW.BINARY]: (valueFromDevice) => {
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
