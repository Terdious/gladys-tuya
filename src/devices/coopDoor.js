// -----------------------------------------------------------------------------
// Device type: CHICKEN COOP DOOR (automatic, solar / battery).
//
// Forum request (@elfedagger): "Chicken Coop Door 2" (product id
// 1gl0ngxpfnchat5a, category `qt`), discovered with no feature. Its
// diagnostic report (1.31.2) reads:
//   gate_state = false        open = false            close = false
//   open_time_switch = false  open_time_set = 330     (05:30)
//   close_time_switch = false close_set_time = 1110   (18:30)
//   light_sensation_switch = false
//   battery_percentage = 75   signal_strength = 100   factory_reset = false
//   Declared value specs (model): battery_percentage / signal_strength
//     0..100 %, open_time_set / close_set_time 0..1439 min
//
// The door is ONE Gladys feature: its position is read on `gate_state`
// (true = open, the Tuya convention for a door state) and driven by the two
// momentary commands `open` / `close` (true starts the move).
//
// Scope — cloud only: a battery / solar door sleeps between two reports.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';

import { globalCloudMapping } from './global.js';

// Codes that identify a coop door (at least one must be exposed).
const COOP_DOOR_CODES = new Set(['gate_state']);

const cloudMapping = {
  // A door discovered before this type existed was created as `unknown`:
  // starting from the global mapping keeps re-discovery additive.
  ...globalCloudMapping,
  ignoredCodes: [
    // The momentary commands behind the door feature (coverCommands below).
    'open',
    'close',
    // Opening / closing times of the schedule, in minutes after midnight
    // (330 = 05:30): no Gladys time-of-day feature yet, kept in the Tuya app.
    'open_time_set',
    'close_set_time',
    // Destructive one-shot command, kept in the Tuya app.
    'factory_reset',
  ],
  gate_state: {
    name: 'Door',
    category: DEVICE_FEATURE_CATEGORIES.CURTAIN,
    type: DEVICE_FEATURE_TYPES.CURTAIN.STATE,
    read_only: false,
    has_feedback: true,
    min: -1,
    max: 1,
    booleanState: true,
    coverCommands: { open: 'open', close: 'close' },
  },
  open_time_switch: {
    name: 'Scheduled opening',
    category: DEVICE_FEATURE_CATEGORIES.SWITCH,
    type: DEVICE_FEATURE_TYPES.SWITCH.BINARY,
  },
  close_time_switch: {
    name: 'Scheduled closing',
    category: DEVICE_FEATURE_CATEGORIES.SWITCH,
    type: DEVICE_FEATURE_TYPES.SWITCH.BINARY,
  },
  // Open at dawn / close at dusk on the door's light sensor.
  light_sensation_switch: {
    name: 'Light sensor mode',
    category: DEVICE_FEATURE_CATEGORIES.SWITCH,
    type: DEVICE_FEATURE_TYPES.SWITCH.BINARY,
  },
  battery_percentage: {
    name: 'Battery',
    category: DEVICE_FEATURE_CATEGORIES.BATTERY,
    type: DEVICE_FEATURE_TYPES.SENSOR.INTEGER,
    unit: DEVICE_FEATURE_UNITS.PERCENT,
  },
  signal_strength: {
    name: 'Signal strength',
    category: DEVICE_FEATURE_CATEGORIES.SIGNAL,
    type: DEVICE_FEATURE_TYPES.SIGNAL.QUALITY,
    unit: DEVICE_FEATURE_UNITS.PERCENT,
    min: 0,
    max: 100,
  },
};

// LAN mapping: intentionally empty (battery / solar device, see the header).
const localMapping = {
  strict: true,
  ignoredDps: [],
  codeAliases: {},
  dps: {},
};

export const coopDoor = {
  DEVICE_TYPE_NAME: 'coop-door',
  CATEGORIES: new Set(),
  PRODUCT_IDS: new Set(['1gl0ngxpfnchat5a']),
  KEYWORDS: ['coop door', 'chicken', 'poulailler', 'hühner', 'gallinero'],
  REQUIRED_CODES: COOP_DOOR_CODES,
  CLOUD_MAPPINGS: cloudMapping,
  LOCAL_MAPPINGS: localMapping,
};
