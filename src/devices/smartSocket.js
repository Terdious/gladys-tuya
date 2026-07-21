// -----------------------------------------------------------------------------
// Device type: SMART SOCKET (on/off control + electrical measurements).
//
// Ported from server/services/tuya/lib/mappings/index.js (SMART_SOCKET
// definition) and lib/mappings/cloud/smart-socket.js.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';

const SWITCH_CODES = new Set(['switch', 'switch_1', 'switch_2', 'power']);

const cloudMapping = {
  // Ported from the core PR7 branch (tuya-lsc-power-plug-fr-power-meter):
  // configuration/calibration codes of the LSC Power Plug FR (power meter)
  // that must not become Gladys features.
  ignoredCodes: [
    'countdown',
    'countdown_1',
    'relay_status',
    'overcharge_switch',
    'light_mode',
    'cycle_time',
    'random_time',
    'switch_inching',
    'voltage_coe',
    'electric_coe',
    'power_coe',
    'electricity_coe',
    'test_bit',
  ],
  switch: {
    category: DEVICE_FEATURE_CATEGORIES.SWITCH,
    type: DEVICE_FEATURE_TYPES.SWITCH.BINARY,
  },
  power: {
    category: DEVICE_FEATURE_CATEGORIES.SWITCH,
    type: DEVICE_FEATURE_TYPES.SWITCH.BINARY,
  },
  switch_1: {
    category: DEVICE_FEATURE_CATEGORIES.SWITCH,
    type: DEVICE_FEATURE_TYPES.SWITCH.BINARY,
  },
  switch_2: {
    category: DEVICE_FEATURE_CATEGORIES.SWITCH,
    type: DEVICE_FEATURE_TYPES.SWITCH.BINARY,
  },
  switch_3: {
    category: DEVICE_FEATURE_CATEGORIES.SWITCH,
    type: DEVICE_FEATURE_TYPES.SWITCH.BINARY,
  },
  switch_4: {
    category: DEVICE_FEATURE_CATEGORIES.SWITCH,
    type: DEVICE_FEATURE_TYPES.SWITCH.BINARY,
  },
  child_lock: {
    category: DEVICE_FEATURE_CATEGORIES.CHILD_LOCK,
    type: DEVICE_FEATURE_TYPES.CHILD_LOCK.BINARY,
  },
  add_ele: {
    category: DEVICE_FEATURE_CATEGORIES.SWITCH,
    type: DEVICE_FEATURE_TYPES.SWITCH.ENERGY,
    unit: DEVICE_FEATURE_UNITS.KILOWATT_HOUR,
  },
  cur_current: {
    category: DEVICE_FEATURE_CATEGORIES.SWITCH,
    type: DEVICE_FEATURE_TYPES.SWITCH.CURRENT,
    unit: DEVICE_FEATURE_UNITS.MILLI_AMPERE,
  },
  cur_power: {
    category: DEVICE_FEATURE_CATEGORIES.SWITCH,
    type: DEVICE_FEATURE_TYPES.SWITCH.POWER,
    unit: DEVICE_FEATURE_UNITS.WATT,
  },
  cur_voltage: {
    category: DEVICE_FEATURE_CATEGORIES.SWITCH,
    type: DEVICE_FEATURE_TYPES.SWITCH.VOLTAGE,
    unit: DEVICE_FEATURE_UNITS.VOLT,
  },
};

// LAN mapping (ported from lib/mappings/local/smart-socket.js): strict, so
// only the listed codes are read/written locally.
const localMapping = {
  strict: true,
  // DPS pushed by the LSC Power Plug FR that carry no Gladys feature
  // (calibration coefficients, LED mode, inching config...).
  ignoredDps: ['9', '11', '21', '22', '23', '24', '25', '38', '39', '40', '42', '43', '44'],
  codeAliases: {
    child_lock: [],
    switch: ['power'],
    power: ['switch'],
    switch_1: ['switch', 'power'],
    switch_2: ['switch'],
    switch_3: ['switch'],
    switch_4: ['switch'],
  },
  dps: {
    add_ele: 17,
    cur_current: 18,
    cur_power: 19,
    cur_voltage: 20,
    child_lock: 41,
    switch: 1,
    power: 1,
    switch_1: 1,
    switch_2: 2,
    switch_3: 3,
    switch_4: 4,
  },
};

export const smartSocket = {
  DEVICE_TYPE_NAME: 'smart-socket',
  CATEGORIES: new Set(['cz']),
  PRODUCT_IDS: new Set(['cya3zxfd38g4qp8d']),
  KEYWORDS: ['socket', 'plug', 'outlet', 'prise'],
  REQUIRED_CODES: SWITCH_CODES,
  CLOUD_MAPPINGS: cloudMapping,
  LOCAL_MAPPINGS: localMapping,
};
