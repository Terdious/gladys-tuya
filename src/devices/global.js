// -----------------------------------------------------------------------------
// Global (type-agnostic) mappings, ported from
// server/services/tuya/lib/mappings/cloud/global.js and
// server/services/tuya/lib/mappings/local/global.js.
//
// Used as fallback for Tuya devices whose type could not be inferred
// (device type "unknown").
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';

export const globalCloudMapping = {
  switch_led: {
    name: 'LED',
    category: DEVICE_FEATURE_CATEGORIES.LIGHT,
    type: DEVICE_FEATURE_TYPES.LIGHT.BINARY,
  },
  switch: {
    name: 'Switch',
    category: DEVICE_FEATURE_CATEGORIES.SWITCH,
    type: DEVICE_FEATURE_TYPES.SWITCH.BINARY,
  },
  power: {
    name: 'On/off',
    category: DEVICE_FEATURE_CATEGORIES.SWITCH,
    type: DEVICE_FEATURE_TYPES.SWITCH.BINARY,
  },
  bright_value_v2: {
    name: 'Brightness',
    category: DEVICE_FEATURE_CATEGORIES.LIGHT,
    type: DEVICE_FEATURE_TYPES.LIGHT.BRIGHTNESS,
  },
  temp_value_v2: {
    name: 'Color temperature',
    category: DEVICE_FEATURE_CATEGORIES.LIGHT,
    type: DEVICE_FEATURE_TYPES.LIGHT.TEMPERATURE,
  },
  colour_data_v2: {
    name: 'Color',
    category: DEVICE_FEATURE_CATEGORIES.LIGHT,
    type: DEVICE_FEATURE_TYPES.LIGHT.COLOR,
  },
  colour_data: {
    name: 'Color',
    category: DEVICE_FEATURE_CATEGORIES.LIGHT,
    type: DEVICE_FEATURE_TYPES.LIGHT.COLOR,
  },
  switch_1: {
    name: 'Switch 1',
    category: DEVICE_FEATURE_CATEGORIES.SWITCH,
    type: DEVICE_FEATURE_TYPES.SWITCH.BINARY,
  },
  switch_2: {
    name: 'Switch 2',
    category: DEVICE_FEATURE_CATEGORIES.SWITCH,
    type: DEVICE_FEATURE_TYPES.SWITCH.BINARY,
  },
  switch_3: {
    name: 'Switch 3',
    category: DEVICE_FEATURE_CATEGORIES.SWITCH,
    type: DEVICE_FEATURE_TYPES.SWITCH.BINARY,
  },
  switch_4: {
    name: 'Switch 4',
    category: DEVICE_FEATURE_CATEGORIES.SWITCH,
    type: DEVICE_FEATURE_TYPES.SWITCH.BINARY,
  },
  control: {
    name: 'Control',
    category: DEVICE_FEATURE_CATEGORIES.CURTAIN,
    type: DEVICE_FEATURE_TYPES.CURTAIN.STATE,
  },
  percent_control: {
    name: 'Position',
    category: DEVICE_FEATURE_CATEGORIES.CURTAIN,
    type: DEVICE_FEATURE_TYPES.CURTAIN.POSITION,
  },
  add_ele: {
    name: 'Total energy',
    category: DEVICE_FEATURE_CATEGORIES.SWITCH,
    type: DEVICE_FEATURE_TYPES.SWITCH.ENERGY,
    unit: DEVICE_FEATURE_UNITS.KILOWATT_HOUR,
  },
  cur_current: {
    name: 'Current',
    category: DEVICE_FEATURE_CATEGORIES.SWITCH,
    type: DEVICE_FEATURE_TYPES.SWITCH.CURRENT,
    unit: DEVICE_FEATURE_UNITS.MILLI_AMPERE,
  },
  cur_power: {
    name: 'Active power',
    category: DEVICE_FEATURE_CATEGORIES.SWITCH,
    type: DEVICE_FEATURE_TYPES.SWITCH.POWER,
    unit: DEVICE_FEATURE_UNITS.WATT,
  },
  cur_voltage: {
    name: 'Voltage',
    category: DEVICE_FEATURE_CATEGORIES.SWITCH,
    type: DEVICE_FEATURE_TYPES.SWITCH.VOLTAGE,
    unit: DEVICE_FEATURE_UNITS.VOLT,
  },
};

// LAN mapping: Tuya code -> DPS index. Non-strict: unknown codes fall back to
// the generic switch/switch_N inference (see tuya.localMapping.js).
export const globalLocalMapping = {
  strict: false,
  codeAliases: {
    switch: ['power'],
    power: ['switch'],
  },
  dps: {
    switch: 1,
    power: 1,
  },
};
