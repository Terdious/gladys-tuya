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
  ignoredCodes: ['countdown', 'countdown_1'],
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
  ignoredDps: ['11'],
  codeAliases: {
    switch: ['power'],
    power: ['switch'],
    switch_1: ['switch', 'power'],
    switch_2: ['switch'],
    switch_3: ['switch'],
    switch_4: ['switch'],
  },
  dps: {
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
