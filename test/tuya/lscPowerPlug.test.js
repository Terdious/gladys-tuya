import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DEVICE_FEATURE_CATEGORIES, DEVICE_FEATURE_TYPES } from '@gladysassistant/integration-sdk';

import { TuyaHandler } from '../../src/tuya/handler.js';
import { convertDevice } from '../../src/tuya/device/tuya.convertDevice.js';
import { getLocalDpsFromCode } from '../../src/tuya/device/tuya.localMapping.js';
import { getDeviceType, DEVICE_TYPES } from '../../src/tuya/mappings/index.js';
import { DEVICE_PARAM_NAME } from '../../src/tuya/constants.js';
import { createFakeGladys } from '../helpers/fakeGladys.js';

// LSC Power Plug FR incl. Power meter, ported from the core PR7 branch test
// fixture (smart-socket-b61eihfqeaexn54g/input-device.json).
const LSC_DEVICE = {
  id: 'lsc1',
  name: 'Chauffage cabinet',
  product_name: 'LSC Power Plug FR incl. Power meter',
  model: 'LSC Power Plug FR incl. Power meter',
  product_id: 'b61eihfqeaexn54g',
  local_key: 'lk',
  ip: '192.168.1.50',
  protocol_version: '3.5',
  local_override: true,
  online: true,
  specifications: {
    category: 'cz',
    functions: [
      { code: 'switch_1', type: 'Boolean', values: '{}' },
      { code: 'child_lock', type: 'Boolean', values: '{}' },
      { code: 'light_mode', type: 'Enum', values: '{"range":["relay","pos","none"]}' },
      { code: 'relay_status', type: 'Enum', values: '{"range":["power_off","power_on","last"]}' },
    ],
    status: [
      { code: 'switch_1', type: 'Boolean', values: '{}' },
      { code: 'add_ele', type: 'Integer', values: '{"min":0,"max":50000,"scale":3,"step":100}' },
      {
        code: 'cur_current',
        type: 'Integer',
        values: '{"unit":"mA","min":0,"max":30000,"scale":0,"step":1}',
      },
      {
        code: 'cur_power',
        type: 'Integer',
        values: '{"unit":"W","min":0,"max":80000,"scale":1,"step":1}',
      },
      {
        code: 'cur_voltage',
        type: 'Integer',
        values: '{"unit":"V","min":0,"max":5000,"scale":1,"step":1}',
      },
      { code: 'child_lock', type: 'Boolean', values: '{}' },
      { code: 'light_mode', type: 'Enum', values: '{"range":["relay","pos","none"]}' },
      { code: 'relay_status', type: 'Enum', values: '{"range":["power_off","power_on","last"]}' },
    ],
  },
  properties: {
    properties: [
      { code: 'switch_1', dp_id: 1, type: 'bool', value: false },
      { code: 'add_ele', dp_id: 17, type: 'value', value: 1 },
      { code: 'cur_current', dp_id: 18, type: 'value', value: 0 },
      { code: 'cur_power', dp_id: 19, type: 'value', value: 0 },
      { code: 'cur_voltage', dp_id: 20, type: 'value', value: 2340 },
      { code: 'child_lock', dp_id: 41, type: 'bool', value: false },
    ],
  },
};

const gladys = createFakeGladys();

test('the LSC plug is detected as a smart socket from its cz category', () => {
  assert.equal(getDeviceType(LSC_DEVICE), DEVICE_TYPES.SMART_SOCKET);
});

test('convertDevice maps the LSC features and ignores the configuration codes', () => {
  const device = convertDevice(gladys, LSC_DEVICE);
  const byCode = Object.fromEntries(
    device.features.map((f) => [f.external_id.split(':').pop(), f]),
  );

  // switch + child lock + the four telemetry features, nothing else:
  // light_mode / relay_status are configuration codes, not features.
  assert.deepEqual(Object.keys(byCode).sort(), [
    'add_ele',
    'child_lock',
    'cur_current',
    'cur_power',
    'cur_voltage',
    'switch_1',
  ]);

  assert.equal(byCode.switch_1.category, DEVICE_FEATURE_CATEGORIES.SWITCH);
  assert.equal(byCode.child_lock.category, DEVICE_FEATURE_CATEGORIES.CHILD_LOCK);
  assert.equal(byCode.child_lock.type, DEVICE_FEATURE_TYPES.CHILD_LOCK.BINARY);
  assert.equal(byCode.child_lock.read_only, false);
  assert.equal(byCode.add_ele.type, DEVICE_FEATURE_TYPES.SWITCH.ENERGY);
  assert.equal(byCode.add_ele.read_only, true);
  assert.equal(byCode.add_ele.scale, 3);
  assert.equal(byCode.cur_power.type, DEVICE_FEATURE_TYPES.SWITCH.POWER);
  assert.equal(byCode.cur_voltage.type, DEVICE_FEATURE_TYPES.SWITCH.VOLTAGE);
  assert.equal(byCode.cur_voltage.scale, 1);
  assert.equal(byCode.cur_current.type, DEVICE_FEATURE_TYPES.SWITCH.CURRENT);
});

test('the smart socket local DPS mapping resolves the LSC telemetry codes', () => {
  const device = { device_type: DEVICE_TYPES.SMART_SOCKET };
  assert.equal(getLocalDpsFromCode('add_ele', device), 17);
  assert.equal(getLocalDpsFromCode('cur_current', device), 18);
  assert.equal(getLocalDpsFromCode('cur_power', device), 19);
  assert.equal(getLocalDpsFromCode('cur_voltage', device), 20);
  assert.equal(getLocalDpsFromCode('child_lock', device), 41);
  // Configuration DPS stay out of the strict mapping.
  assert.equal(getLocalDpsFromCode('light_mode', device), null);
});

function createHandlerWithFeatures() {
  const fake = createFakeGladys();
  const handler = new TuyaHandler(fake);
  const converted = convertDevice(fake, LSC_DEVICE);
  const device = {
    external_id: converted.external_id,
    device_type: converted.device_type,
    features: converted.features,
    params: [{ name: DEVICE_PARAM_NAME.DEVICE_ID, value: 'lsc1' }],
  };
  return { fake, handler, device };
}

test('poll reads the LSC states from the cloud (scaled telemetry, child lock)', async () => {
  const { fake, handler, device } = createHandlerWithFeatures();
  handler.connector = {
    request: async () => ({
      success: true,
      result: [
        { code: 'switch_1', value: false },
        { code: 'add_ele', value: 1 },
        { code: 'cur_current', value: 0 },
        { code: 'cur_power', value: 0 },
        { code: 'cur_voltage', value: 2340 },
        { code: 'child_lock', value: false },
      ],
    }),
  };

  await handler.poll(device);

  const states = Object.fromEntries(fake.published.map((p) => [p.featureExternalId, p.state]));
  assert.equal(states['ext:tuya:device:lsc1:switch_1'], 0);
  assert.equal(states['ext:tuya:device:lsc1:child_lock'], 0);
  // Spec scales: add_ele scale 3 (1 -> 0.001 kWh), voltage scale 1 (2340 -> 234 V).
  assert.equal(states['ext:tuya:device:lsc1:add_ele'], 0.001);
  assert.equal(states['ext:tuya:device:lsc1:cur_voltage'], 234);
  assert.equal(states['ext:tuya:device:lsc1:cur_power'], 0);
  assert.equal(states['ext:tuya:device:lsc1:cur_current'], 0);
});

test('a local DPS read publishes the LSC telemetry (ignored DPS stay silent)', async () => {
  const { fake, handler, device } = createHandlerWithFeatures();
  handler.config = { localMode: true };
  device.params.push(
    { name: DEVICE_PARAM_NAME.IP_ADDRESS, value: '192.168.1.50' },
    { name: DEVICE_PARAM_NAME.LOCAL_KEY, value: 'lk' },
    { name: DEVICE_PARAM_NAME.PROTOCOL_VERSION, value: '3.5' },
  );
  // Real LAN payload from the core fixture: includes the calibration DPS
  // (9, 21..25, 38, 39, 40, 44) that must not produce any state.
  handler.localRead = async () => ({
    dps: {
      1: false,
      9: 0,
      18: 0,
      19: 0,
      20: 2268,
      21: 1,
      22: 566,
      23: 26471,
      24: 14621,
      25: 2840,
      38: 'memory',
      39: false,
      40: 'relay',
      41: false,
      44: '',
    },
  });

  await handler.poll(device);

  const states = Object.fromEntries(fake.published.map((p) => [p.featureExternalId, p.state]));
  assert.equal(states['ext:tuya:device:lsc1:switch_1'], 0);
  assert.equal(states['ext:tuya:device:lsc1:child_lock'], 0);
  assert.equal(states['ext:tuya:device:lsc1:cur_voltage'], 226.8);
  assert.equal(states['ext:tuya:device:lsc1:cur_power'], 0);
  assert.equal(states['ext:tuya:device:lsc1:cur_current'], 0);
  // No state published for the ignored/unmapped DPS.
  const publishedIds = Object.keys(states);
  assert.equal(publishedIds.length, 5);
});

test('setValue writes the switch and the child lock to the cloud', async () => {
  const { handler, device } = createHandlerWithFeatures();
  const commands = [];
  handler.connector = {
    request: async ({ body }) => {
      commands.push(body.commands[0]);
      return { success: true };
    },
  };
  const feature = (code) => device.features.find((f) => f.external_id.endsWith(`:${code}`));

  await handler.setValue(device, feature('switch_1'), 1);
  await handler.setValue(device, feature('child_lock'), 1);
  await handler.setValue(device, feature('child_lock'), 0);

  assert.deepEqual(commands, [
    { code: 'switch_1', value: true },
    { code: 'child_lock', value: true },
    { code: 'child_lock', value: false },
  ]);
});
