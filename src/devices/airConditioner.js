// -----------------------------------------------------------------------------
// Device type: AIR CONDITIONER (on/off, mode, target temperature, ambient
// temperature).
//
// Ported from server/services/tuya/lib/mappings/index.js (AIR_CONDITIONER
// definition), lib/mappings/cloud/air-conditioner.js and
// lib/mappings/local/air-conditioner.js of the core
// tuya-air-conditioner-support-v2 branch.
//
// Fan speed (`windspeed`) and swings (`horizontal` / `vertical`) are mapped to
// the AIR_CONDITIONING.FAN_SPEED / SWING_HORIZONTAL / SWING_VERTICAL feature
// types shipped by Gladys core 4.84.2 / SDK 0.10.0 (issue #17). The enum
// vocabularies live in tuya.deviceMapping.js.
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

// Mirror of the core AC_FAN_SPEED constant (server/utils/constants.js).
export const AC_FAN_SPEED = {
  AUTO: 0,
  LOW: 1,
  LOW_MID: 2,
  MID: 3,
  MID_HIGH: 4,
  HIGH: 5,
  QUIET: 6,
  TURBO: 7,
};

// Mirror of the core AC_SWING_HORIZONTAL constant (server/utils/constants.js).
export const AC_SWING_HORIZONTAL = {
  OFF: 0,
  SWING: 1,
  POSITION_1: 2,
  POSITION_2: 3,
  POSITION_3: 4,
  POSITION_4: 5,
  POSITION_5: 6,
  SWING_OPPOSITE: 7,
};

// Mirror of the core AC_SWING_VERTICAL constant (server/utils/constants.js).
export const AC_SWING_VERTICAL = {
  OFF: 0,
  SWING: 1,
  POSITION_1: 2,
  POSITION_2: 3,
  POSITION_3: 4,
  POSITION_4: 5,
  POSITION_5: 6,
};

const AIR_CONDITIONER_CODES = new Set(['temp_set', 'mode', 'windspeed', 'horizontal', 'vertical']);

const cloudMapping = {
  ignoredCodes: [
    // The kt category exposes BOTH `switch` (specifications) and `Power`
    // (shadow properties) for the same on/off: `power` is the mapped one.
    'switch',
    // Same duplication for the fan speed: `fan_speed_enum` (specifications)
    // and `windspeed` (shadow properties) are the same DP — `windspeed` is the
    // mapped one (it is the code the cloud reports), the LAN mapping aliases
    // them both to DPS 5.
    'fan_speed_enum',
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
  windspeed: {
    category: DEVICE_FEATURE_CATEGORIES.AIR_CONDITIONING,
    type: DEVICE_FEATURE_TYPES.AIR_CONDITIONING.FAN_SPEED,
    min: AC_FAN_SPEED.AUTO,
    max: AC_FAN_SPEED.TURBO,
  },
  horizontal: {
    category: DEVICE_FEATURE_CATEGORIES.AIR_CONDITIONING,
    type: DEVICE_FEATURE_TYPES.AIR_CONDITIONING.SWING_HORIZONTAL,
    min: AC_SWING_HORIZONTAL.OFF,
    max: AC_SWING_HORIZONTAL.SWING_OPPOSITE,
  },
  vertical: {
    category: DEVICE_FEATURE_CATEGORIES.AIR_CONDITIONING,
    type: DEVICE_FEATURE_TYPES.AIR_CONDITIONING.SWING_VERTICAL,
    min: AC_SWING_VERTICAL.OFF,
    max: AC_SWING_VERTICAL.POSITION_5,
  },
};

// LAN mapping (ported from lib/mappings/local/air-conditioner.js): strict, so
// only the listed codes are read/written locally.
const localMapping = {
  strict: true,
  ignoredDps: [
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
    fan_speed_enum: ['windspeed'],
    windspeed: ['fan_speed_enum'],
  },
  dps: {
    switch: 1,
    power: 1,
    temp_set: 2,
    temp_current: 3,
    mode: 4,
    fan_speed_enum: 5,
    windspeed: 5,
    horizontal: 106,
    vertical: 107,
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
