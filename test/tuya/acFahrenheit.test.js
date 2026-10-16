import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DEVICE_FEATURE_UNITS } from '@gladysassistant/integration-sdk';

import { TuyaHandler } from '../../src/tuya/handler.js';
import { convertDevice } from '../../src/tuya/device/tuya.convertDevice.js';
import { getFeatureWithFallbackScale } from '../../src/tuya/tuya.poll.js';
import { DEVICE_PARAM_NAME } from '../../src/tuya/constants.js';
import { getParamValue } from '../../src/tuya/utils/tuya.deviceParams.js';
import { createFakeGladys } from '../helpers/fakeGladys.js';

// Issue #52: a kt air conditioner whose panel displays °F. DP 2/3 (temp_set /
// temp_current) stay in Celsius, the Fahrenheit values live on separate DPs
// (temp_set_f / temp_current_f), and temp_current is sent in whole degrees
// (spec scale 0), unlike the reference AC of the device-type mapping.
const FAHRENHEIT_PANEL_AC = {
  id: 'ac52',
  name: 'Clim Bureau',
  product_name: 'Air Conditioner',
  product_id: 'hrzr8mr0mtgfwwri',
  local_key: 'lk',
  online: true,
  specifications: {
    category: 'kt',
    functions: [
      { code: 'switch', type: 'Boolean', values: '{}' },
      { code: 'temp_unit_convert', type: 'Enum', values: '{"range":["c","f"]}' },
      {
        code: 'temp_set',
        type: 'Integer',
        values: '{"unit":"℃","min":160,"max":310,"scale":1,"step":5}',
      },
      {
        code: 'temp_set_f',
        type: 'Integer',
        values: '{"unit":"℉","min":610,"max":880,"scale":1,"step":10}',
      },
      { code: 'mode', type: 'Enum', values: '{"range":["auto","cold","wet","heat","fan"]}' },
    ],
    status: [
      { code: 'switch', type: 'Boolean', values: '{}' },
      {
        code: 'temp_set',
        type: 'Integer',
        values: '{"unit":"℃","min":160,"max":310,"scale":1,"step":5}',
      },
      {
        code: 'temp_current',
        type: 'Integer',
        values: '{"unit":"℃","min":-20,"max":100,"scale":0,"step":1}',
      },
      {
        code: 'temp_current_f',
        type: 'Integer',
        values: '{"unit":"℉","min":-4,"max":212,"scale":0,"step":1}',
      },
      { code: 'mode', type: 'Enum', values: '{"range":["auto","cold","wet","heat","fan"]}' },
    ],
  },
  properties: {
    properties: [
      { code: 'temp_unit_convert', dp_id: 19, type: 'enum', value: 'f' },
      { code: 'temp_set', dp_id: 2, type: 'value', value: 230 },
      { code: 'temp_current', dp_id: 3, type: 'value', value: 24 },
      { code: 'temp_current_f', dp_id: 23, type: 'value', value: 76 },
      { code: 'temp_set_f', dp_id: 24, type: 'value', value: 730 },
    ],
  },
};

const byCode = (device) =>
  Object.fromEntries(device.features.map((f) => [f.external_id.split(':').pop(), f]));

test('#52: temp_set/temp_current stay Celsius when their Fahrenheit twins exist, whatever the panel shows', () => {
  const device = convertDevice(createFakeGladys(), FAHRENHEIT_PANEL_AC);
  const features = byCode(device);
  assert.equal(features.temp_set.unit, DEVICE_FEATURE_UNITS.CELSIUS);
  assert.equal(features.temp_current.unit, DEVICE_FEATURE_UNITS.CELSIUS);
  // The Fahrenheit twins are not exposed: Gladys converts for the user.
  assert.equal(features.temp_set_f, undefined);
  assert.equal(features.temp_current_f, undefined);
});

test('a single-DP device following its panel unit is still labelled Fahrenheit', () => {
  // No `_f` twin: the panel unit is the only runtime hint (the behaviour
  // before #52, kept for those models).
  const singleDp = JSON.parse(JSON.stringify(FAHRENHEIT_PANEL_AC));
  singleDp.specifications.functions = singleDp.specifications.functions.filter(
    (f) => f.code !== 'temp_set_f',
  );
  singleDp.specifications.status = singleDp.specifications.status.filter(
    (s) => s.code !== 'temp_current_f',
  );
  singleDp.properties.properties = singleDp.properties.properties.filter(
    (p) => !p.code.endsWith('_f'),
  );
  const features = byCode(convertDevice(createFakeGladys(), singleDp));
  assert.equal(features.temp_set.unit, DEVICE_FEATURE_UNITS.FAHRENHEIT);
  assert.equal(features.temp_current.unit, DEVICE_FEATURE_UNITS.FAHRENHEIT);
});

test('#52: the spec scale of the temperature codes is stored as a device param', () => {
  const device = convertDevice(createFakeGladys(), FAHRENHEIT_PANEL_AC);
  const raw = getParamValue(device.params, DEVICE_PARAM_NAME.TEMPERATURE_SCALES);
  assert.deepEqual(JSON.parse(raw), { temp_set: 1, temp_current: 0 });
});

// A device as Gladys stores it: no feature `scale`, params kept.
function createdDevice() {
  const converted = convertDevice(createFakeGladys(), FAHRENHEIT_PANEL_AC);
  return {
    external_id: converted.external_id,
    name: converted.name,
    features: converted.features.map(({ scale: _scale, ...rest }) => rest),
    params: converted.params,
  };
}

test('#52: poll uses the stored spec scale: whole degrees are not divided by 10', async () => {
  const fake = createFakeGladys();
  const handler = new TuyaHandler(fake);
  const device = createdDevice();
  handler.connector = {
    request: async () => ({
      success: true,
      result: [
        { code: 'temp_set', value: 230 },
        { code: 'temp_current', value: 24 },
      ],
    }),
  };

  await handler.poll(device);

  const states = Object.fromEntries(fake.published.map((p) => [p.featureExternalId, p.state]));
  assert.equal(states['ext:tuya:device:ac52:temp_set'], 23);
  assert.equal(states['ext:tuya:device:ac52:temp_current'], 24);
});

test('#52: setValue still scales the setpoint with its stored spec scale', async () => {
  const handler = new TuyaHandler(createFakeGladys());
  const device = createdDevice();
  const commands = [];
  handler.connector = {
    request: async ({ body }) => {
      commands.push(body.commands[0]);
      return { success: true };
    },
  };
  const feature = device.features.find((f) => f.external_id.endsWith(':temp_set'));

  await handler.setValue(device, feature, 24);
  assert.deepEqual(commands, [{ code: 'temp_set', value: 240 }]);
});

test('a device created before #52 (no stored scales) keeps the device-type scale', () => {
  const device = createdDevice();
  device.params = device.params.filter((p) => p.name !== DEVICE_PARAM_NAME.TEMPERATURE_SCALES);
  device.device_type = 'air-conditioner';
  const feature = device.features.find((f) => f.external_id.endsWith(':temp_current'));
  assert.equal(getFeatureWithFallbackScale(device, feature, 'temp_current').scale, 1);
});

test('an unreadable stored scales param falls back to the device-type scale', () => {
  const device = createdDevice();
  device.device_type = 'air-conditioner';
  device.params = device.params.map((p) =>
    p.name === DEVICE_PARAM_NAME.TEMPERATURE_SCALES ? { ...p, value: '{not json' } : p,
  );
  const feature = device.features.find((f) => f.external_id.endsWith(':temp_current'));
  assert.equal(getFeatureWithFallbackScale(device, feature, 'temp_current').scale, 1);
});
