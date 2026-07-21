import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DEVICE_FEATURE_CATEGORIES, DEVICE_FEATURE_TYPES } from '@gladysassistant/integration-sdk';

import { TuyaHandler } from '../../src/tuya/handler.js';
import { convertDevice } from '../../src/tuya/device/tuya.convertDevice.js';
import { getLocalDpsFromCode } from '../../src/tuya/device/tuya.localMapping.js';
import { getDeviceType, DEVICE_TYPES } from '../../src/tuya/mappings/index.js';
import { AC_MODE } from '../../src/devices/airConditioner.js';
import { DEVICE_PARAM_NAME } from '../../src/tuya/constants.js';
import { createFakeGladys } from '../helpers/fakeGladys.js';

// Realistic kt air conditioner, ported from the core branch test fixture
// (air-conditioner-f3goccgfj6qino4c/input-device.json), trimmed to the fields
// the conversion reads.
const AC_DEVICE = {
  id: 'ac1',
  name: 'Clim Salon',
  product_name: 'Air Conditioner',
  model: 'Air Conditioner',
  product_id: 'f3goccgfj6qino4c',
  local_key: 'lk',
  ip: '10.0.0.20',
  protocol_version: '3.3',
  local_override: true,
  online: true,
  specifications: {
    category: 'kt',
    functions: [
      { code: 'switch', type: 'Boolean', values: '{}' },
      { code: 'temp_unit_convert', type: 'Enum', values: '{"range":["c","f"]}' },
      {
        code: 'temp_set',
        type: 'Integer',
        values: '{"unit":"℃","min":160,"max":880,"scale":1,"step":10}',
      },
      { code: 'mode', type: 'Enum', values: '{"range":["auto","cold","wet","heat","fan"]}' },
      {
        code: 'fan_speed_enum',
        type: 'Enum',
        values: '{"range":["auto","low","mid","high"]}',
      },
    ],
    status: [
      { code: 'switch', type: 'Boolean', values: '{}' },
      {
        code: 'temp_set',
        type: 'Integer',
        values: '{"unit":"℃","min":160,"max":880,"scale":1,"step":10}',
      },
      {
        code: 'temp_current',
        type: 'Integer',
        values: '{"unit":"℃","min":0,"max":600,"scale":1,"step":1}',
      },
      { code: 'mode', type: 'Enum', values: '{"range":["auto","cold","wet","heat","fan"]}' },
    ],
  },
  properties: {
    properties: [
      { code: 'Power', dp_id: 1, type: 'bool', value: true },
      { code: 'temp_set', dp_id: 2, type: 'value', value: 200 },
      { code: 'temp_current', dp_id: 3, type: 'value', value: 230 },
      { code: 'mode', dp_id: 4, type: 'enum', value: 'heat' },
      { code: 'windspeed', dp_id: 5, type: 'enum', value: 'auto' },
    ],
  },
};

const gladys = createFakeGladys();

test('an air conditioner is detected from its kt category and codes', () => {
  assert.equal(getDeviceType(AC_DEVICE), DEVICE_TYPES.AIR_CONDITIONER);
});

test('convertDevice maps the supported AC features (power, mode, setpoint, ambient)', () => {
  const device = convertDevice(gladys, AC_DEVICE);

  assert.equal(device.device_type, DEVICE_TYPES.AIR_CONDITIONER);
  const byCode = Object.fromEntries(
    device.features.map((f) => [f.external_id.split(':').pop(), f]),
  );

  // The four supported features are exposed...
  assert.equal(byCode.Power.category, DEVICE_FEATURE_CATEGORIES.AIR_CONDITIONING);
  assert.equal(byCode.Power.type, DEVICE_FEATURE_TYPES.AIR_CONDITIONING.BINARY);
  assert.equal(byCode.mode.type, DEVICE_FEATURE_TYPES.AIR_CONDITIONING.MODE);
  assert.equal(byCode.mode.min, AC_MODE.AUTO);
  assert.equal(byCode.mode.max, AC_MODE.FAN);
  assert.equal(byCode.temp_set.type, DEVICE_FEATURE_TYPES.AIR_CONDITIONING.TARGET_TEMPERATURE);
  assert.equal(byCode.temp_current.category, DEVICE_FEATURE_CATEGORIES.TEMPERATURE_SENSOR);

  // ...and nothing else: windspeed/switch/temp_unit_convert are ignored until
  // the core ships the fan-speed/swing feature types.
  assert.deepEqual(Object.keys(byCode).sort(), ['Power', 'mode', 'temp_current', 'temp_set']);

  // The scaled spec bounds (160..880, scale 1) become real degrees.
  assert.equal(byCode.temp_set.min, 16);
  assert.equal(byCode.temp_set.max, 88);
  assert.equal(byCode.temp_set.scale, 1);
});

function createHandlerWithFeatures() {
  const fake = createFakeGladys();
  const handler = new TuyaHandler(fake);
  const converted = convertDevice(fake, AC_DEVICE);
  const device = {
    external_id: converted.external_id,
    device_type: converted.device_type,
    features: converted.features,
    params: [{ name: DEVICE_PARAM_NAME.DEVICE_ID, value: 'ac1' }],
  };
  return { fake, handler, device };
}

test('poll reads the AC states from the cloud (mode enum, scaled temperatures)', async () => {
  const { fake, handler, device } = createHandlerWithFeatures();
  handler.connector = {
    request: async () => ({
      success: true,
      result: [
        { code: 'Power', value: true },
        { code: 'temp_set', value: 200 },
        { code: 'temp_current', value: 230 },
        { code: 'mode', value: 'heat' },
      ],
    }),
  };

  await handler.poll(device);

  const states = Object.fromEntries(fake.published.map((p) => [p.featureExternalId, p.state]));
  assert.equal(states['ext:tuya:device:ac1:Power'], 1);
  assert.equal(states['ext:tuya:device:ac1:temp_set'], 20);
  assert.equal(states['ext:tuya:device:ac1:temp_current'], 23);
  assert.equal(states['ext:tuya:device:ac1:mode'], AC_MODE.HEATING);
});

test('setValue writes the AC mode and the scaled setpoint to the cloud', async () => {
  const { handler, device } = createHandlerWithFeatures();
  const commands = [];
  handler.connector = {
    request: async ({ body }) => {
      commands.push(body.commands[0]);
      return { success: true };
    },
  };
  const feature = (code) => device.features.find((f) => f.external_id.endsWith(`:${code}`));

  await handler.setValue(device, feature('mode'), AC_MODE.COOLING);
  await handler.setValue(device, feature('temp_set'), 21.5);
  await handler.setValue(device, feature('Power'), 0);

  assert.deepEqual(commands, [
    { code: 'mode', value: 'cold' },
    { code: 'temp_set', value: 215 },
    { code: 'Power', value: false },
  ]);
});

test('the AC local DPS mapping resolves the supported codes (strict)', () => {
  const device = { device_type: DEVICE_TYPES.AIR_CONDITIONER };
  assert.equal(getLocalDpsFromCode('power', device), 1);
  assert.equal(getLocalDpsFromCode('switch', device), 1);
  assert.equal(getLocalDpsFromCode('temp_set', device), 2);
  assert.equal(getLocalDpsFromCode('temp_current', device), 3);
  assert.equal(getLocalDpsFromCode('mode', device), 4);
  // Strict mapping: unsupported codes never fall back to switch_N inference.
  assert.equal(getLocalDpsFromCode('windspeed', device), null);
});

test('a local DPS poll publishes the AC states (persistent session read)', async () => {
  const { fake, handler, device } = createHandlerWithFeatures();
  handler.config = { localMode: true };
  device.params.push(
    { name: DEVICE_PARAM_NAME.IP_ADDRESS, value: '10.0.0.20' },
    { name: DEVICE_PARAM_NAME.LOCAL_KEY, value: 'lk' },
    { name: DEVICE_PARAM_NAME.PROTOCOL_VERSION, value: '3.3' },
  );
  handler.localRead = async () => ({ dps: { 1: true, 2: 200, 3: 230, 4: 'heat' } });

  await handler.poll(device);

  const states = Object.fromEntries(fake.published.map((p) => [p.featureExternalId, p.state]));
  assert.equal(states['ext:tuya:device:ac1:Power'], 1);
  assert.equal(states['ext:tuya:device:ac1:temp_set'], 20);
  assert.equal(states['ext:tuya:device:ac1:temp_current'], 23);
  assert.equal(states['ext:tuya:device:ac1:mode'], AC_MODE.HEATING);
});
