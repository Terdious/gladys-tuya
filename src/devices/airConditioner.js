// -----------------------------------------------------------------------------
// Device type: AIR CONDITIONER (on/off, mode, target temperature, ambient
// temperature).
//
// Ported from server/services/tuya/lib/mappings/index.js (AIR_CONDITIONER
// definition), lib/mappings/cloud/air-conditioner.js and
// lib/mappings/local/air-conditioner.js of the core
// tuya-air-conditioner-support-v2 branch.
//
// Scope note: the core branch also maps windspeed (fan speed) and
// horizontal/vertical (swings), but those feature types
// (AIR_CONDITIONING.FAN_SPEED / SWING_*) do not exist yet in the published
// Gladys constants — a discovered feature carrying them would be rejected.
// They are listed in ignoredCodes below and will be promoted to features once
// the core ships the types (tracked in issue #14 follow-ups).
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';

// Mirror of the core AC_MODE constant (server/utils/constants.js): the values
// the Gladys front renders for an air-conditioning `mode` feature.
export const AC_MODE = {
  AUTO: 0,
  COOLING: 1,
  HEATING: 2,
  DRYING: 3,
  FAN: 4,
};

const AIR_CONDITIONER_CODES = new Set(['temp_set', 'mode', 'windspeed', 'horizontal', 'vertical']);

const cloudMapping = {
  ignoredCodes: [
    // The kt category exposes BOTH `switch` (specifications) and `Power`
    // (shadow properties) for the same on/off: `power` is the mapped one.
    'switch',
    'fan_speed_enum',
    // Not yet supported by the published Gladys feature types (see header).
    'windspeed',
    'horizontal',
    'vertical',
    'eco',
    'mode_eco',
    'drying',
    'mode_dry',
    'cleaning',
    'clean',
    'temp_unit_convert',
    'unit',
    'heat',
    'heat8',
    'light',
    'sleep',
    'health',
    'windshake',
    'countdown',
    'countdown_left',
    'use_number',
    'total_time',
    'electricity',
    'electricity_number',
    'type',
    'current_mode',
    'swing3d',
  ],
  power: {
    category: DEVICE_FEATURE_CATEGORIES.AIR_CONDITIONING,
    type: DEVICE_FEATURE_TYPES.AIR_CONDITIONING.BINARY,
  },
  temp_set: {
    category: DEVICE_FEATURE_CATEGORIES.AIR_CONDITIONING,
    type: DEVICE_FEATURE_TYPES.AIR_CONDITIONING.TARGET_TEMPERATURE,
    unit: DEVICE_FEATURE_UNITS.CELSIUS,
    scale: 1,
  },
  temp_current: {
    category: DEVICE_FEATURE_CATEGORIES.TEMPERATURE_SENSOR,
    type: DEVICE_FEATURE_TYPES.SENSOR.DECIMAL,
    unit: DEVICE_FEATURE_UNITS.CELSIUS,
    scale: 1,
  },
  mode: {
    category: DEVICE_FEATURE_CATEGORIES.AIR_CONDITIONING,
    type: DEVICE_FEATURE_TYPES.AIR_CONDITIONING.MODE,
    // The Gladys mode values span AC_MODE (0..4); enum specs carry no min/max.
    min: AC_MODE.AUTO,
    max: AC_MODE.FAN,
  },
};

// LAN mapping (ported from lib/mappings/local/air-conditioner.js): strict, so
// only the listed codes are read/written locally.
const localMapping = {
  strict: true,
  ignoredDps: [
    '5',
    '8',
    '9',
    '12',
    '13',
    '15',
    '20',
    '21',
    '22',
    '101',
    '102',
    '103',
    '104',
    '105',
    '106',
    '107',
    '108',
    '109',
    '110',
    '111',
    '112',
    '113',
    '114',
    '115',
  ],
  codeAliases: {
    switch: ['power'],
    power: ['switch'],
  },
  dps: {
    switch: 1,
    power: 1,
    temp_set: 2,
    temp_current: 3,
    mode: 4,
  },
};

export const airConditioner = {
  DEVICE_TYPE_NAME: 'air-conditioner',
  CATEGORIES: new Set(['kt']),
  PRODUCT_IDS: new Set(['f3goccgfj6qino4c']),
  KEYWORDS: ['air conditioner', 'conditioner', 'clim'],
  REQUIRED_CODES: AIR_CONDITIONER_CODES,
  CLOUD_MAPPINGS: cloudMapping,
  LOCAL_MAPPINGS: localMapping,
};
