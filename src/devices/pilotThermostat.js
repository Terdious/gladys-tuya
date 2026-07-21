// -----------------------------------------------------------------------------
// Device type: PILOT THERMOSTAT (French "fil pilote" heating controllers).
//
// Ported from the core PR8 branch (tuya-pilot-thermostat-support):
// lib/mappings/cloud/pilot-thermostat.js, cloud/pilot-thermostat-ecosy.js and
// their local counterparts. The family default is the RP5-style thermostat
// (product c03zek9b5daz7omr); the Konyks eCosy is a per-product VARIANT with
// its own DP layout and mode vocabulary (tuya-local pattern: a variant fully
// REPLACES the family mapping, no merge).
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';

// Mirror of the core PILOT_WIRE_MODE constant (server/utils/constants.js).
// PROGRAMMING and THERMOSTAT are additions of the upstream PR8 (not yet on
// core master): publishing those values is harmless, the frontend simply has
// no label for them until the upstream PR lands.
export const PILOT_WIRE_MODE = {
  OFF: 0,
  FROST_PROTECTION: 1,
  ECO: 2,
  COMFORT_1: 3,
  COMFORT_2: 4,
  COMFORT: 5,
  PROGRAMMING: 6,
  THERMOSTAT: 7,
};

const cloudMapping = {
  ignoredCodes: [
    'week_program_1',
    'week_program_2',
    'week_program_3',
    'week_program_4',
    'week_program_5',
    'week_program_6',
    'week_program_7',
    'vacation_duration',
    'boost_duration',
    'elec_statistics_day',
    'elec_statistics_month',
    'elec_statistics_year',
    'temp_correction',
    'air_pressure_index',
    'support_features',
    'window_check',
    'window_keep_time',
    'temp_unit_convert',
    'app_features',
    'switch_diff',
    'upper_temp',
    'lower_temp',
    'night_led_config',
    'ecowatt_url',
    'fault',
  ],
  // Curated (English) names: mode/running_mode share the pilot-wire-mode type
  // and child_lock/window_state share the binary type, so the frontend cannot
  // resolve a category/type label and falls back to feature.name.
  mode: {
    category: DEVICE_FEATURE_CATEGORIES.HEATER,
    type: DEVICE_FEATURE_TYPES.HEATER.PILOT_WIRE_MODE,
    name: 'Mode',
    has_feedback: true,
  },
  running_mode: {
    category: DEVICE_FEATURE_CATEGORIES.HEATER,
    type: DEVICE_FEATURE_TYPES.HEATER.PILOT_WIRE_MODE,
    name: 'Current mode',
  },
  child_lock: {
    category: DEVICE_FEATURE_CATEGORIES.CHILD_LOCK,
    type: DEVICE_FEATURE_TYPES.CHILD_LOCK.BINARY,
    name: 'Child lock',
    has_feedback: true,
  },
  electricity_statistics: {
    category: DEVICE_FEATURE_CATEGORIES.ENERGY_SENSOR,
    type: DEVICE_FEATURE_TYPES.ENERGY_SENSOR.INDEX_TODAY,
    unit: DEVICE_FEATURE_UNITS.KILOWATT_HOUR,
    scale: 1,
  },
  temp_current: {
    category: DEVICE_FEATURE_CATEGORIES.TEMPERATURE_SENSOR,
    type: DEVICE_FEATURE_TYPES.SENSOR.DECIMAL,
    unit: DEVICE_FEATURE_UNITS.CELSIUS,
    scale: 1,
  },
  average_power: {
    category: DEVICE_FEATURE_CATEGORIES.ENERGY_SENSOR,
    type: DEVICE_FEATURE_TYPES.ENERGY_SENSOR.POWER,
    unit: DEVICE_FEATURE_UNITS.WATT,
    scale: 1,
  },
  window_state: {
    category: DEVICE_FEATURE_CATEGORIES.OPENING_SENSOR,
    type: DEVICE_FEATURE_TYPES.SENSOR.BINARY,
    name: 'Window state',
  },
  temp_set: {
    category: DEVICE_FEATURE_CATEGORIES.THERMOSTAT,
    type: DEVICE_FEATURE_TYPES.THERMOSTAT.TARGET_TEMPERATURE,
    unit: DEVICE_FEATURE_UNITS.CELSIUS,
    scale: 1,
    has_feedback: true,
  },
};

const localMapping = {
  strict: true,
  ignoredDps: [
    '103',
    '104',
    '105',
    '106',
    '107',
    '108',
    '109',
    '110',
    '111',
    '113',
    '114',
    '115',
    '118',
    '119',
    '120',
    '121',
    '122',
    '124',
    '126',
    '127',
    '128',
    '129',
    '130',
    '132',
    '133',
  ],
  codeAliases: {},
  dps: {
    mode: 101,
    child_lock: 102,
    electricity_statistics: 112,
    temp_current: 116,
    average_power: 117,
    window_state: 123,
    temp_set: 125,
    running_mode: 131,
  },
};

// Konyks eCosy (HZTY001, product_id evyy1wbhi4t7uftn): a standard-`wk`
// pilot-wire module whose mode enum uses its own vocabulary (6 orders).
// Off is not a mode on this device (on/off is the dedicated `switch` DPS 1)
// and there is no Thermostat order either: those Gladys modes have no Tuya
// value here, so writing them is rejected by setValue. `auto` follows the
// weekly program (week_data), hence PROGRAMMING.
const ECOSY_PILOT_WIRE_TUYA_ENUM = {
  hot: PILOT_WIRE_MODE.COMFORT,
  eco: PILOT_WIRE_MODE.ECO,
  cold: PILOT_WIRE_MODE.FROST_PROTECTION,
  comfortable1: PILOT_WIRE_MODE.COMFORT_1,
  comfortable2: PILOT_WIRE_MODE.COMFORT_2,
  auto: PILOT_WIRE_MODE.PROGRAMMING,
};

const ecosyCloudMapping = {
  // temp_set is ignored on purpose: this module has no temperature probe, the
  // Konyks app does not expose a setpoint, and writing DPS 16 has no visible
  // effect (tuya-local does not expose it either).
  ignoredCodes: ['temp_set', 'travel_time', 'week_data'],
  switch: {
    category: DEVICE_FEATURE_CATEGORIES.SWITCH,
    type: DEVICE_FEATURE_TYPES.SWITCH.BINARY,
    name: 'Switch',
    has_feedback: true,
  },
  mode: {
    category: DEVICE_FEATURE_CATEGORIES.HEATER,
    type: DEVICE_FEATURE_TYPES.HEATER.PILOT_WIRE_MODE,
    name: 'Mode',
    has_feedback: true,
    tuyaEnum: ECOSY_PILOT_WIRE_TUYA_ENUM,
  },
  cur_mode: {
    category: DEVICE_FEATURE_CATEGORIES.HEATER,
    type: DEVICE_FEATURE_TYPES.HEATER.PILOT_WIRE_MODE,
    name: 'Current mode',
    // The thing model advertises cur_mode as rw but it is the status mirror
    // of `mode`.
    read_only: true,
    tuyaEnum: ECOSY_PILOT_WIRE_TUYA_ENUM,
  },
  timer_switch: {
    category: DEVICE_FEATURE_CATEGORIES.SWITCH,
    type: DEVICE_FEATURE_TYPES.SWITCH.BINARY,
    name: 'Program',
    has_feedback: true,
  },
  travel_switch: {
    category: DEVICE_FEATURE_CATEGORIES.SWITCH,
    type: DEVICE_FEATURE_TYPES.SWITCH.BINARY,
    name: 'Holiday mode',
    has_feedback: true,
  },
  lock_switch: {
    category: DEVICE_FEATURE_CATEGORIES.CHILD_LOCK,
    type: DEVICE_FEATURE_TYPES.CHILD_LOCK.BINARY,
    name: 'Child lock',
    has_feedback: true,
  },
};

const ecosyLocalMapping = {
  strict: true,
  // temp_set (16): no temperature probe on this module, the setpoint has no
  // effect (see the cloud variant mapping). travel_time (105) and week_data
  // (106) have no matching Gladys feature type.
  ignoredDps: ['16', '105', '106'],
  codeAliases: {},
  dps: {
    switch: 1,
    mode: 2,
    timer_switch: 102,
    travel_switch: 103,
    cur_mode: 104,
    lock_switch: 107,
  },
};

export const pilotThermostat = {
  DEVICE_TYPE_NAME: 'pilot-thermostat',
  CATEGORIES: new Set(),
  PRODUCT_IDS: new Set(['c03zek9b5daz7omr']),
  KEYWORDS: ['thermostat', 'pilote', 'pilot'],
  REQUIRED_CODES: new Set([
    'mode',
    'running_mode',
    'child_lock',
    'temp_set',
    'temp_current',
    'window_state',
  ]),
  CLOUD_MAPPINGS: cloudMapping,
  LOCAL_MAPPINGS: localMapping,
  // Per-product variants (tuya-local pattern): same conceptual family,
  // different DP layout and/or enum vocabulary. A variant mapping fully
  // REPLACES the family default one (no merge). A future product sharing an
  // existing layout is added to that variant's PRODUCT_IDS.
  VARIANTS: [
    {
      VARIANT_NAME: 'konyks-ecosy',
      PRODUCT_IDS: new Set(['evyy1wbhi4t7uftn']),
      CLOUD_MAPPINGS: ecosyCloudMapping,
      LOCAL_MAPPINGS: ecosyLocalMapping,
    },
  ],
};
