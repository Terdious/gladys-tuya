// -----------------------------------------------------------------------------
// Device type: MOTION SENSOR (Tuya category `pir`, PIR motion / luminance).
//
// Issue #70: Zigbee "Luminance Motion sensor" (product id 3towulqd) behind a
// Tuya Zigbee gateway, discovered with no feature. Its diagnostic report
// (1.28.0) reads:
//   pir = "none"             pir_state = "none"       illuminance_value = 0
//   battery_percentage = 100 pir_sensitivity = "middle"
//   pir_time = "10S"         interval_time = 720
//   Declared enum ranges: pir: pir, none (status) | pir_state: pir, none
//     (model) | pir_sensitivity: low, middle, high | pir_time: 10S, 30S, 60S,
//     120S (model)
//   Declared value specs: battery_percentage 0..100 %, illuminance_value
//     0..10000 lux, interval_time 1..720 min (model)
//
// Scope — cloud only: a Zigbee sub-device is reached through its gateway,
// never directly on the LAN (see LOCAL_MAPPINGS below).
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';

import { globalCloudMapping } from './global.js';

// Codes that identify a Tuya motion sensor (at least one must be exposed).
const MOTION_SENSOR_CODES = new Set(['pir', 'pir_state']);

// The detection is an enum: `pir` while a motion is seen, `none` otherwise.
const PIR_TO_MOTION = {
  pir: 1,
  none: 0,
};

// A writable sensor setting shown as a list (TEXT/SELECT).
const sensorSetting = (name, selectLabels) => ({
  name,
  category: DEVICE_FEATURE_CATEGORIES.TEXT,
  type: DEVICE_FEATURE_TYPES.TEXT.SELECT,
  keep_history: false,
  selectOptionsFromRange: true,
  selectLabels,
});

const cloudMapping = {
  // A sensor discovered before this type existed was created as `unknown`:
  // starting from the global mapping keeps re-discovery additive.
  ...globalCloudMapping,
  ignoredCodes: [
    // Report period of the illuminance (minutes): a radio / battery trade-off
    // tuned once in the Tuya app.
    'interval_time',
  ],
  pir: {
    name: 'Motion',
    category: DEVICE_FEATURE_CATEGORIES.MOTION_SENSOR,
    type: DEVICE_FEATURE_TYPES.SENSOR.BINARY,
    tuyaEnum: PIR_TO_MOTION,
  },
  // Some models report the same detection under `pir_state` too (the model
  // declares it, the status reads the same value): one feature, not two.
  pir_state: {
    name: 'Motion',
    category: DEVICE_FEATURE_CATEGORIES.MOTION_SENSOR,
    type: DEVICE_FEATURE_TYPES.SENSOR.BINARY,
    tuyaEnum: PIR_TO_MOTION,
    duplicateOf: 'pir',
  },
  illuminance_value: {
    name: 'Illuminance',
    category: DEVICE_FEATURE_CATEGORIES.LIGHT_SENSOR,
    type: DEVICE_FEATURE_TYPES.SENSOR.DECIMAL,
    unit: DEVICE_FEATURE_UNITS.LUX,
    scale: 0,
  },
  battery_percentage: {
    name: 'Battery',
    category: DEVICE_FEATURE_CATEGORIES.BATTERY,
    type: DEVICE_FEATURE_TYPES.SENSOR.INTEGER,
    unit: DEVICE_FEATURE_UNITS.PERCENT,
  },
  pir_sensitivity: sensorSetting('Motion sensitivity', {
    low: 'Low',
    middle: 'Medium',
    high: 'High',
  }),
  // How long a detection is held before the sensor reports `none` again.
  pir_time: sensorSetting('Hold time', {
    '10S': '10 s',
    '30S': '30 s',
    '60S': '60 s',
    '120S': '120 s',
  }),
};

// LAN mapping: intentionally empty. A Zigbee sub-device has no IP of its own
// (its gateway relays it) and battery sensors sleep between two reports:
// `strict: true` keeps every feature on the cloud even with local mode on.
const localMapping = {
  strict: true,
  ignoredDps: [],
  codeAliases: {},
  dps: {},
};

export const motionSensor = {
  DEVICE_TYPE_NAME: 'motion-sensor',
  CATEGORIES: new Set(['pir']),
  PRODUCT_IDS: new Set(['3towulqd']),
  KEYWORDS: ['motion sensor', 'pir', 'détecteur de mouvement', 'detecteur de mouvement'],
  REQUIRED_CODES: MOTION_SENSOR_CODES,
  CLOUD_MAPPINGS: cloudMapping,
  LOCAL_MAPPINGS: localMapping,
};
