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
// Mirror of the core FAN_AIRFLOW_DIRECTION constant (server/utils/constants.js).
import { FAN_AIRFLOW_DIRECTION } from '../../devices/fan.js';

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
// vary a lot (many lack quiet/turbo): for the fan speed and the swings the
// spec enum range is the per-device truth — there is no curated per-variant
// vocabulary like the pilot wire, the maps above cover every known alias.
export const AC_SUPPORTED_OPTION_SOURCES = {
  // The MODE is the exception: it always offers the five Gladys modes.
  // Narrowing it by the spec range (1.11.0 → 1.16.0) hid Heating and Fan on
  // units that heat and ventilate fine (bench report, "Bureau TLT"): the
  // range the cloud returns for `mode` is not reliable enough to REMOVE a
  // mode, and a missing mode cannot be reached at all, whereas a mode the
  // unit really lacks (a cold-only unit asked to heat) is simply refused by
  // the device. Same five modes as before 1.11.0, published explicitly so the
  // core replaces the narrowed list it stored.
  [DEVICE_FEATURE_TYPES.AIR_CONDITIONING.MODE]: {
    narrowBySpecRange: false,
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

// The Tuya string each Gladys AC value is written as when the device declares
// no range (or none of its values matches): the most common spelling.
const AC_DEFAULT_TUYA_VALUES = {
  [DEVICE_FEATURE_TYPES.AIR_CONDITIONING.MODE]: GLADYS_AC_MODE_TO_TUYA,
  [DEVICE_FEATURE_TYPES.AIR_CONDITIONING.FAN_SPEED]: GLADYS_AC_FAN_SPEED_TO_TUYA,
  [DEVICE_FEATURE_TYPES.AIR_CONDITIONING.SWING_HORIZONTAL]: GLADYS_AC_SWING_HORIZONTAL_TO_TUYA,
  [DEVICE_FEATURE_TYPES.AIR_CONDITIONING.SWING_VERTICAL]: GLADYS_AC_SWING_VERTICAL_TO_TUYA,
};

// Fan speeds declared as bare levels ("1","2"... e.g. the MEDION P502 camping
// AC): spread over the Gladys scale by count, lowest level first.
const AC_FAN_SPEED_LEVELS = {
  1: [AC_FAN_SPEED.MID],
  2: [AC_FAN_SPEED.LOW, AC_FAN_SPEED.HIGH],
  3: [AC_FAN_SPEED.LOW, AC_FAN_SPEED.MID, AC_FAN_SPEED.HIGH],
  4: [AC_FAN_SPEED.LOW, AC_FAN_SPEED.LOW_MID, AC_FAN_SPEED.MID_HIGH, AC_FAN_SPEED.HIGH],
  5: [
    AC_FAN_SPEED.LOW,
    AC_FAN_SPEED.LOW_MID,
    AC_FAN_SPEED.MID,
    AC_FAN_SPEED.MID_HIGH,
    AC_FAN_SPEED.HIGH,
  ],
};

const getNumericFanLevels = (range) => {
  if (!Array.isArray(range) || range.length === 0) {
    return null;
  }
  const values = [...new Set(range.map(String))];
  if (!values.every((value) => /^\d+$/.test(value))) {
    return null;
  }
  const levels = values.sort((a, b) => Number(a) - Number(b));
  const speeds = AC_FAN_SPEED_LEVELS[levels.length];
  return speeds ? { levels, speeds } : null;
};

/**
 * @description Gladys value of a Tuya AC enum value. Case-insensitive (some
 * firmwares send "COOL"), and a fan speed declared as bare levels ("1","2")
 * is resolved through the device's own range.
 * @param {string} featureType - AIR_CONDITIONING.MODE / FAN_SPEED / SWING_*.
 * @param {*} tuyaValue - The value the device reports.
 * @param {Array} [range] - The enum range the device declares, when known.
 * @returns {number|undefined} The Gladys value, undefined when unknown.
 * @example
 * tuyaToGladysAcValue(DEVICE_FEATURE_TYPES.AIR_CONDITIONING.MODE, 'COOL'); // AC_MODE.COOLING
 */
export const tuyaToGladysAcValue = (featureType, tuyaValue, range) => {
  const source = AC_SUPPORTED_OPTION_SOURCES[featureType];
  if (!source || tuyaValue === null || tuyaValue === undefined) {
    return undefined;
  }
  const key = String(tuyaValue);
  const { vocabulary } = source;
  if (Object.prototype.hasOwnProperty.call(vocabulary, key)) {
    return vocabulary[key];
  }
  const lower = key.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(vocabulary, lower)) {
    return vocabulary[lower];
  }
  if (featureType === DEVICE_FEATURE_TYPES.AIR_CONDITIONING.FAN_SPEED) {
    const numeric = getNumericFanLevels(range);
    const index = numeric ? numeric.levels.indexOf(key) : -1;
    if (index !== -1) {
      return numeric.speeds[index];
    }
  }
  return undefined;
};

/**
 * @description Tuya value to write for a Gladys AC enum value: the device's
 * own spelling when its range is known ("COOL", "2"), the common spelling
 * otherwise (unchanged behaviour for a device without a stored range).
 * @param {string} featureType - AIR_CONDITIONING.MODE / FAN_SPEED / SWING_*.
 * @param {*} gladysValue - The Gladys value.
 * @param {Array} [range] - The enum range the device declares, when known.
 * @returns {string|undefined} The Tuya value, undefined when unreachable.
 * @example
 * gladysToTuyaAcValue(DEVICE_FEATURE_TYPES.AIR_CONDITIONING.MODE, 1, ['COOL']); // 'COOL'
 */
export const gladysToTuyaAcValue = (featureType, gladysValue, range) => {
  const parsedValue = parseInt(gladysValue, 10);
  if (Array.isArray(range) && range.length > 0) {
    const match = range.find(
      (tuyaValue) => tuyaToGladysAcValue(featureType, tuyaValue, range) === parsedValue,
    );
    if (match !== undefined) {
      return String(match);
    }
  }
  const defaults = AC_DEFAULT_TUYA_VALUES[featureType];
  return defaults ? defaults[parsedValue] : undefined;
};

// Build the supported_options of an AC enum feature from the spec range (full
// vocabulary without one, or for a type that is never narrowed); returns null
// for non-enum AC feature types (binary, target temperature...).
export const buildAcSupportedOptions = (featureType, range) => {
  const source = AC_SUPPORTED_OPTION_SOURCES[featureType];
  if (!source) {
    return null;
  }
  const useRange = source.narrowBySpecRange !== false && Array.isArray(range) && range.length > 0;
  if (!useRange) {
    return buildSupportedOptionsFromVocabulary(
      source.vocabulary,
      Object.keys(source.vocabulary),
      source.labels,
    );
  }
  const supportedValues = [
    ...new Set(
      range
        .map((tuyaValue) => tuyaToGladysAcValue(featureType, tuyaValue, range))
        .filter((value) => value !== undefined),
    ),
  ].sort((a, b) => a - b);
  return supportedValues.map((value, index) => ({
    value,
    label: source.labels[value] || String(value),
    sort_order: index,
  }));
};

// Mirror of the core CAMERA_MOVE constant (server/utils/constants.js, spec
// docs/specs/camera-ptz-control.md): the values of a `camera.move` feature.
// STOP is always supported and never listed as an option.
export const CAMERA_MOVE = {
  STOP: 0,
  PAN_LEFT: 1,
  PAN_RIGHT: 2,
  TILT_UP: 3,
  TILT_DOWN: 4,
  ZOOM_IN: 5,
  ZOOM_OUT: 6,
};

// Tuya `ptz_control` (standard `sp` instruction set): the 8 directions as
// "0".."7", clockwise from up (0 up, 2 right, 4 down, 6 left; the odd values
// are the diagonals, which the Gladys v1 contract does not model). Both LSC
// PTZ diagnostics (issue #26) declare exactly this range.
export const TUYA_PTZ_DIRECTION_BY_MOVE = {
  [CAMERA_MOVE.TILT_UP]: '0',
  [CAMERA_MOVE.PAN_RIGHT]: '2',
  [CAMERA_MOVE.TILT_DOWN]: '4',
  [CAMERA_MOVE.PAN_LEFT]: '6',
};

// English labels of the movement options (the front draws arrows; labels only
// show in label-based surfaces such as the scene editor).
export const CAMERA_MOVE_LABELS = {
  [CAMERA_MOVE.PAN_LEFT]: 'Pan left',
  [CAMERA_MOVE.PAN_RIGHT]: 'Pan right',
  [CAMERA_MOVE.TILT_UP]: 'Tilt up',
  [CAMERA_MOVE.TILT_DOWN]: 'Tilt down',
};

/**
 * @description The movements a Tuya PTZ camera supports: the Gladys moves
 * whose Tuya direction is in the `ptz_control` range it declares (the four
 * pan/tilt moves when it declares no range).
 * @param {Array} [range] - The declared `ptz_control` enum range.
 * @returns {Array} supported_options of the `camera.move` feature.
 * @example
 * buildCameraMoveSupportedOptions(['0', '2', '4', '6']);
 */
export const buildCameraMoveSupportedOptions = (range) => {
  const declared = Array.isArray(range) && range.length > 0 ? range.map(String) : null;
  return Object.entries(TUYA_PTZ_DIRECTION_BY_MOVE)
    .filter(([, direction]) => !declared || declared.includes(direction))
    .map(([move]) => Number(move))
    .sort((a, b) => a - b)
    .map((move, index) => ({ value: move, label: CAMERA_MOVE_LABELS[move], sort_order: index }));
};

// Tuya fan airflow-direction vocabulary -> Gladys FAN_AIRFLOW_DIRECTION. The
// documented `fan_direction` range is ["forward","reverse"]; `positive` /
// `negative` are the two aliases seen on other firmwares. Unlike the fan speed
// enum (see the `ignoredCodes` note in src/devices/fan.js), this code has a
// single vocabulary across products, so a write can send the right string
// without knowing the per-device spec range.
const TUYA_FAN_DIRECTION_TO_GLADYS = {
  forward: FAN_AIRFLOW_DIRECTION.FORWARD,
  positive: FAN_AIRFLOW_DIRECTION.FORWARD,
  reverse: FAN_AIRFLOW_DIRECTION.REVERSE,
  negative: FAN_AIRFLOW_DIRECTION.REVERSE,
};

const GLADYS_FAN_DIRECTION_TO_TUYA = {
  [FAN_AIRFLOW_DIRECTION.FORWARD]: 'forward',
  [FAN_AIRFLOW_DIRECTION.REVERSE]: 'reverse',
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
    // The device's own spelling when its range is known (`specRange`,
    // restored from the AC_ENUM_RANGES param by tuya.poll.js).
    [DEVICE_FEATURE_TYPES.AIR_CONDITIONING.MODE]: (valueFromGladys, deviceFeature) =>
      gladysToTuyaAcValue(
        DEVICE_FEATURE_TYPES.AIR_CONDITIONING.MODE,
        valueFromGladys,
        deviceFeature && deviceFeature.specRange,
      ),
    [DEVICE_FEATURE_TYPES.AIR_CONDITIONING.FAN_SPEED]: (valueFromGladys, deviceFeature) =>
      gladysToTuyaAcValue(
        DEVICE_FEATURE_TYPES.AIR_CONDITIONING.FAN_SPEED,
        valueFromGladys,
        deviceFeature && deviceFeature.specRange,
      ),
    [DEVICE_FEATURE_TYPES.AIR_CONDITIONING.SWING_HORIZONTAL]: (valueFromGladys, deviceFeature) =>
      gladysToTuyaAcValue(
        DEVICE_FEATURE_TYPES.AIR_CONDITIONING.SWING_HORIZONTAL,
        valueFromGladys,
        deviceFeature && deviceFeature.specRange,
      ),
    [DEVICE_FEATURE_TYPES.AIR_CONDITIONING.SWING_VERTICAL]: (valueFromGladys, deviceFeature) =>
      gladysToTuyaAcValue(
        DEVICE_FEATURE_TYPES.AIR_CONDITIONING.SWING_VERTICAL,
        valueFromGladys,
        deviceFeature && deviceFeature.specRange,
      ),
    [DEVICE_FEATURE_TYPES.AIR_CONDITIONING.TARGET_TEMPERATURE]: (
      valueFromGladys,
      deviceFeature,
    ) => {
      // A device declaring scale 1 stores 20.0 degrees as 200.
      return unscaleValue(valueFromGladys, deviceFeature, 0);
    },
  },

  [DEVICE_FEATURE_CATEGORIES.FAN]: {
    // The speed DP is a plain integer (1..3 levels on the reported ventilation
    // unit, 1..100 on a fan that really is a percentage): the Gladys value IS
    // the device level, sent back as it is — honouring a declared scale like
    // every other numeric DP.
    [DEVICE_FEATURE_TYPES.FAN.SPEED]: (valueFromGladys, deviceFeature) => {
      return unscaleValue(valueFromGladys, deviceFeature, 0);
    },
    // Returns undefined for a value outside the vocabulary: setValue rejects
    // it instead of sending garbage to the device.
    [DEVICE_FEATURE_TYPES.FAN.AIRFLOW_DIRECTION]: (valueFromGladys) => {
      const parsedValue = parseInt(valueFromGladys, 10);
      return GLADYS_FAN_DIRECTION_TO_TUYA[parsedValue];
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

const readAcEnum = (featureType, valueFromDevice, deviceFeature) => {
  const value = tuyaToGladysAcValue(
    featureType,
    valueFromDevice,
    deviceFeature && deviceFeature.specRange,
  );
  return value === undefined ? null : value;
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
    [DEVICE_FEATURE_TYPES.AIR_CONDITIONING.MODE]: (valueFromDevice, deviceFeature) =>
      readAcEnum(DEVICE_FEATURE_TYPES.AIR_CONDITIONING.MODE, valueFromDevice, deviceFeature),
    [DEVICE_FEATURE_TYPES.AIR_CONDITIONING.FAN_SPEED]: (valueFromDevice, deviceFeature) =>
      readAcEnum(DEVICE_FEATURE_TYPES.AIR_CONDITIONING.FAN_SPEED, valueFromDevice, deviceFeature),
    [DEVICE_FEATURE_TYPES.AIR_CONDITIONING.SWING_HORIZONTAL]: (valueFromDevice, deviceFeature) =>
      readAcEnum(
        DEVICE_FEATURE_TYPES.AIR_CONDITIONING.SWING_HORIZONTAL,
        valueFromDevice,
        deviceFeature,
      ),
    [DEVICE_FEATURE_TYPES.AIR_CONDITIONING.SWING_VERTICAL]: (valueFromDevice, deviceFeature) =>
      readAcEnum(
        DEVICE_FEATURE_TYPES.AIR_CONDITIONING.SWING_VERTICAL,
        valueFromDevice,
        deviceFeature,
      ),
    [DEVICE_FEATURE_TYPES.AIR_CONDITIONING.TARGET_TEMPERATURE]: (
      valueFromDevice,
      deviceFeature,
    ) => {
      return scaleValue(valueFromDevice, deviceFeature, 0);
    },
  },
  [DEVICE_FEATURE_CATEGORIES.FAN]: {
    [DEVICE_FEATURE_TYPES.FAN.SPEED]: (valueFromDevice, deviceFeature) => {
      const parsedValue = scaleValue(valueFromDevice, deviceFeature, 0);
      return Number.isFinite(parsedValue) ? parsedValue : null;
    },
    [DEVICE_FEATURE_TYPES.FAN.AIRFLOW_DIRECTION]: (valueFromDevice) => {
      const normalized = String(valueFromDevice).trim().toLowerCase();
      return Object.prototype.hasOwnProperty.call(TUYA_FAN_DIRECTION_TO_GLADYS, normalized)
        ? TUYA_FAN_DIRECTION_TO_GLADYS[normalized]
        : null;
    },
  },
  [DEVICE_FEATURE_CATEGORIES.TEMPERATURE_SENSOR]: {
    [DEVICE_FEATURE_TYPES.SENSOR.DECIMAL]: (valueFromDevice, deviceFeature) => {
      return scaleValue(valueFromDevice, deviceFeature, 0);
    },
  },
  // A motion detection reported as an enum (`pir` sensors: "pir" / "none"),
  // translated through the mapping's tuyaEnum. Without one (the camera motion
  // event, fired by the media handler) the poll publishes nothing.
  [DEVICE_FEATURE_CATEGORIES.MOTION_SENSOR]: {
    [DEVICE_FEATURE_TYPES.SENSOR.BINARY]: (valueFromDevice, deviceFeature, mappingEntry) => {
      const tuyaEnum = mappingEntry && mappingEntry.tuyaEnum;
      if (!tuyaEnum || typeof valueFromDevice !== 'string') {
        return null;
      }
      const normalized = valueFromDevice.trim().toLowerCase();
      return Object.prototype.hasOwnProperty.call(tuyaEnum, normalized)
        ? tuyaEnum[normalized]
        : null;
    },
  },
  // Illuminance in lux (`pir` sensors), scale-aware.
  [DEVICE_FEATURE_CATEGORIES.LIGHT_SENSOR]: {
    [DEVICE_FEATURE_TYPES.SENSOR.DECIMAL]: (valueFromDevice, deviceFeature) => {
      const parsedValue = scaleValue(valueFromDevice, deviceFeature, 0);
      return Number.isFinite(parsedValue) ? parsedValue : null;
    },
  },
  // A device's own temperature (three-phase clamp `Temperature`).
  [DEVICE_FEATURE_CATEGORIES.DEVICE_TEMPERATURE_SENSOR]: {
    [DEVICE_FEATURE_TYPES.SENSOR.DECIMAL]: (valueFromDevice, deviceFeature) => {
      const parsedValue = scaleValue(valueFromDevice, deviceFeature, 0);
      return Number.isFinite(parsedValue) ? parsedValue : null;
    },
  },
  // Ambient humidity (dehumidifier `humidity_indoor`), scale-aware like the
  // temperatures.
  [DEVICE_FEATURE_CATEGORIES.HUMIDITY_SENSOR]: {
    [DEVICE_FEATURE_TYPES.SENSOR.DECIMAL]: (valueFromDevice, deviceFeature) => {
      const parsedValue = scaleValue(valueFromDevice, deviceFeature, 0);
      return Number.isFinite(parsedValue) ? parsedValue : null;
    },
  },
  // Remaining time of a timer (dehumidifier `countdown_left`, in minutes).
  [DEVICE_FEATURE_CATEGORIES.DURATION]: {
    [DEVICE_FEATURE_TYPES.DURATION.INTEGER]: (valueFromDevice, deviceFeature) => {
      const parsedValue = scaleValue(valueFromDevice, deviceFeature, 0);
      return Number.isFinite(parsedValue) ? parsedValue : null;
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
  [DEVICE_FEATURE_CATEGORIES.WATER_VALVE]: {
    [DEVICE_FEATURE_TYPES.WATER_VALVE.VALVE_WORK_STATE]: (valueFromDevice) => {
      return normalizeBoolean(valueFromDevice) ? 1 : 0;
    },
    // Gladys expects m³/h; a mapping declaring `litersPerMinute` reads a DP in
    // L/min (the Tuya valves), converted here (1 L/min = 0.06 m³/h).
    [DEVICE_FEATURE_TYPES.WATER_VALVE.FLOW]: (valueFromDevice, deviceFeature, mappingEntry) => {
      const flow = scaleValue(valueFromDevice, deviceFeature, 0);
      if (!Number.isFinite(flow)) {
        return null;
      }
      return mappingEntry && mappingEntry.litersPerMinute
        ? Math.round(flow * 0.06 * 10000) / 10000
        : flow;
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
    // A mapping declaring `percentRemaining` reads a DP that already IS the
    // remaining life in percent (water purifier filter stages): the value is
    // only clamped to 0..100.
    [DEVICE_FEATURE_TYPES.MAINTENANCE.LIFE_REMAINING]: (
      valueFromDevice,
      deviceFeature,
      mappingEntry,
    ) => {
      if (mappingEntry && mappingEntry.percentRemaining === true) {
        const percent = Number(valueFromDevice);
        return Number.isFinite(percent) ? Math.min(100, Math.max(0, Math.round(percent))) : null;
      }
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
  // The device's own low-battery verdict: a boolean flag (pet feeder
  // `battery_alarm`), or a battery LEVEL enum translated through the mapping's
  // tuyaEnum (wsdcg `battery_state`: low/middle/high). A level outside the
  // declared vocabulary publishes nothing rather than a wrong flag.
  [DEVICE_FEATURE_CATEGORIES.BATTERY_LOW]: {
    [DEVICE_FEATURE_TYPES.BATTERY_LOW.BINARY]: (valueFromDevice, deviceFeature, mappingEntry) => {
      const tuyaEnum = mappingEntry && mappingEntry.tuyaEnum;
      if (tuyaEnum && typeof tuyaEnum === 'object' && typeof valueFromDevice === 'string') {
        const normalized = valueFromDevice.trim().toLowerCase();
        return Object.prototype.hasOwnProperty.call(tuyaEnum, normalized)
          ? tuyaEnum[normalized]
          : null;
      }
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
