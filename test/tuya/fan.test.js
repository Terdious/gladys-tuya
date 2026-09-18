import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DEVICE_FEATURE_CATEGORIES, DEVICE_FEATURE_TYPES } from '@gladysassistant/integration-sdk';

import { TuyaHandler } from '../../src/tuya/handler.js';
import { convertDevice } from '../../src/tuya/device/tuya.convertDevice.js';
import { readValues, writeValues } from '../../src/tuya/device/tuya.deviceMapping.js';
import { getLocalDpsFromCode } from '../../src/tuya/device/tuya.localMapping.js';
import { getDeviceType, DEVICE_TYPES } from '../../src/tuya/mappings/index.js';
import { FAN_AIRFLOW_DIRECTION } from '../../src/devices/fan.js';
import { DEVICE_PARAM_NAME } from '../../src/tuya/constants.js';
import { createFakeGladys } from '../helpers/fakeGladys.js';

// The AV-TTW5-W decentralized heat-recovery ventilation unit reported on the
// forum, with the exact specifications dumped from the Tuya API Explorer: a
// `fs` fan with a 3-level speed, a light, and the usual fault bitmap. Before
// this mapping existed, only the on/off switch survived the discovery.
const FAN_DEVICE = {
  id: 'fan1',
  name: 'AV-TTW5-W',
  product_name: 'Ventilation',
  model: 'AV-TTW5-W',
  local_key: 'lk',
  ip: '192.168.1.42',
  protocol_version: '3.3',
  local_override: true,
  online: true,
  specifications: {
    category: 'fs',
    functions: [
      { code: 'switch', type: 'Boolean', values: '{}' },
      {
        code: 'fan_speed_percent',
        type: 'Integer',
        values: '{"unit":"","min":1,"max":3,"scale":0,"step":1}',
      },
      { code: 'light', type: 'Boolean', values: '{}' },
    ],
    status: [
      { code: 'switch', type: 'Boolean', values: '{}' },
      {
        code: 'fan_speed_percent',
        type: 'Integer',
        values: '{"unit":"","min":1,"max":3,"scale":0,"step":1}',
      },
      { code: 'light', type: 'Boolean', values: '{}' },
      { code: 'fault', type: 'Bitmap', values: '{"label":["E1","E2","E3","E4","E5"]}' },
    ],
  },
};

const gladys = createFakeGladys();

test('a fan is detected from its fs category and its speed code', () => {
  assert.equal(getDeviceType(FAN_DEVICE), DEVICE_TYPES.FAN);
  // ...and from its name alone, for a fan discovered without specifications.
  assert.equal(
    getDeviceType({ name: 'Ventilateur salon', status: [{ code: 'fan_speed_percent' }] }),
    DEVICE_TYPES.FAN,
  );
});

test('an fs device with no fan-specific code keeps the global mapping', () => {
  // A plain `switch` is not enough to claim the device: the fan mapping
  // REPLACES the global one, so an unknown fs product must keep falling back
  // to it rather than lose the codes the global mapping handles.
  const plainDevice = {
    id: 'fan2',
    name: 'Unknown fs device',
    specifications: {
      category: 'fs',
      status: [
        { code: 'switch', type: 'Boolean', values: '{}' },
        { code: 'countdown', type: 'Integer', values: '{}' },
      ],
    },
  };
  assert.equal(getDeviceType(plainDevice), DEVICE_TYPES.UNKNOWN);
});

test('convertDevice maps the speed slider and the light of the reported unit', () => {
  const device = convertDevice(gladys, FAN_DEVICE);
  const byCode = Object.fromEntries(
    device.features.map((f) => [f.external_id.split(':').pop(), f]),
  );

  assert.equal(device.device_type, DEVICE_TYPES.FAN);

  assert.equal(byCode.switch.category, DEVICE_FEATURE_CATEGORIES.SWITCH);
  assert.equal(byCode.switch.type, DEVICE_FEATURE_TYPES.SWITCH.BINARY);
  assert.equal(byCode.switch.read_only, false);

  // The speed takes the spec range as it is: a 1..3 slider, not a percentage
  // rescaled over three steps.
  assert.equal(byCode.fan_speed_percent.category, DEVICE_FEATURE_CATEGORIES.FAN);
  assert.equal(byCode.fan_speed_percent.type, DEVICE_FEATURE_TYPES.FAN.SPEED);
  assert.equal(byCode.fan_speed_percent.min, 1);
  assert.equal(byCode.fan_speed_percent.max, 3);
  assert.equal(byCode.fan_speed_percent.read_only, false);
  assert.equal(byCode.fan_speed_percent.has_feedback, true);

  assert.equal(byCode.light.category, DEVICE_FEATURE_CATEGORIES.LIGHT);
  assert.equal(byCode.light.type, DEVICE_FEATURE_TYPES.LIGHT.BINARY);
  assert.equal(byCode.light.read_only, false);

  // The error bitmap stays out (a raw bitmask is unreadable in Gladys).
  assert.deepEqual(Object.keys(byCode).sort(), ['fan_speed_percent', 'light', 'switch']);
});

test('setValue sends the raw speed level and booleans for the switches', async () => {
  const fake = createFakeGladys();
  const handler = new TuyaHandler(fake);
  const converted = convertDevice(fake, FAN_DEVICE);
  const device = {
    external_id: converted.external_id,
    device_type: converted.device_type,
    features: converted.features,
    params: [{ name: DEVICE_PARAM_NAME.DEVICE_ID, value: 'fan1' }],
  };
  const commands = [];
  handler.connector = {
    request: async ({ body }) => {
      commands.push(body.commands[0]);
      return { success: true };
    },
  };
  const feature = (code) => device.features.find((f) => f.external_id.endsWith(`:${code}`));

  await handler.setValue(device, feature('fan_speed_percent'), 2);
  await handler.setValue(device, feature('light'), 1);
  await handler.setValue(device, feature('switch'), 0);

  assert.deepEqual(commands, [
    // The integer DP takes the level as it is (writing 67 % would be rejected).
    { code: 'fan_speed_percent', value: 2 },
    { code: 'light', value: true },
    { code: 'switch', value: false },
  ]);
});

test('poll publishes the speed, the light and the on/off over the cloud', async () => {
  const fake = createFakeGladys();
  const handler = new TuyaHandler(fake);
  const converted = convertDevice(fake, FAN_DEVICE);
  const device = {
    external_id: converted.external_id,
    device_type: converted.device_type,
    features: converted.features,
    params: [{ name: DEVICE_PARAM_NAME.DEVICE_ID, value: 'fan1' }],
  };
  handler.connector = {
    request: async () => ({
      success: true,
      result: [
        { code: 'switch', value: true },
        { code: 'fan_speed_percent', value: 3 },
        { code: 'light', value: false },
        { code: 'fault', value: 0 },
      ],
    }),
  };

  await handler.poll(device);

  const byCode = Object.fromEntries(
    fake.published.map((p) => [p.featureExternalId.split(':').pop(), p.state]),
  );
  assert.equal(byCode.switch, 1);
  assert.equal(byCode.fan_speed_percent, 3);
  assert.equal(byCode.light, 0);
});

test('the airflow direction round-trips through the forward/reverse vocabulary', () => {
  const read =
    readValues[DEVICE_FEATURE_CATEGORIES.FAN][DEVICE_FEATURE_TYPES.FAN.AIRFLOW_DIRECTION];
  const write =
    writeValues[DEVICE_FEATURE_CATEGORIES.FAN][DEVICE_FEATURE_TYPES.FAN.AIRFLOW_DIRECTION];

  assert.equal(read('forward'), FAN_AIRFLOW_DIRECTION.FORWARD);
  assert.equal(read('reverse'), FAN_AIRFLOW_DIRECTION.REVERSE);
  // Aliases seen on other firmwares, and case-insensitive.
  assert.equal(read('Positive'), FAN_AIRFLOW_DIRECTION.FORWARD);
  assert.equal(read('negative'), FAN_AIRFLOW_DIRECTION.REVERSE);
  // An unknown string publishes no state instead of a wrong one.
  assert.equal(read('sideways'), null);

  assert.equal(write(FAN_AIRFLOW_DIRECTION.FORWARD), 'forward');
  assert.equal(write(FAN_AIRFLOW_DIRECTION.REVERSE), 'reverse');
  // Out of vocabulary: setValue rejects it rather than sending garbage.
  assert.equal(write(7), undefined);
});

test('the speed reader honours the feature scale and rejects a non-numeric DP', () => {
  const read = readValues[DEVICE_FEATURE_CATEGORIES.FAN][DEVICE_FEATURE_TYPES.FAN.SPEED];
  assert.equal(read(2, { scale: 0 }), 2);
  assert.equal(read(2, {}), 2);
  assert.equal(read(25, { scale: 1 }), 2.5);
  assert.equal(read('off'), null);
});

test('the fan has no LAN mapping yet: every code falls back to the cloud', () => {
  const device = { device_type: DEVICE_TYPES.FAN };
  // Strict mapping with no DPS: the per-product indexes are unknown, so the
  // cloud serves every feature even when local mode is on.
  assert.equal(getLocalDpsFromCode('switch', device), null);
  assert.equal(getLocalDpsFromCode('fan_speed_percent', device), null);
  assert.equal(getLocalDpsFromCode('light', device), null);
});
