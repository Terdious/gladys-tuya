import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DEVICE_FEATURE_CATEGORIES, DEVICE_FEATURE_TYPES } from '@gladysassistant/integration-sdk';

import { TuyaHandler } from '../../src/tuya/handler.js';
import { convertDevice } from '../../src/tuya/device/tuya.convertDevice.js';
import { getLocalDpsFromCode } from '../../src/tuya/device/tuya.localMapping.js';
import { getDeviceType, DEVICE_TYPES } from '../../src/tuya/mappings/index.js';
import { DEVICE_PARAM_NAME } from '../../src/tuya/constants.js';
import { createFakeGladys } from '../helpers/fakeGladys.js';

// Issue #70: the Zigbee "Luminance Motion sensor" of @UniversalOverrun, with
// the codes, enum ranges and value specs of its 1.28.0 diagnostic.
const ENUM = (range) => JSON.stringify({ range });
const SENSITIVITY = ENUM(['low', 'middle', 'high']);
const SENSOR = {
  id: 'pir1',
  name: 'Ouverture tiroir ',
  product_name: 'Luminance Motion sensor ',
  model: 'Luminance Motion sensor ',
  product_id: '3towulqd',
  online: true,
  specifications: {
    category: 'pir',
    functions: [{ code: 'pir_sensitivity', type: 'Enum', values: SENSITIVITY }],
    status: [
      { code: 'pir', type: 'Enum', values: ENUM(['pir', 'none']) },
      { code: 'pir_sensitivity', type: 'Enum', values: SENSITIVITY },
      {
        code: 'battery_percentage',
        type: 'Integer',
        values: '{"unit":"%","min":0,"max":100,"scale":0,"step":1}',
      },
    ],
  },
  thing_model: {
    services: [
      {
        properties: [
          {
            code: 'pir_state',
            accessMode: 'ro',
            typeSpec: { type: 'enum', range: ['pir', 'none'] },
          },
          {
            code: 'pir_sensitivity',
            accessMode: 'rw',
            typeSpec: { type: 'enum', range: ['low', 'middle', 'high'] },
          },
          {
            code: 'pir_time',
            accessMode: 'rw',
            typeSpec: { type: 'enum', range: ['10S', '30S', '60S', '120S'] },
          },
          {
            code: 'illuminance_value',
            accessMode: 'ro',
            typeSpec: { type: 'value', min: 0, max: 10000, scale: 0, step: 1, unit: 'lux' },
          },
          {
            code: 'interval_time',
            accessMode: 'rw',
            typeSpec: { type: 'value', min: 1, max: 720, scale: 0, step: 1, unit: 'Min' },
          },
          {
            code: 'battery_percentage',
            accessMode: 'ro',
            typeSpec: { type: 'value', min: 0, max: 100, scale: 0, step: 1, unit: '%' },
          },
        ],
      },
    ],
  },
};

const CLOUD_STATUS = (pir) => [
  { code: 'battery_percentage', value: 100 },
  { code: 'illuminance_value', value: 37 },
  { code: 'interval_time', value: 720 },
  { code: 'pir', value: pir },
  { code: 'pir_sensitivity', value: 'middle' },
  { code: 'pir_state', value: pir },
  { code: 'pir_time', value: '10S' },
];

const byCode = (device) =>
  Object.fromEntries(device.features.map((f) => [f.external_id.split(':').pop(), f]));
const labels = (feature) => feature.supported_options.map(({ value, label }) => [value, label]);

test('#70: the sensor is detected from its pir category, its product id or its name', () => {
  assert.equal(getDeviceType(SENSOR), DEVICE_TYPES.MOTION_SENSOR);
  assert.equal(getDeviceType({ product_id: '3towulqd' }), DEVICE_TYPES.MOTION_SENSOR);
  assert.equal(
    getDeviceType({ name: 'Détecteur de mouvement couloir', status: [{ code: 'pir' }] }),
    DEVICE_TYPES.MOTION_SENSOR,
  );
  // The Zigbee gateway itself stays unknown: it has nothing to map.
  assert.equal(
    getDeviceType({
      name: 'ZigBee Maison',
      specifications: { category: 'wg2', status: [{ code: 'up_channel' }] },
    }),
    DEVICE_TYPES.UNKNOWN,
  );
});

test('#70: motion, illuminance, battery and the two settings as lists', () => {
  const features = byCode(convertDevice(createFakeGladys(), SENSOR));
  assert.deepEqual(Object.keys(features).sort(), [
    'battery_percentage',
    'illuminance_value',
    'pir',
    'pir_sensitivity',
    'pir_time',
  ]);
  assert.equal(features.pir.category, DEVICE_FEATURE_CATEGORIES.MOTION_SENSOR);
  assert.equal(features.pir.type, DEVICE_FEATURE_TYPES.SENSOR.BINARY);
  assert.equal(features.pir.read_only, true);
  assert.equal(features.illuminance_value.category, DEVICE_FEATURE_CATEGORIES.LIGHT_SENSOR);
  assert.equal(features.illuminance_value.unit, 'lux');
  assert.equal(features.illuminance_value.max, 10000);
  assert.equal(features.battery_percentage.category, DEVICE_FEATURE_CATEGORIES.BATTERY);
  assert.equal(features.pir_sensitivity.type, DEVICE_FEATURE_TYPES.TEXT.SELECT);
  assert.equal(features.pir_sensitivity.read_only, false);
  assert.deepEqual(labels(features.pir_sensitivity), [
    ['low', 'Low'],
    ['middle', 'Medium'],
    ['high', 'High'],
  ]);
  assert.equal(features.pir_time.read_only, false);
  assert.deepEqual(labels(features.pir_time), [
    ['10S', '10 s'],
    ['30S', '30 s'],
    ['60S', '60 s'],
    ['120S', '120 s'],
  ]);
  // A Zigbee sub-device is never read on the LAN.
  const device = { device_type: DEVICE_TYPES.MOTION_SENSOR };
  assert.equal(getLocalDpsFromCode('pir', device), null);
});

test('#70: poll publishes a detection as 1, its end as 0, and the readings', async () => {
  const fake = createFakeGladys();
  const handler = new TuyaHandler(fake);
  const converted = convertDevice(fake, SENSOR);
  const device = {
    external_id: converted.external_id,
    device_type: converted.device_type,
    features: converted.features,
    params: [{ name: DEVICE_PARAM_NAME.DEVICE_ID, value: 'pir1' }],
  };
  let status = CLOUD_STATUS('pir');
  handler.connector = { request: async () => ({ success: true, result: status }) };

  await handler.poll(device);
  const published = () =>
    Object.fromEntries(fake.published.map((p) => [p.featureExternalId.split(':').pop(), p.state]));
  assert.deepEqual(published(), {
    battery_percentage: 100,
    illuminance_value: 37,
    pir: 1,
    pir_sensitivity: { text: 'middle' },
    pir_time: { text: '10S' },
  });

  status = CLOUD_STATUS('none');
  await handler.poll(device);
  assert.equal(published().pir, 0);
});

test('#70: a setting list writes the raw value the sensor declares', async () => {
  const fake = createFakeGladys();
  const handler = new TuyaHandler(fake);
  const converted = convertDevice(fake, SENSOR);
  const device = {
    external_id: converted.external_id,
    device_type: converted.device_type,
    features: converted.features,
    params: [{ name: DEVICE_PARAM_NAME.DEVICE_ID, value: 'pir1' }],
  };
  const commands = [];
  handler.connector = {
    request: async ({ body }) => {
      if (body) {
        commands.push(body.commands[0]);
      }
      return { success: true, result: [] };
    },
  };
  handler.feedbackPollDelayMs = 0;
  const feature = device.features.find((f) => f.external_id.endsWith(':pir_time'));
  await handler.setValue(device, feature, '60S');
  assert.deepEqual(commands, [{ code: 'pir_time', value: '60S' }]);
});
