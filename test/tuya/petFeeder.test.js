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

test('poll publishes the feed report and the battery over the cloud (regression: 1.12.0 had no reader for either, so they stayed frozen)', async () => {
  const fake = createFakeGladys();
  const handler = new TuyaHandler(fake);
  const converted = convertDevice(fake, FEEDER_DEVICE);
  const device = {
    external_id: converted.external_id,
    device_type: converted.device_type,
    features: converted.features,
    params: [{ name: DEVICE_PARAM_NAME.DEVICE_ID, value: 'feeder1' }],
  };
  handler.connector = {
    request: async () => ({
      success: true,
      result: [
        { code: 'feed_report', value: 3 },
        { code: 'battery_percentage', value: 64 },
        { code: 'slow_feed', value: false },
      ],
    }),
  };

  await handler.poll(device);

  const byCode = Object.fromEntries(
    fake.published.map((p) => [p.featureExternalId.split(':').pop(), p.state]),
  );
  assert.equal(byCode.feed_report, 3);
  assert.equal(byCode.battery_percentage, 64);
  assert.equal(byCode.slow_feed, 0);
});

// --- F14-W variant (bench dump, issue #35) -----------------------------------
// Same product id, but this firmware reports none of the standard codes.
const FEEDER_VARIANT_DEVICE = {
  id: 'feeder2',
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
    functions: [{ code: 'manual_feed', type: 'Integer', values: '{"min":1,"max":6,"scale":0}' }],
    status: [
      { code: 'manual_feed', type: 'Integer', values: '{"min":1,"max":6,"scale":0}' },
      { code: 'feed_record', type: 'Raw', values: '{}' },
      { code: 'feed_state', type: 'Enum', values: '{"range":["standby","feeding"]}' },
      { code: 'battery_val', type: 'Integer', values: '{}' },
      { code: 'battery_alarm', type: 'Boolean', values: '{}' },
      { code: 'meal_plan_num', type: 'Integer', values: '{}' },
      { code: 'meal_plan2', type: 'Raw', values: '{}' },
      { code: 'vip_alarm', type: 'Boolean', values: '{}' },
    ],
  },
};

test('the F14-W variant codes map alongside the standard ones', () => {
  const device = convertDevice(gladys, FEEDER_VARIANT_DEVICE);
  const byCode = Object.fromEntries(
    device.features.map((f) => [f.external_id.split(':').pop(), f]),
  );

  assert.equal(byCode.feed_record.category, DEVICE_FEATURE_CATEGORIES.COUNTER_SENSOR);
  assert.equal(byCode.feed_record.type, DEVICE_FEATURE_TYPES.SENSOR.INTEGER);
  // The mapping-only extraction hint never reaches the persisted feature.
  assert.equal(byCode.feed_record.jsonValueKey, undefined);

  // Raw millivolts: no invented percentage.
  assert.equal(byCode.battery_val.category, DEVICE_FEATURE_CATEGORIES.ENERGY_SENSOR);
  assert.equal(byCode.battery_val.type, DEVICE_FEATURE_TYPES.ENERGY_SENSOR.VOLTAGE);
  assert.equal(byCode.battery_val.unit, 'millivolt');

  assert.equal(byCode.battery_alarm.category, DEVICE_FEATURE_CATEGORIES.BATTERY_LOW);
  assert.equal(byCode.meal_plan_num.category, DEVICE_FEATURE_CATEGORIES.COUNTER_SENSOR);

  // The undocumented alarm and the raw schedule stay out.
  assert.deepEqual(Object.keys(byCode).sort(), [
    'battery_alarm',
    'battery_val',
    'feed_record',
    'manual_feed',
    'meal_plan_num',
  ]);
});

test('poll extracts the portion count from the feed_record payload and the low-battery flag', async () => {
  const fake = createFakeGladys();
  const handler = new TuyaHandler(fake);
  const converted = convertDevice(fake, FEEDER_VARIANT_DEVICE);
  const device = {
    external_id: converted.external_id,
    device_type: converted.device_type,
    features: converted.features,
    params: [{ name: DEVICE_PARAM_NAME.DEVICE_ID, value: 'feeder2' }],
  };
  handler.connector = {
    request: async () => ({
      success: true,
      result: [
        { code: 'feed_record', value: '{"value":3,"type":2}' },
        { code: 'battery_val', value: 2955 },
        { code: 'battery_alarm', value: 0 },
        { code: 'meal_plan_num', value: 1 },
      ],
    }),
  };

  await handler.poll(device);

  const byCode = Object.fromEntries(
    fake.published.map((p) => [p.featureExternalId.split(':').pop(), p.state]),
  );
  // 3 portions, not the raw JSON.
  assert.equal(byCode.feed_record, 3);
  assert.equal(byCode.battery_val, 2955);
  assert.equal(byCode.battery_alarm, 0);
  assert.equal(byCode.meal_plan_num, 1);
});

test('the F14-W LAN mapping resolves the read-only DPS, leaving the ambiguous ones out', () => {
  const device = { device_type: DEVICE_TYPES.PET_FEEDER };
  assert.equal(getLocalDpsFromCode('feed_record', device), 112);
  assert.equal(getLocalDpsFromCode('battery_val', device), 106);
  // DPS 113/114 both read 0 on the bench: which one is battery_alarm is
  // unknown, so neither is declared (it would publish one as the other).
  assert.equal(getLocalDpsFromCode('battery_alarm', device), null);
  assert.equal(getLocalDpsFromCode('vip_alarm', device), null);
  // Command DP: never reported in a read, stays on the cloud.
  assert.equal(getLocalDpsFromCode('manual_feed', device), null);
});
