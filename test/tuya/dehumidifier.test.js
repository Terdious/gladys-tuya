import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DEVICE_FEATURE_CATEGORIES, DEVICE_FEATURE_TYPES } from '@gladysassistant/integration-sdk';

import { TuyaHandler } from '../../src/tuya/handler.js';
import { convertDevice } from '../../src/tuya/device/tuya.convertDevice.js';
import { getLocalDpsFromCode } from '../../src/tuya/device/tuya.localMapping.js';
import { getDeviceType, DEVICE_TYPES } from '../../src/tuya/mappings/index.js';
import { dehumidifier } from '../../src/devices/dehumidifier.js';
import { globalCloudMapping } from '../../src/devices/index.js';
import { DEVICE_PARAM_NAME } from '../../src/tuya/constants.js';
import { createFakeGladys } from '../helpers/fakeGladys.js';

// A dehumidifier with the standard `cs` instruction set, modelled on the
// Qlima D825A of issue #39 (category cs; timer, fan speed, humidity and
// temperature requested).
const DEHUMIDIFIER_DEVICE = {
  id: 'dehum1',
  name: 'D825A',
  product_name: 'Dehumidifier',
  model: 'D825A',
  online: true,
  specifications: {
    category: 'cs',
    functions: [
      { code: 'switch', type: 'Boolean', values: '{}' },
      {
        code: 'dehumidify_set_value',
        type: 'Integer',
        values: '{"unit":"%","min":25,"max":80,"scale":0,"step":5}',
      },
      { code: 'fan_speed_enum', type: 'Enum', values: '{"range":["low","high"]}' },
      { code: 'countdown_set', type: 'Enum', values: '{"range":["cancel","1h","2h","3h"]}' },
      { code: 'child_lock', type: 'Boolean', values: '{}' },
    ],
    status: [
      { code: 'switch', type: 'Boolean', values: '{}' },
      {
        code: 'dehumidify_set_value',
        type: 'Integer',
        values: '{"unit":"%","min":25,"max":80,"scale":0,"step":5}',
      },
      { code: 'fan_speed_enum', type: 'Enum', values: '{"range":["low","high"]}' },
      { code: 'countdown_set', type: 'Enum', values: '{"range":["cancel","1h","2h","3h"]}' },
      { code: 'child_lock', type: 'Boolean', values: '{}' },
      {
        code: 'humidity_indoor',
        type: 'Integer',
        values: '{"unit":"%","min":0,"max":100,"scale":0,"step":1}',
      },
      {
        code: 'temp_indoor',
        type: 'Integer',
        values: '{"unit":"℃","min":-20,"max":100,"scale":0,"step":1}',
      },
      {
        code: 'countdown_left',
        type: 'Integer',
        values: '{"unit":"min","min":0,"max":1440,"scale":0,"step":1}',
      },
      { code: 'fault', type: 'Bitmap', values: '{"label":["tankfull","defrost","E1","E2"]}' },
    ],
  },
};

const gladys = createFakeGladys();
const featuresByCode = (device) =>
  Object.fromEntries(device.features.map((f) => [f.external_id.split(':').pop(), f]));

const createdDevice = (fake) => {
  const converted = convertDevice(fake, DEHUMIDIFIER_DEVICE);
  return {
    external_id: converted.external_id,
    device_type: converted.device_type,
    features: converted.features,
    params: [{ name: DEVICE_PARAM_NAME.DEVICE_ID, value: 'dehum1' }],
  };
};

test('a dehumidifier is detected from its cs category and codes', () => {
  assert.equal(getDeviceType(DEHUMIDIFIER_DEVICE), DEVICE_TYPES.DEHUMIDIFIER);
  // A plain switch is not enough to claim a cs device: it keeps the global
  // mapping.
  assert.equal(
    getDeviceType({
      specifications: { category: 'cs', status: [{ code: 'switch', type: 'Boolean' }] },
    }),
    DEVICE_TYPES.UNKNOWN,
  );
});

test('convertDevice maps the features requested in issue #39', () => {
  const byCode = featuresByCode(convertDevice(gladys, DEHUMIDIFIER_DEVICE));

  assert.equal(byCode.switch.category, DEVICE_FEATURE_CATEGORIES.SWITCH);

  assert.equal(byCode.humidity_indoor.category, DEVICE_FEATURE_CATEGORIES.HUMIDITY_SENSOR);
  assert.equal(byCode.humidity_indoor.unit, 'percent');
  assert.equal(byCode.humidity_indoor.read_only, true);

  assert.equal(byCode.temp_indoor.category, DEVICE_FEATURE_CATEGORIES.TEMPERATURE_SENSOR);

  // Fan speed: the options ARE the strings the device declares, in its order.
  assert.equal(byCode.fan_speed_enum.category, DEVICE_FEATURE_CATEGORIES.TEXT);
  assert.equal(byCode.fan_speed_enum.type, DEVICE_FEATURE_TYPES.TEXT.SELECT);
  assert.equal(byCode.fan_speed_enum.read_only, false);
  assert.deepEqual(byCode.fan_speed_enum.supported_options, [
    { value: 'low', label: 'Low', sort_order: 0 },
    { value: 'high', label: 'High', sort_order: 1 },
  ]);

  // Timer: "cancel" reads as Off, the durations keep the device spelling.
  assert.deepEqual(
    byCode.countdown_set.supported_options.map((o) => [o.value, o.label]),
    [
      ['cancel', 'Off'],
      ['1h', '1h'],
      ['2h', '2h'],
      ['3h', '3h'],
    ],
  );
  assert.equal(byCode.countdown_left.category, DEVICE_FEATURE_CATEGORIES.DURATION);
  assert.equal(byCode.countdown_left.unit, 'minutes');

  assert.equal(byCode.child_lock.category, DEVICE_FEATURE_CATEGORIES.CHILD_LOCK);

  // The mapping-only hints never reach the persisted feature.
  assert.equal(byCode.fan_speed_enum.selectOptionsFromRange, undefined);
  assert.equal(byCode.fan_speed_enum.selectLabels, undefined);

  // No humidity-setpoint type in Gladys, and the alarm bitmap is unreadable.
  assert.deepEqual(Object.keys(byCode).sort(), [
    'child_lock',
    'countdown_left',
    'countdown_set',
    'fan_speed_enum',
    'humidity_indoor',
    'switch',
    'temp_indoor',
  ]);
});

test('an enum without a declared range is left out instead of published empty', () => {
  const byCode = featuresByCode(
    convertDevice(gladys, {
      ...DEHUMIDIFIER_DEVICE,
      specifications: {
        category: 'cs',
        status: [
          { code: 'humidity_indoor', type: 'Integer', values: '{"min":0,"max":100}' },
          { code: 'mode', type: 'Enum', values: '{}' },
        ],
      },
    }),
  );
  assert.equal(byCode.mode, undefined);
  assert.ok(byCode.humidity_indoor);
});

test('the select features are skipped on a core older than 4.86.1', () => {
  const byCode = featuresByCode(
    convertDevice(gladys, DEHUMIDIFIER_DEVICE, { coreSupportsTextSelect: false }),
  );
  assert.equal(byCode.fan_speed_enum, undefined);
  assert.equal(byCode.countdown_set, undefined);
  assert.ok(byCode.humidity_indoor);
});

test('setValue sends the raw device strings back for the fan speed and the timer', async () => {
  const fake = createFakeGladys();
  const handler = new TuyaHandler(fake);
  const device = createdDevice(fake);
  const commands = [];
  handler.connector = {
    request: async ({ body }) => {
      commands.push(body.commands[0]);
      return { success: true };
    },
  };
  const feature = (code) => device.features.find((f) => f.external_id.endsWith(`:${code}`));

  await handler.setValue(device, feature('fan_speed_enum'), 'high');
  await handler.setValue(device, feature('countdown_set'), '2h');
  await handler.setValue(device, feature('switch'), 1);

  assert.deepEqual(commands, [
    { code: 'fan_speed_enum', value: 'high' },
    { code: 'countdown_set', value: '2h' },
    { code: 'switch', value: true },
  ]);
});

test('poll publishes humidity, temperature, fan speed and remaining time over the cloud', async () => {
  const fake = createFakeGladys();
  const handler = new TuyaHandler(fake);
  const device = createdDevice(fake);
  handler.connector = {
    request: async () => ({
      success: true,
      result: [
        { code: 'switch', value: true },
        { code: 'humidity_indoor', value: 58 },
        { code: 'temp_indoor', value: 21 },
        { code: 'fan_speed_enum', value: 'low' },
        { code: 'countdown_set', value: '2h' },
        { code: 'countdown_left', value: 95 },
        { code: 'fault', value: 0 },
      ],
    }),
  };

  await handler.poll(device);

  const byCode = Object.fromEntries(
    fake.published.map((p) => [p.featureExternalId.split(':').pop(), p.state]),
  );
  assert.equal(byCode.switch, 1);
  assert.equal(byCode.humidity_indoor, 58);
  assert.equal(byCode.temp_indoor, 21);
  // A TEXT state is published as `{ text }` (the core refuses a bare string).
  assert.deepEqual(byCode.fan_speed_enum, { text: 'low' });
  assert.deepEqual(byCode.countdown_set, { text: '2h' });
  assert.equal(byCode.countdown_left, 95);
});

test('every code of the global mapping is still handled by the dehumidifier mapping', () => {
  // A dehumidifier created as `unknown` before this type existed must not
  // lose a feature when the discovery now detects it.
  const missing = Object.keys(globalCloudMapping).filter(
    (code) => !dehumidifier.CLOUD_MAPPINGS[code],
  );
  assert.deepEqual(missing, []);
});

test('the dehumidifier has no LAN mapping yet: every code falls back to the cloud', () => {
  const device = { device_type: DEVICE_TYPES.DEHUMIDIFIER };
  assert.equal(getLocalDpsFromCode('switch', device), null);
  assert.equal(getLocalDpsFromCode('humidity_indoor', device), null);
});
