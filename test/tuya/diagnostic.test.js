import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildDeviceDiagnostic, formatValue } from '../../src/tuya/tuya.diagnostic.js';
import { createFakeGladys } from '../helpers/fakeGladys.js';

// The F14-W variant reported on the forum: it exposes `feed_record` /
// `battery_val` instead of the standard `feed_report` / `battery_percentage`,
// so it is created with a single feature and nothing explains why.
const FEEDER_VARIANT = {
  id: 'feeder1',
  name: 'F14-W',
  product_name: 'Pet Feeder',
  product_id: 'variant-product-id',
  specifications: {
    category: 'cwwsq',
    functions: [{ code: 'manual_feed', type: 'Integer', values: '{"min":1,"max":6}' }],
    status: [
      { code: 'manual_feed', type: 'Integer', values: '{"min":1,"max":6}' },
      { code: 'feed_record', type: 'Raw', values: '{}' },
      { code: 'battery_val', type: 'Integer', values: '{}' },
      { code: 'meal_plan', type: 'Raw', values: '{}' },
      { code: 'vip_alarm', type: 'Boolean', values: '{}' },
      { code: 'brand_new_code', type: 'Integer', values: '{}' },
    ],
  },
};

const createHandler = (status, overrides = {}) => ({
  gladys: createFakeGladys(),
  connector: {
    request: async ({ path }) => {
      if (path.endsWith('/status')) {
        return { success: true, result: status };
      }
      return { success: true, result: { properties: [] } };
    },
  },
  ...overrides,
});

test('formatValue hides snapshot payloads and truncates long strings', () => {
  assert.equal(formatValue('doorbell_pic', 'aHR0cHM6Ly9…'), '<snapshot payload>');
  assert.equal(formatValue('feed_state', 'standby'), '"standby"');
  assert.equal(formatValue('battery_val', 2957), '2957');
  const long = 'x'.repeat(200);
  assert.match(formatValue('meal_plan', long), /^"x{120}…" \(200 chars\)$/);
});

test('the diagnostic reports each code with its value and what the integration does with it', async () => {
  const self = createHandler([
    { code: 'manual_feed', value: 1 },
    { code: 'feed_record', value: '{"value":2,"type":2}' },
    { code: 'battery_val', value: 2957 },
    { code: 'meal_plan', value: 'AAEC' },
    { code: 'brand_new_code', value: 42 },
  ]);

  const report = await buildDeviceDiagnostic(self, FEEDER_VARIANT);

  assert.match(report, /detected type=pet-feeder/);
  // A mapped code says what it became...
  assert.match(report, /manual_feed = 1 {2}\[button\/push\]/);
  assert.match(report, /feed_record = "\{"value":2,"type":2\}" {2}\[counter-sensor\/integer\]/);
  assert.match(report, /battery_val = 2957 {2}\[energy-sensor\/voltage\]/);
  // ...an unknown one carries the value shape a new mapping needs...
  assert.match(report, /brand_new_code = 42 {2}\[UNMANAGED\]/);
  // ...and a deliberately ignored code is not reported as a gap.
  assert.match(report, /meal_plan = "AAEC" {2}\[ignored on purpose\]/);
  // Declared by the model but silent in this read.
  assert.match(report, /Declared but not reported: vip_alarm/);
  // Nothing sensitive: safe to paste in an issue.
  assert.doesNotMatch(report, /feeder1/);
  assert.match(report, /no local key, IP address nor Tuya device id/);
});

test('the diagnostic survives a cloud that answers nothing', async () => {
  const self = {
    gladys: createFakeGladys(),
    connector: {
      request: async () => {
        throw new Error('cloud down');
      },
    },
  };
  const report = await buildDeviceDiagnostic(self, FEEDER_VARIANT);
  assert.match(report, /Cloud status: unreadable/);
  assert.match(report, /LAN DPS snapshot: not attempted/);
});

test('the diagnostic adds the LAN DPS snapshot when the device is locally reachable', async () => {
  const self = createHandler([{ code: 'manual_feed', value: 1 }], {
    localRead: async () => ({ dps: { 4: 'standby', 106: 2957 } }),
  });
  const report = await buildDeviceDiagnostic(self, {
    ...FEEDER_VARIANT,
    ip: '192.168.1.199',
    local_key: 'secret-local-key',
    protocol_version: '3.4',
  });
  assert.match(report, /LAN DPS snapshot:/);
  // A DPS the LAN mapping knows is named; an unknown one is flagged so a
  // future mapping can be built from it.
  assert.match(report, /106=2957 \(battery_val\)/);
  assert.match(report, /4="standby" \(UNMAPPED\)/);
  // The credentials used to read it never reach the report.
  assert.doesNotMatch(report, /secret-local-key|192\.168\.1\.199/);
});
