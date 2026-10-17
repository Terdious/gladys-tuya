import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DEVICE_FEATURE_CATEGORIES, DEVICE_FEATURE_TYPES } from '@gladysassistant/integration-sdk';

import { TuyaHandler } from '../../src/tuya/handler.js';
import { convertDevice } from '../../src/tuya/device/tuya.convertDevice.js';
import { getLocalDpsFromCode } from '../../src/tuya/device/tuya.localMapping.js';
import { getDeviceType, DEVICE_TYPES } from '../../src/tuya/mappings/index.js';
import { emitLocalDpsStates } from '../../src/tuya/tuya.poll.js';
import { DEVICE_PARAM_NAME } from '../../src/tuya/constants.js';
import { createFakeGladys } from '../helpers/fakeGladys.js';

// The "Power Clamp" three-phase clamp meter of @Terdious ("Puissance
// triphasé PAC"), from its 1.26.0 diagnostic: a thing model only, CamelCase
// codes, one set per phase plus the totals.
const value = (code, min, max, scale, unit) => ({
  code,
  accessMode: 'ro',
  typeSpec: { type: 'value', min, max, scale, step: 1, unit },
});
const PHASES = ['A', 'B', 'C'];
const PROPERTIES = [
  value('ActivePower', -19800000, 19800000, 0, 'W'),
  ...PHASES.map((p) => value(`ActivePower${p}`, -6600000, 6600000, 0, 'W')),
  value('Current', 0, 9000000, 3, 'A'),
  ...PHASES.map((p) => value(`Current${p}`, 0, 3000000, 3, 'A')),
  value('EnergyConsumed', 0, 2000000000, 2, 'Kw·h'),
  ...PHASES.map((p) => value(`EnergyConsumed${p}`, 0, 2000000000, 2, 'Kw·h')),
  ...PHASES.map((p) => value(`Voltage${p}`, 0, 5000, 1, 'V')),
  ...PHASES.map((p) => value(`PowerFactor${p}`, 0, 100, 2, '')),
  value('ReactivePower', -19800000, 19800000, 0, 'var'),
  ...PHASES.map((p) => value(`ReactivePower${p}`, -6600000, 6600000, 0, 'var')),
  value('Frequency', 0, 80, 0, 'Hz'),
  value('Temperature', -100, 800, 1, '℃'),
  { code: 'DeviceStatus', accessMode: 'ro', typeSpec: { type: 'bitmap', maxlen: 8 } },
  {
    code: 'voltage_phase_seq',
    accessMode: 'ro',
    typeSpec: { type: 'enum', range: ['0', '1', '2', '3', '4', '5'] },
  },
];
const CLAMP = {
  id: 'clamp1',
  name: 'Puissance triphasé PAC',
  product_name: 'Power Clamp',
  model: 'Power Clamp',
  product_id: '9rjjf6rdkca9woju',
  local_key: 'lk',
  online: true,
  specifications: { category: 'zndb', functions: [], status: [] },
  thing_model: { services: [{ properties: PROPERTIES }] },
};

const CLOUD_VALUES = {
  ActivePower: 110,
  ActivePowerA: 4,
  ActivePowerB: 100,
  ActivePowerC: 7,
  Current: 1955,
  CurrentA: 516,
  CurrentB: 906,
  CurrentC: 533,
  DeviceStatus: 0,
  EnergyConsumed: 332895,
  EnergyConsumedA: 103400,
  EnergyConsumedB: 122485,
  EnergyConsumedC: 107010,
  Frequency: 50,
  PowerFactorA: 3,
  PowerFactorB: 49,
  PowerFactorC: 6,
  ReactivePower: 0,
  ReactivePowerA: 0,
  ReactivePowerB: 0,
  ReactivePowerC: 0,
  Temperature: 339,
  VoltageA: 2255,
  VoltageB: 2259,
  VoltageC: 2253,
  voltage_phase_seq: '1',
};

const byCode = (device) =>
  Object.fromEntries(device.features.map((f) => [f.external_id.split(':').pop(), f]));

// As created in Gladys: the persistence drops the scale read at discovery.
const createdDevice = (fake) => {
  const converted = convertDevice(fake, CLAMP);
  return {
    external_id: converted.external_id,
    device_type: converted.device_type,
    features: converted.features.map(({ scale: _scale, ...feature }) => feature),
    params: [{ name: DEVICE_PARAM_NAME.DEVICE_ID, value: 'clamp1' }],
  };
};
const publishedByCode = (fake) =>
  Object.fromEntries(fake.published.map((p) => [p.featureExternalId.split(':').pop(), p.state]));

const EXPECTED = {
  ActivePower: 110,
  ActivePowerA: 4,
  ActivePowerB: 100,
  ActivePowerC: 7,
  Current: 1.955,
  CurrentA: 0.516,
  CurrentB: 0.906,
  CurrentC: 0.533,
  EnergyConsumed: 3328.95,
  EnergyConsumedA: 1034,
  EnergyConsumedB: 1224.85,
  EnergyConsumedC: 1070.1,
  VoltageA: 225.5,
  VoltageB: 225.9,
  VoltageC: 225.3,
  Temperature: 33.9,
};

test('the clamp is detected from its product id, its zndb category or its name', () => {
  assert.equal(getDeviceType(CLAMP), DEVICE_TYPES.THREE_PHASE_METER);
  assert.equal(getDeviceType({ product_id: '9rjjf6rdkca9woju' }), DEVICE_TYPES.THREE_PHASE_METER);
  assert.equal(
    getDeviceType({ name: 'Pince triphasée', status: [{ code: 'VoltageB' }] }),
    DEVICE_TYPES.THREE_PHASE_METER,
  );
  // A zndb meter without the per-phase CamelCase codes is not claimed.
  assert.equal(
    getDeviceType({ specifications: { category: 'zndb', status: [{ code: 'switch' }] } }),
    DEVICE_TYPES.UNKNOWN,
  );
});

test('convertDevice maps power, current, voltage and energy per phase plus the totals', () => {
  const features = byCode(convertDevice(createFakeGladys(), CLAMP));
  assert.deepEqual(Object.keys(features).sort(), Object.keys(EXPECTED).sort());

  const expectType = (code, type, unit) => {
    assert.equal(features[code].category, DEVICE_FEATURE_CATEGORIES.ENERGY_SENSOR, code);
    assert.equal(features[code].type, type, code);
    assert.equal(features[code].unit, unit, code);
    assert.equal(features[code].read_only, true, code);
  };
  ['ActivePower', 'ActivePowerA', 'ActivePowerB', 'ActivePowerC'].forEach((code) =>
    expectType(code, DEVICE_FEATURE_TYPES.ENERGY_SENSOR.POWER, 'watt'),
  );
  ['Current', 'CurrentA', 'CurrentB', 'CurrentC'].forEach((code) =>
    expectType(code, DEVICE_FEATURE_TYPES.ENERGY_SENSOR.CURRENT, 'ampere'),
  );
  ['VoltageA', 'VoltageB', 'VoltageC'].forEach((code) =>
    expectType(code, DEVICE_FEATURE_TYPES.ENERGY_SENSOR.VOLTAGE, 'volt'),
  );
  ['EnergyConsumed', 'EnergyConsumedA', 'EnergyConsumedB', 'EnergyConsumedC'].forEach((code) =>
    expectType(code, DEVICE_FEATURE_TYPES.ENERGY_SENSOR.ENERGY, 'kilowatt-hour'),
  );
  assert.equal(features.ActivePower.name, 'Total power');
  assert.equal(features.CurrentC.name, 'Current C');
  assert.equal(features.EnergyConsumed.name, 'Total energy');

  // The clamp's own temperature stays out of the room temperatures.
  assert.equal(features.Temperature.category, DEVICE_FEATURE_CATEGORIES.DEVICE_TEMPERATURE_SENSOR);
  assert.equal(features.Temperature.type, DEVICE_FEATURE_TYPES.SENSOR.DECIMAL);
  assert.equal(features.Temperature.unit, 'celsius');
  assert.equal(features.Temperature.name, 'Internal temperature');
});

test('poll publishes the values of the report in real units, even without the stored scale', async () => {
  const fake = createFakeGladys();
  const handler = new TuyaHandler(fake);
  const device = createdDevice(fake);
  handler.connector = {
    request: async ({ path }) => ({
      success: true,
      result: path.includes('/shadow/properties')
        ? { properties: Object.entries(CLOUD_VALUES).map(([code, v]) => ({ code, value: v })) }
        : Object.entries(CLOUD_VALUES).map(([code, v]) => ({ code, value: v })),
    }),
  };

  await handler.poll(device);

  assert.deepEqual(publishedByCode(fake), EXPECTED);
});

test('the LAN mapping of the DPS snapshot publishes the same values as the cloud', async () => {
  const device = { device_type: DEVICE_TYPES.THREE_PHASE_METER };
  assert.equal(getLocalDpsFromCode('VoltageA', device), 101);
  assert.equal(getLocalDpsFromCode('ActivePowerB', device), 113);
  assert.equal(getLocalDpsFromCode('EnergyConsumedC', device), 126);
  assert.equal(getLocalDpsFromCode('ActivePower', device), 133);
  assert.equal(getLocalDpsFromCode('Temperature', device), 136);
  assert.equal(getLocalDpsFromCode('Frequency', device), null);

  const fake = createFakeGladys();
  const handler = new TuyaHandler(fake);
  const created = createdDevice(fake);
  // The DPS snapshot of the report (power values read a few seconds apart).
  const dps = {
    101: 2255,
    102: 516,
    103: 4,
    104: 3,
    106: 103400,
    111: 2259,
    112: 906,
    113: 100,
    114: 49,
    116: 122485,
    121: 2253,
    122: 533,
    123: 7,
    124: 6,
    126: 107010,
    131: 332895,
    132: 1955,
    133: 110,
    135: 50,
    136: 339,
    137: 0,
    138: '1',
  };
  const pending = [];
  emitLocalDpsStates(handler, created, dps, pending);
  await Promise.all(pending);

  assert.deepEqual(publishedByCode(fake), EXPECTED);
});
