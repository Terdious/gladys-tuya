// -----------------------------------------------------------------------------
// Device type: THREE-PHASE METER / POWER CLAMP (Tuya category `zndb`).
//
// "Power Clamp" three-phase clamp meter (product id 9rjjf6rdkca9woju),
// discovered with no feature in 1.26.0. Unlike the bidirectional smart meter
// (smartMeter.js, lowercase standard codes), it only declares a thing model
// with CamelCase codes, one set per phase plus the totals. Its diagnostic
// report reads:
//   ActivePower = 110        ActivePowerA/B/C = 4 / 100 / 7
//   Current = 1955           CurrentA/B/C = 516 / 906 / 533
//   EnergyConsumed = 332895  EnergyConsumedA/B/C = 103400 / 122485 / 107010
//   VoltageA/B/C = 2255 / 2259 / 2253
//   PowerFactorA/B/C = 3 / 49 / 6   Frequency = 50   Temperature = 339
//   ReactivePower(A/B/C) = 0        DeviceStatus = 0  voltage_phase_seq = "1"
//   Declared value specs (model):
//     ActivePower*: scale 0, W          Current*: scale 3, A
//     EnergyConsumed*: scale 2, kWh     Voltage*: scale 1, V
//     Temperature: -100..800, scale 1, °C
//
// The mapping declares each scale: the Gladys persistence drops the scale
// read at discovery, and the poll falls back to the mapping one.
//
// LAN mapping from the DPS snapshot of the same report (see LOCAL_MAPPINGS).
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';

import { globalCloudMapping } from './global.js';

// Codes that identify a three-phase meter (at least one must be exposed).
const THREE_PHASE_METER_CODES = new Set([
  'ActivePowerA',
  'ActivePowerB',
  'ActivePowerC',
  'VoltageA',
  'VoltageB',
  'VoltageC',
]);

const power = (name) => ({
  name,
  category: DEVICE_FEATURE_CATEGORIES.ENERGY_SENSOR,
  type: DEVICE_FEATURE_TYPES.ENERGY_SENSOR.POWER,
  unit: DEVICE_FEATURE_UNITS.WATT,
  scale: 0,
});

const current = (name) => ({
  name,
  category: DEVICE_FEATURE_CATEGORIES.ENERGY_SENSOR,
  type: DEVICE_FEATURE_TYPES.ENERGY_SENSOR.CURRENT,
  unit: DEVICE_FEATURE_UNITS.AMPERE,
  scale: 3,
});

const voltage = (name) => ({
  name,
  category: DEVICE_FEATURE_CATEGORIES.ENERGY_SENSOR,
  type: DEVICE_FEATURE_TYPES.ENERGY_SENSOR.VOLTAGE,
  unit: DEVICE_FEATURE_UNITS.VOLT,
  scale: 1,
});

const energy = (name) => ({
  name,
  category: DEVICE_FEATURE_CATEGORIES.ENERGY_SENSOR,
  type: DEVICE_FEATURE_TYPES.ENERGY_SENSOR.ENERGY,
  unit: DEVICE_FEATURE_UNITS.KILOWATT_HOUR,
  scale: 2,
});

// Mapping keys are the lowercased Tuya codes (lookups are case-insensitive).
const cloudMapping = {
  // A clamp discovered before this type existed was created as `unknown`:
  // starting from the global mapping keeps re-discovery additive.
  ...globalCloudMapping,
  ignoredCodes: [
    // No Gladys feature type for these measures yet.
    'Frequency',
    'PowerFactorA',
    'PowerFactorB',
    'PowerFactorC',
    'ReactivePower',
    'ReactivePowerA',
    'ReactivePowerB',
    'ReactivePowerC',
    // Fault bitmap and wiring order of the phases: installation values.
    'DeviceStatus',
    'voltage_phase_seq',
  ],
  activepower: power('Total power'),
  activepowera: power('Power A'),
  activepowerb: power('Power B'),
  activepowerc: power('Power C'),
  current: current('Total current'),
  currenta: current('Current A'),
  currentb: current('Current B'),
  currentc: current('Current C'),
  voltagea: voltage('Voltage A'),
  voltageb: voltage('Voltage B'),
  voltagec: voltage('Voltage C'),
  energyconsumed: energy('Total energy'),
  energyconsumeda: energy('Energy A'),
  energyconsumedb: energy('Energy B'),
  energyconsumedc: energy('Energy C'),
  // The clamp's own temperature (electrical panel), not a room temperature:
  // the device-temperature category keeps it out of the room averages.
  temperature: {
    name: 'Internal temperature',
    category: DEVICE_FEATURE_CATEGORIES.DEVICE_TEMPERATURE_SENSOR,
    type: DEVICE_FEATURE_TYPES.SENSOR.DECIMAL,
    unit: DEVICE_FEATURE_UNITS.CELSIUS,
    scale: 1,
  },
};

// LAN mapping, matched value by value against the cloud reading of the same
// report: phase A 101 V / 102 I / 103 P / 104 PF / 106 E, phase B 111..116,
// phase C 121..126, totals 131 E / 132 I / 133 P, 135 frequency,
// 136 temperature, 137 fault bitmap, 138 phase sequence.
const localMapping = {
  strict: true,
  ignoredDps: ['104', '114', '124', '135', '137', '138'],
  codeAliases: {},
  dps: {
    voltagea: 101,
    currenta: 102,
    activepowera: 103,
    energyconsumeda: 106,
    voltageb: 111,
    currentb: 112,
    activepowerb: 113,
    energyconsumedb: 116,
    voltagec: 121,
    currentc: 122,
    activepowerc: 123,
    energyconsumedc: 126,
    energyconsumed: 131,
    current: 132,
    activepower: 133,
    temperature: 136,
  },
};

export const threePhaseMeter = {
  DEVICE_TYPE_NAME: 'three-phase-meter',
  CATEGORIES: new Set(['zndb']),
  PRODUCT_IDS: new Set(['9rjjf6rdkca9woju']),
  KEYWORDS: ['power clamp', 'three-phase', 'three phase', 'triphas'],
  REQUIRED_CODES: THREE_PHASE_METER_CODES,
  CLOUD_MAPPINGS: cloudMapping,
  LOCAL_MAPPINGS: localMapping,
};
