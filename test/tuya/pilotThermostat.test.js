import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DEVICE_FEATURE_CATEGORIES, DEVICE_FEATURE_TYPES } from '@gladysassistant/integration-sdk';

import { TuyaHandler } from '../../src/tuya/handler.js';
import { convertDevice } from '../../src/tuya/device/tuya.convertDevice.js';
import { getLocalDpsFromCode } from '../../src/tuya/device/tuya.localMapping.js';
import { getDeviceType, DEVICE_TYPES } from '../../src/tuya/mappings/index.js';
import { PILOT_WIRE_MODE } from '../../src/devices/pilotThermostat.js';
import { OPENING_SENSOR_STATE } from '../../src/tuya/device/tuya.deviceMapping.js';
import { DEVICE_PARAM_NAME } from '../../src/tuya/constants.js';
import { createFakeGladys } from '../helpers/fakeGladys.js';

// RP5 fil-pilote thermostat, ported from the core PR8 branch test fixture
// (pilote-thermostat-c03zek9b5daz7omr/input-device.json): everything is
// exposed through the thing model + shadow properties, specifications are
// empty.
const RP5_DEVICE = {
  id: 'rp5',
  name: 'Thermostat Bureau',
  product_name: 'Pilote Thermostat',
  model: 'RP5',
  product_id: 'c03zek9b5daz7omr',
  local_key: 'lk',
  ip: '10.0.0.15',
  protocol_version: '3.5',
  local_override: true,
  online: true,
  specifications: { category: 'cjkg', functions: [], status: [] },
  properties: {
    properties: [
      { code: 'mode', dp_id: 101, type: 'enum', value: 'Anti_forst' },
      { code: 'child_lock', dp_id: 102, type: 'bool', value: false },
      { code: 'week_program_1', dp_id: 103, type: 'raw', value: 'VVVV' },
      { code: 'vacation_duration', dp_id: 110, type: 'value', value: 0 },
      { code: 'electricity_statistics', dp_id: 112, type: 'value', value: 0 },
      { code: 'temp_current', dp_id: 116, type: 'value', value: 152 },
      { code: 'average_power', dp_id: 117, type: 'value', value: 20 },
      { code: 'fault', dp_id: 119, type: 'bitmap', value: 0 },
      { code: 'window_state', dp_id: 123, type: 'bool', value: false },
      { code: 'temp_set', dp_id: 125, type: 'value', value: 210 },
      { code: 'temp_unit_convert', dp_id: 126, type: 'enum', value: 'c' },
      { code: 'running_mode', dp_id: 131, type: 'enum', value: 'Anti_forst' },
    ],
  },
  thing_model: {
    services: [
      {
        code: '',
        name: 'Default service',
        properties: [
          {
            abilityId: 101,
            accessMode: 'rw',
            code: 'mode',
            name: 'Mode',
            typeSpec: {
              type: 'enum',
              range: [
                'Standby',
                'Comfort',
                'Comfort_1',
                'Comfort_2',
                'ECO',
                'Anti_forst',
                'Programming',
                'Thermostat',
              ],
            },
          },
          { abilityId: 102, accessMode: 'rw', code: 'child_lock', typeSpec: { type: 'bool' } },
          {
            abilityId: 112,
            accessMode: 'ro',
            code: 'electricity_statistics',
            typeSpec: { type: 'value', max: 2000000000, min: 0, scale: 1, step: 1, unit: 'kWh' },
          },
          {
            abilityId: 116,
            accessMode: 'ro',
            code: 'temp_current',
            typeSpec: { type: 'value', max: 9000, min: -300, scale: 1, step: 1, unit: '' },
          },
          {
            abilityId: 117,
            accessMode: 'ro',
            code: 'average_power',
            typeSpec: { type: 'value', max: 2000000000, min: 0, scale: 1, step: 1, unit: 'W' },
          },
          { abilityId: 123, accessMode: 'ro', code: 'window_state', typeSpec: { type: 'bool' } },
          {
            abilityId: 125,
            accessMode: 'rw',
            code: 'temp_set',
            typeSpec: { type: 'value', max: 3000, min: 50, scale: 1, step: 5, unit: '' },
          },
          {
            abilityId: 131,
            accessMode: 'ro',
            code: 'running_mode',
            typeSpec: {
              type: 'enum',
              range: ['Standby', 'Comfort', 'Comfort_1', 'Comfort_2', 'ECO', 'Anti_forst'],
            },
          },
        ],
      },
    ],
  },
};

// Konyks eCosy (HZTY001): pilot-wire module without temperature probe, its
// own DP layout and mode vocabulary (per-product VARIANT of the family).
const ECOSY_DEVICE = {
  id: 'ecosy1',
  name: 'Radiateur Couloir',
  product_name: 'eCosy',
  product_id: 'evyy1wbhi4t7uftn',
  local_key: 'lk',
  online: true,
  specifications: {
    category: 'wk',
    functions: [
      { code: 'switch', type: 'Boolean', values: '{}' },
      {
        code: 'mode',
        type: 'Enum',
        values: '{"range":["hot","eco","cold","comfortable1","comfortable2","auto"]}',
      },
      { code: 'timer_switch', type: 'Boolean', values: '{}' },
      { code: 'travel_switch', type: 'Boolean', values: '{}' },
      { code: 'lock_switch', type: 'Boolean', values: '{}' },
      { code: 'temp_set', type: 'Integer', values: '{"min":5,"max":35,"scale":0,"step":1}' },
    ],
    status: [
      { code: 'switch', type: 'Boolean', values: '{}' },
      {
        code: 'mode',
        type: 'Enum',
        values: '{"range":["hot","eco","cold","comfortable1","comfortable2","auto"]}',
      },
      {
        code: 'cur_mode',
        type: 'Enum',
        values: '{"range":["hot","eco","cold","comfortable1","comfortable2","auto"]}',
      },
      { code: 'timer_switch', type: 'Boolean', values: '{}' },
      { code: 'travel_switch', type: 'Boolean', values: '{}' },
      { code: 'lock_switch', type: 'Boolean', values: '{}' },
      { code: 'temp_set', type: 'Integer', values: '{"min":5,"max":35,"scale":0,"step":1}' },
      { code: 'week_data', type: 'Raw', values: '{}' },
    ],
  },
  properties: {
    properties: [
      { code: 'switch', dp_id: 1, type: 'bool', value: true },
      { code: 'mode', dp_id: 2, type: 'enum', value: 'hot' },
      { code: 'timer_switch', dp_id: 102, type: 'bool', value: false },
      { code: 'travel_switch', dp_id: 103, type: 'bool', value: false },
      { code: 'cur_mode', dp_id: 104, type: 'enum', value: 'hot' },
      { code: 'lock_switch', dp_id: 107, type: 'bool', value: false },
    ],
  },
};

const gladys = createFakeGladys();

test('the RP5 and the eCosy are detected as pilot thermostats', () => {
  assert.equal(getDeviceType(RP5_DEVICE), DEVICE_TYPES.PILOT_THERMOSTAT);
  assert.equal(getDeviceType(ECOSY_DEVICE), DEVICE_TYPES.PILOT_THERMOSTAT);
});

test('convertDevice maps the RP5 features (thing model based)', () => {
  const device = convertDevice(gladys, RP5_DEVICE);

  assert.equal(device.device_type, DEVICE_TYPES.PILOT_THERMOSTAT);
  const byCode = Object.fromEntries(
    device.features.map((f) => [f.external_id.split(':').pop(), f]),
  );
  assert.deepEqual(Object.keys(byCode).sort(), [
    'average_power',
    'child_lock',
    'electricity_statistics',
    'mode',
    'running_mode',
    'temp_current',
    'temp_set',
    'window_state',
  ]);

  // Curated names on colliding types.
  assert.equal(byCode.mode.name, 'Mode');
  assert.equal(byCode.running_mode.name, 'Current mode');
  assert.equal(byCode.child_lock.name, 'Child lock');
  assert.equal(byCode.window_state.name, 'Window state');

  assert.equal(byCode.mode.category, DEVICE_FEATURE_CATEGORIES.HEATER);
  assert.equal(byCode.mode.type, DEVICE_FEATURE_TYPES.HEATER.PILOT_WIRE_MODE);
  assert.equal(byCode.mode.read_only, false);
  assert.equal(byCode.mode.has_feedback, true);
  assert.equal(byCode.running_mode.read_only, true);

  // The scaled setpoint bounds become real degrees (50..3000, scale 1 -> 5..300).
  assert.equal(byCode.temp_set.category, DEVICE_FEATURE_CATEGORIES.THERMOSTAT);
  assert.equal(byCode.temp_set.type, DEVICE_FEATURE_TYPES.THERMOSTAT.TARGET_TEMPERATURE);
  assert.equal(byCode.temp_set.min, 5);
  assert.equal(byCode.temp_set.max, 300);
  assert.equal(byCode.temp_set.scale, 1);

  assert.equal(byCode.temp_current.category, DEVICE_FEATURE_CATEGORIES.TEMPERATURE_SENSOR);
  assert.equal(byCode.temp_current.scale, 1);
  assert.equal(byCode.window_state.category, DEVICE_FEATURE_CATEGORIES.OPENING_SENSOR);
  assert.equal(byCode.electricity_statistics.type, DEVICE_FEATURE_TYPES.ENERGY_SENSOR.INDEX_TODAY);
  assert.equal(byCode.average_power.type, DEVICE_FEATURE_TYPES.ENERGY_SENSOR.POWER);
});

test('convertDevice maps the eCosy variant (own vocabulary, no setpoint)', () => {
  const device = convertDevice(gladys, ECOSY_DEVICE);

  assert.equal(device.device_type, DEVICE_TYPES.PILOT_THERMOSTAT);
  const byCode = Object.fromEntries(
    device.features.map((f) => [f.external_id.split(':').pop(), f]),
  );
  // temp_set / week_data are ignored on this variant.
  assert.deepEqual(Object.keys(byCode).sort(), [
    'cur_mode',
    'lock_switch',
    'mode',
    'switch',
    'timer_switch',
    'travel_switch',
  ]);

  assert.equal(byCode.mode.name, 'Mode');
  assert.equal(byCode.cur_mode.name, 'Current mode');
  // The mapping read_only override wins over the rw spec of cur_mode.
  assert.equal(byCode.cur_mode.read_only, true);
  assert.equal(byCode.timer_switch.name, 'Program');
  assert.equal(byCode.travel_switch.name, 'Holiday mode');
  assert.equal(byCode.lock_switch.category, DEVICE_FEATURE_CATEGORIES.CHILD_LOCK);
  // The tuyaEnum mapping metadata never leaks onto the persisted feature.
  assert.equal(byCode.mode.tuyaEnum, undefined);
});

function createHandler(rawDevice) {
  const fake = createFakeGladys();
  const handler = new TuyaHandler(fake);
  const converted = convertDevice(fake, rawDevice);
  const device = {
    external_id: converted.external_id,
    device_type: converted.device_type,
    features: converted.features,
    params: [
      { name: DEVICE_PARAM_NAME.DEVICE_ID, value: rawDevice.id },
      { name: DEVICE_PARAM_NAME.PRODUCT_ID, value: rawDevice.product_id },
    ],
  };
  return { fake, handler, device };
}

test('poll reads the RP5 states from the cloud (fixture values)', async () => {
  const { fake, handler, device } = createHandler(RP5_DEVICE);
  handler.connector = {
    request: async () => ({
      success: true,
      result: [
        { code: 'mode', value: 'Anti_forst' },
        { code: 'running_mode', value: 'Anti_forst' },
        { code: 'child_lock', value: false },
        { code: 'electricity_statistics', value: 0 },
        { code: 'temp_current', value: 152 },
        { code: 'average_power', value: 20 },
        { code: 'window_state', value: false },
        { code: 'temp_set', value: 210 },
      ],
    }),
  };

  await handler.poll(device);

  const states = Object.fromEntries(fake.published.map((p) => [p.featureExternalId, p.state]));
  assert.equal(states['ext:tuya:device:rp5:mode'], PILOT_WIRE_MODE.FROST_PROTECTION);
  assert.equal(states['ext:tuya:device:rp5:running_mode'], PILOT_WIRE_MODE.FROST_PROTECTION);
  assert.equal(states['ext:tuya:device:rp5:child_lock'], 0);
  assert.equal(states['ext:tuya:device:rp5:temp_current'], 15.2);
  assert.equal(states['ext:tuya:device:rp5:temp_set'], 21);
  assert.equal(states['ext:tuya:device:rp5:average_power'], 2);
  assert.equal(states['ext:tuya:device:rp5:window_state'], OPENING_SENSOR_STATE.CLOSE);
});

test('a local DPS read publishes the RP5 states (core local-dps fixture)', async () => {
  const { fake, handler, device } = createHandler(RP5_DEVICE);
  handler.config = { localMode: true };
  device.params.push(
    { name: DEVICE_PARAM_NAME.IP_ADDRESS, value: '10.0.0.15' },
    { name: DEVICE_PARAM_NAME.LOCAL_KEY, value: 'lk' },
    { name: DEVICE_PARAM_NAME.PROTOCOL_VERSION, value: '3.5' },
  );
  handler.localRead = async () => ({
    dps: {
      101: 'Anti_forst',
      102: false,
      112: 0,
      116: 152,
      117: 20,
      123: false,
      125: 210,
      131: 'Anti_forst',
    },
  });

  await handler.poll(device);

  const states = Object.fromEntries(fake.published.map((p) => [p.featureExternalId, p.state]));
  assert.equal(states['ext:tuya:device:rp5:mode'], PILOT_WIRE_MODE.FROST_PROTECTION);
  assert.equal(states['ext:tuya:device:rp5:temp_current'], 15.2);
  assert.equal(states['ext:tuya:device:rp5:temp_set'], 21);
  assert.equal(states['ext:tuya:device:rp5:window_state'], OPENING_SENSOR_STATE.CLOSE);
});

test('the pilot thermostat local DPS mappings resolve per variant', () => {
  const rp5 = {
    device_type: DEVICE_TYPES.PILOT_THERMOSTAT,
    params: [{ name: DEVICE_PARAM_NAME.PRODUCT_ID, value: 'c03zek9b5daz7omr' }],
  };
  assert.equal(getLocalDpsFromCode('mode', rp5), 101);
  assert.equal(getLocalDpsFromCode('temp_set', rp5), 125);
  assert.equal(getLocalDpsFromCode('running_mode', rp5), 131);
  // Strict: no switch_N inference on this family.
  assert.equal(getLocalDpsFromCode('switch', rp5), null);

  const ecosy = {
    device_type: DEVICE_TYPES.PILOT_THERMOSTAT,
    params: [{ name: DEVICE_PARAM_NAME.PRODUCT_ID, value: 'evyy1wbhi4t7uftn' }],
  };
  assert.equal(getLocalDpsFromCode('switch', ecosy), 1);
  assert.equal(getLocalDpsFromCode('mode', ecosy), 2);
  assert.equal(getLocalDpsFromCode('cur_mode', ecosy), 104);
  assert.equal(getLocalDpsFromCode('lock_switch', ecosy), 107);
});

test('setValue writes the RP5 mode, setpoint and child lock', async () => {
  const { handler, device } = createHandler(RP5_DEVICE);
  const commands = [];
  handler.connector = {
    request: async ({ body }) => {
      commands.push(body.commands[0]);
      return { success: true };
    },
  };
  const feature = (code) => device.features.find((f) => f.external_id.endsWith(`:${code}`));

  await handler.setValue(device, feature('mode'), PILOT_WIRE_MODE.ECO);
  await handler.setValue(device, feature('temp_set'), 21.5);
  await handler.setValue(device, feature('child_lock'), 1);

  assert.deepEqual(commands, [
    { code: 'mode', value: 'ECO' },
    { code: 'temp_set', value: 215 },
    { code: 'child_lock', value: true },
  ]);
});

test('setValue maps the eCosy vocabulary and rejects unsupported modes', async () => {
  const { handler, device } = createHandler(ECOSY_DEVICE);
  const commands = [];
  handler.connector = {
    request: async ({ body }) => {
      commands.push(body.commands[0]);
      return { success: true };
    },
  };
  const feature = (code) => device.features.find((f) => f.external_id.endsWith(`:${code}`));

  await handler.setValue(device, feature('mode'), PILOT_WIRE_MODE.COMFORT);
  await handler.setValue(device, feature('mode'), PILOT_WIRE_MODE.PROGRAMMING);
  assert.deepEqual(commands, [
    { code: 'mode', value: 'hot' },
    { code: 'mode', value: 'auto' },
  ]);

  // OFF is not a mode on the eCosy (on/off is the dedicated switch DPS):
  // the command is rejected instead of sending garbage.
  await assert.rejects(
    () => handler.setValue(device, feature('mode'), PILOT_WIRE_MODE.OFF),
    /not supported/,
  );
});

test('poll restores the thermostat scale lost by Gladys persistence', async () => {
  const { fake, handler, device } = createHandler(RP5_DEVICE);
  // Simulate a device read back from the Gladys DB: no scale, no device_type.
  device.features = device.features.map((f) => {
    const { scale: _scale, ...rest } = f;
    return rest;
  });
  delete device.device_type;
  handler.connector = {
    request: async () => ({
      success: true,
      result: [
        { code: 'temp_current', value: 152 },
        { code: 'temp_set', value: 210 },
      ],
    }),
  };

  await handler.poll(device);

  const states = Object.fromEntries(fake.published.map((p) => [p.featureExternalId, p.state]));
  assert.equal(states['ext:tuya:device:rp5:temp_current'], 15.2);
  assert.equal(states['ext:tuya:device:rp5:temp_set'], 21);
});
