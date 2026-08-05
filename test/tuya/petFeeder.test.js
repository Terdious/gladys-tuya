import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DEVICE_FEATURE_CATEGORIES, DEVICE_FEATURE_TYPES } from '@gladysassistant/integration-sdk';

import { TuyaHandler } from '../../src/tuya/handler.js';
import { convertDevice } from '../../src/tuya/device/tuya.convertDevice.js';
import { getLocalDpsFromCode } from '../../src/tuya/device/tuya.localMapping.js';
import { getDeviceType, DEVICE_TYPES } from '../../src/tuya/mappings/index.js';
import { DEVICE_PARAM_NAME } from '../../src/tuya/constants.js';
import { createFakeGladys } from '../helpers/fakeGladys.js';

// Tuya pet feeder (category cwwsq), modelled on the F14-W reported in issue #35.
// The standard cwwsq instruction set is cross-checked against the Home Assistant
// Tuya integration and the Tuya category documentation.
const FEEDER_DEVICE = {
  id: 'feeder1',
  name: 'F14-W',
  product_name: 'Pet Feeder',
  model: 'F14-W',
  product_id: 'cyip5aunfcx3ftws',
  local_key: 'lk',
  ip: '192.168.1.199',
  protocol_version: '3.4',
  local_override: true,
  online: true,
  specifications: {
    category: 'cwwsq',
    functions: [
      { code: 'manual_feed', type: 'Integer', values: '{"min":1,"max":6,"scale":0,"step":1}' },
      { code: 'slow_feed', type: 'Boolean', values: '{}' },
      { code: 'light', type: 'Boolean', values: '{}' },
    ],
    status: [
      { code: 'manual_feed', type: 'Integer', values: '{"min":1,"max":6,"scale":0,"step":1}' },
      { code: 'feed_report', type: 'Integer', values: '{"min":0,"max":50,"scale":0,"step":1}' },
      { code: 'feed_state', type: 'Enum', values: '{"range":["standby","feeding"]}' },
      { code: 'slow_feed', type: 'Boolean', values: '{}' },
      { code: 'battery_percentage', type: 'Integer', values: '{"min":0,"max":100,"unit":"%"}' },
      { code: 'meal_plan', type: 'Raw', values: '{}' },
    ],
  },
};

const gladys = createFakeGladys();

test('a pet feeder is detected from its cwwsq category and codes', () => {
  assert.equal(getDeviceType(FEEDER_DEVICE), DEVICE_TYPES.PET_FEEDER);
  // ...and by product id alone, for a feeder whose specifications are empty.
  assert.equal(getDeviceType({ product_id: 'cyip5aunfcx3ftws' }), DEVICE_TYPES.PET_FEEDER);
});

test('convertDevice maps the supported feeder features', () => {
  const device = convertDevice(gladys, FEEDER_DEVICE);
  const byCode = Object.fromEntries(
    device.features.map((f) => [f.external_id.split(':').pop(), f]),
  );

  // Feeding on demand: a PUSH button (the Gladys push control sends 1 = one portion).
  assert.equal(byCode.manual_feed.category, DEVICE_FEATURE_CATEGORIES.BUTTON);
  assert.equal(byCode.manual_feed.type, DEVICE_FEATURE_TYPES.BUTTON.PUSH);
  assert.equal(byCode.manual_feed.read_only, false);

  assert.equal(byCode.feed_report.category, DEVICE_FEATURE_CATEGORIES.COUNTER_SENSOR);
  assert.equal(byCode.feed_report.type, DEVICE_FEATURE_TYPES.SENSOR.INTEGER);
  assert.equal(byCode.feed_report.read_only, true);

  assert.equal(byCode.slow_feed.category, DEVICE_FEATURE_CATEGORIES.SWITCH);
  assert.equal(byCode.light.category, DEVICE_FEATURE_CATEGORIES.SWITCH);
  assert.equal(byCode.battery_percentage.category, DEVICE_FEATURE_CATEGORIES.BATTERY);

  // The raw schedule and the enum state stay out until they have a real mapping.
  assert.deepEqual(Object.keys(byCode).sort(), [
    'battery_percentage',
    'feed_report',
    'light',
    'manual_feed',
    'slow_feed',
  ]);
});

test('the feeder has no LAN mapping yet: every code falls back to the cloud', () => {
  const device = { device_type: DEVICE_TYPES.PET_FEEDER };
  // Strict mapping with no DPS: nothing resolves locally (the model-specific
  // indexes are unknown), so the cloud path serves every feature.
  assert.equal(getLocalDpsFromCode('manual_feed', device), null);
  assert.equal(getLocalDpsFromCode('feed_report', device), null);
  assert.equal(getLocalDpsFromCode('slow_feed', device), null);
});

test('setValue sends one portion when the feed button is pushed', async () => {
  const fake = createFakeGladys();
  const handler = new TuyaHandler(fake);
  const converted = convertDevice(fake, FEEDER_DEVICE);
  const device = {
    external_id: converted.external_id,
    device_type: converted.device_type,
    features: converted.features,
    params: [{ name: DEVICE_PARAM_NAME.DEVICE_ID, value: 'feeder1' }],
  };
  const commands = [];
  handler.connector = {
    request: async ({ body }) => {
      commands.push(body.commands[0]);
      return { success: true };
    },
  };
  const feature = device.features.find((f) => f.external_id.endsWith(':manual_feed'));

  // No write transform for a BUTTON feature: the Gladys value is sent as-is.
  await handler.setValue(device, feature, 1);
  assert.deepEqual(commands, [{ code: 'manual_feed', value: 1 }]);
});
