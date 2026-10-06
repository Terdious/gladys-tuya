// -----------------------------------------------------------------------------
// Device type: DEHUMIDIFIER (Tuya dehumidifier, category `cs`).
//
// Requested in issue #39: a Qlima D825A (category `cs`) discovered with its
// on/off switch only. The reporter asked for the timer, the fan speed, the
// current humidity and the current temperature. Their exact payload was
// posted as screenshots, which this mapping could not be checked against:
// the codes below are the standard `cs` instruction set
// (developer.tuya.com/en/docs/iot/categorycs, cross-checked against the Home
// Assistant Tuya integration). A model naming a code differently shows it as
// UNMANAGED in the "Device diagnostic" report, which is what to ask for.
//
// The three Tuya enums of a dehumidifier (fan speed, timer, mode) have a
// different vocabulary on every product (["low","high"], ["low","mid","high"],
// ["cancel","1h","2h","4h"]...). They are TEXT/SELECT features whose options
// are built from the range the device declares (`selectOptionsFromRange`):
// the Gladys value is the raw device string, so a write sends back exactly
// what the device expects. TEXT/SELECT needs Gladys core >= 4.86.1 — the
// minimum the manifest requires; on an older core those features are left
// out (see tuya.convertFeature.js), the rest still works.
//
// Scope — cloud only (see LOCAL_MAPPINGS below).
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';

import { globalCloudMapping } from './global.js';

// Codes that identify a Tuya dehumidifier (at least one must be exposed). A
// plain `switch` is not enough: every Tuya device has one.
const DEHUMIDIFIER_CODES = new Set([
  'dehumidify_set_value',
  'dehumidify_set_enum',
  'humidity_indoor',
  'fan_speed_enum',
  'countdown_set',
  'countdown_left',
  'temp_indoor',
]);

// Curated labels for the values seen across `cs` products; any other value
// gets a readable fallback ("level_2" -> "Level 2") and keeps its raw string.
const SELECT_LABELS = {
  low: 'Low',
  mid: 'Medium',
  middle: 'Medium',
  high: 'High',
  strong: 'Strong',
  auto: 'Auto',
  sleep: 'Sleep',
  manual: 'Manual',
  cancel: 'Off',
};

const cloudMapping = {
  // A device-type mapping REPLACES the global one, and a dehumidifier
  // discovered before this type existed was created as `unknown` — WITH the
  // global mapping. Starting from it guarantees that re-running the discovery
  // can only ADD features to those devices, never drop one.
  ...globalCloudMapping,
  ignoredCodes: [
    // Target humidity as an integer percentage: Gladys has no humidity
    // setpoint feature type (core and SDK), and a TEXT/SELECT would write a
    // string to an Integer DP. Its enum twin below IS exposed.
    'dehumidify_set_value',
    // Bitmap of the device alarms (tank full, defrost, sensor faults): a raw
    // bitmask nobody can read. The tank-full flag is the useful one; it needs
    // the per-product bit labels, i.e. a diagnostic dump.
    'fault',
    // One-shot maintenance commands.
    'filter_reset',
  ],
  switch: {
    name: 'On/off',
    category: DEVICE_FEATURE_CATEGORIES.SWITCH,
    type: DEVICE_FEATURE_TYPES.SWITCH.BINARY,
  },
  humidity_indoor: {
    name: 'Humidity',
    category: DEVICE_FEATURE_CATEGORIES.HUMIDITY_SENSOR,
    type: DEVICE_FEATURE_TYPES.SENSOR.DECIMAL,
    unit: DEVICE_FEATURE_UNITS.PERCENT,
  },
  temp_indoor: {
    name: 'Temperature',
    category: DEVICE_FEATURE_CATEGORIES.TEMPERATURE_SENSOR,
    type: DEVICE_FEATURE_TYPES.SENSOR.DECIMAL,
    unit: DEVICE_FEATURE_UNITS.CELSIUS,
  },
  fan_speed_enum: {
    name: 'Fan speed',
    category: DEVICE_FEATURE_CATEGORIES.TEXT,
    type: DEVICE_FEATURE_TYPES.TEXT.SELECT,
    keep_history: false,
    selectOptionsFromRange: true,
    selectLabels: SELECT_LABELS,
  },
  // The timer: its range is the list of durations the device offers
  // (["cancel","1h","2h"...]); "cancel" stops it.
  countdown_set: {
    name: 'Timer',
    category: DEVICE_FEATURE_CATEGORIES.TEXT,
    type: DEVICE_FEATURE_TYPES.TEXT.SELECT,
    keep_history: false,
    selectOptionsFromRange: true,
    selectLabels: SELECT_LABELS,
  },
  // Time left on the timer, in minutes (0 when none is running).
  countdown_left: {
    name: 'Timer remaining',
    category: DEVICE_FEATURE_CATEGORIES.DURATION,
    type: DEVICE_FEATURE_TYPES.DURATION.INTEGER,
    unit: DEVICE_FEATURE_UNITS.MINUTES,
    keep_history: false,
  },
  mode: {
    name: 'Mode',
    category: DEVICE_FEATURE_CATEGORIES.TEXT,
    type: DEVICE_FEATURE_TYPES.TEXT.SELECT,
    keep_history: false,
    selectOptionsFromRange: true,
    selectLabels: SELECT_LABELS,
  },
  // Target humidity offered as a list of steps (["40","45",...]): a string
  // enum, so a TEXT/SELECT writes it back as the device declares it.
  dehumidify_set_enum: {
    name: 'Target humidity',
    category: DEVICE_FEATURE_CATEGORIES.TEXT,
    type: DEVICE_FEATURE_TYPES.TEXT.SELECT,
    keep_history: false,
    selectOptionsFromRange: true,
  },
  child_lock: {
    name: 'Child lock',
    category: DEVICE_FEATURE_CATEGORIES.CHILD_LOCK,
    type: DEVICE_FEATURE_TYPES.CHILD_LOCK.BINARY,
  },
  anion: {
    name: 'Ionizer',
    category: DEVICE_FEATURE_CATEGORIES.SWITCH,
    type: DEVICE_FEATURE_TYPES.SWITCH.BINARY,
  },
};

// LAN mapping: intentionally empty, like the fan and the pet feeder — the DPS
// indexes are product-specific and no dump of a supported dehumidifier is
// available. `strict: true` sends every feature through the cloud, even with
// local mode on. A "Device diagnostic" report is all it takes to fill it in.
const localMapping = {
  strict: true,
  ignoredDps: [],
  codeAliases: {},
  dps: {},
};

export const dehumidifier = {
  DEVICE_TYPE_NAME: 'dehumidifier',
  CATEGORIES: new Set(['cs']),
  PRODUCT_IDS: new Set(),
  // Matched against the device name/model, and only for a device that also
  // exposes one of the codes above.
  KEYWORDS: ['dehumidifier', 'deshumidificateur', 'déshumidificateur'],
  REQUIRED_CODES: DEHUMIDIFIER_CODES,
  CLOUD_MAPPINGS: cloudMapping,
  LOCAL_MAPPINGS: localMapping,
};
