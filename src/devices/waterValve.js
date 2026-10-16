// -----------------------------------------------------------------------------
// Device type: WATER VALVE / IRRIGATION CONTROLLER (Tuya category `sfkzq`).
//
// Issue #28: R2601 "Valve Controller" (product id p8gyk6h5cdlxboqm), backport
// of GladysAssistant/Gladys#2666. Its diagnostic report (1.23.0) reads:
//   switch = false           valve_status = false     work_state = "auto"
//   battery_percentage = 96  child_lock = true        fault = 0
//   manual_irri_time = 10    irri_instant_flow = 0    irri_flow = 0
//   Declared enum ranges: work_state: auto, manual (status+model)
//   Declared value specs:
//     battery_percentage: 0..100, scale 0, unit % (status+model)
//     manual_irri_time: 0..86400, scale 0, unit min (model)
//     irri_instant_flow / irri_flow: 0..2147483647, scale 2, unit L/min (model)
//
// Phase 1 (this file): open/close, the valve state, battery, child lock,
// watering mode, manual watering duration and the instant flow. The watering
// programs (`water_program1..4`, `manual_water_program`, `irri_time`) are
// base64 binary structures with no published layout: phase 2, if ever.
//
// Scope — cloud only (see LOCAL_MAPPINGS below).
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';

import { globalCloudMapping } from './global.js';

// Codes that identify a Tuya water valve (at least one must be exposed).
const WATER_VALVE_CODES = new Set([
  'valve_status',
  'manual_irri_time',
  'irri_instant_flow',
  'work_state',
]);

const cloudMapping = {
  // A valve discovered before this type existed was created as `unknown` —
  // WITH the global mapping (its `switch`). Starting from it guarantees that
  // re-running the discovery can only ADD features to that device.
  ...globalCloudMapping,
  ignoredCodes: [
    // Watering programs and their schedule: base64 binary structures with no
    // published layout (phase 2).
    'water_program1',
    'water_program2',
    'water_program3',
    'water_program4',
    'manual_water_program',
    'voice_control_program',
    'irri_time',
    'program_num',
    // Declared in L/min like the instant flow but reads like the volume of a
    // watering cycle: published once its meaning is confirmed on a device.
    'irri_flow',
    // Rain delay: the duration has no declared unit (hours or days?), and the
    // quick toggle's effect is undocumented. Kept in the Tuya app for now.
    'rain_delay',
    'quick_rain_delay',
    // Weather hint the app pushes to the device, not a reading.
    'smart_weather',
    // Bitmap of the device alarms: a raw bitmask nobody can read without the
    // per-product bit labels.
    'fault',
    // Encrypted payload.
    'hydraulic_pressure',
    // Firmware / housekeeping values.
    'app_features',
    'support_features',
    'dev_state',
    'dev_token',
    'temp_mode_flag',
    'unix_time',
    'log_server_port',
    'log_server_url',
    'mfg_model',
    'soft_ver',
  ],
  // Opens / closes the valve (a manual watering: the device closes it on its
  // own after the manual watering duration below).
  switch: {
    name: 'Valve',
    category: DEVICE_FEATURE_CATEGORIES.SWITCH,
    type: DEVICE_FEATURE_TYPES.SWITCH.BINARY,
  },
  // Whether water is actually flowing (the valve reports it, whatever opened
  // it: the switch, a program, the button on the device).
  valve_status: {
    name: 'Valve open',
    category: DEVICE_FEATURE_CATEGORIES.WATER_VALVE,
    type: DEVICE_FEATURE_TYPES.WATER_VALVE.VALVE_WORK_STATE,
    read_only: true,
    min: 0,
    max: 1,
  },
  // Instant flow, declared in L/min with 2 decimals: Gladys expects m³/h for
  // this type, `litersPerMinute` makes the reader convert (1 L/min = 0.06 m³/h).
  irri_instant_flow: {
    name: 'Water flow',
    category: DEVICE_FEATURE_CATEGORIES.WATER_VALVE,
    type: DEVICE_FEATURE_TYPES.WATER_VALVE.FLOW,
    unit: DEVICE_FEATURE_UNITS.CUBIC_METER_PER_HOUR,
    scale: 2,
    litersPerMinute: true,
    read_only: true,
  },
  manual_irri_time: {
    name: 'Manual watering duration',
    category: DEVICE_FEATURE_CATEGORIES.DURATION,
    type: DEVICE_FEATURE_TYPES.DURATION.INTEGER,
    unit: DEVICE_FEATURE_UNITS.MINUTES,
    read_only: true,
  },
  // Auto (follows the programs) / manual, as the device reports it.
  work_state: {
    name: 'Watering mode',
    category: DEVICE_FEATURE_CATEGORIES.TEXT,
    type: DEVICE_FEATURE_TYPES.TEXT.SELECT,
    keep_history: false,
    read_only: true,
    selectOptionsFromRange: true,
    selectLabels: {
      auto: 'Auto',
      manual: 'Manual',
    },
  },
  battery_percentage: {
    name: 'Battery',
    category: DEVICE_FEATURE_CATEGORIES.BATTERY,
    type: DEVICE_FEATURE_TYPES.BATTERY.INTEGER,
    unit: DEVICE_FEATURE_UNITS.PERCENT,
  },
  child_lock: {
    name: 'Child lock',
    category: DEVICE_FEATURE_CATEGORIES.CHILD_LOCK,
    type: DEVICE_FEATURE_TYPES.CHILD_LOCK.BINARY,
  },
};

// LAN mapping: intentionally empty. The valve runs on batteries and its LAN
// DPS layout is unknown (no local snapshot yet): `strict: true` keeps every
// feature on the cloud even with local mode on.
const localMapping = {
  strict: true,
  ignoredDps: [],
  codeAliases: {},
  dps: {},
};

export const waterValve = {
  DEVICE_TYPE_NAME: 'water-valve',
  CATEGORIES: new Set(['sfkzq']),
  PRODUCT_IDS: new Set(['p8gyk6h5cdlxboqm']),
  // Matched against the device name/model, and only for a device that also
  // exposes one of the codes above.
  KEYWORDS: ['valve', 'vanne', 'irrigation', 'arrosage', 'sprinkler'],
  REQUIRED_CODES: WATER_VALVE_CODES,
  CLOUD_MAPPINGS: cloudMapping,
  LOCAL_MAPPINGS: localMapping,
};
