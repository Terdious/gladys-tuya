import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DEVICE_FEATURE_CATEGORIES, DEVICE_FEATURE_TYPES } from '@gladysassistant/integration-sdk';

import { TuyaHandler } from '../../src/tuya/handler.js';
import { CLOUD_MIN_INTERVAL_MS } from '../../src/tuya/tuya.poll.js';
import { DEVICE_PARAM_NAME } from '../../src/tuya/constants.js';
import { DEVICE_TYPES } from '../../src/tuya/mappings/index.js';
import { createFakeGladys } from '../helpers/fakeGladys.js';

// Issue #6: a local-capable device is polled every 10 s, but its cloud reads
// (features without a LAN mapping, fallback while the LAN fails) are
// throttled to one per CLOUD_MIN_INTERVAL_MS.

const SWITCH = {
  external_id: 'ext:tuya:device:dev1:switch',
  category: DEVICE_FEATURE_CATEGORIES.SWITCH,
  type: DEVICE_FEATURE_TYPES.SWITCH.BINARY,
};
// No LAN mapping on a smart socket: read over the cloud.
const POWER = {
  external_id: 'ext:tuya:device:dev1:cur_power',
  category: DEVICE_FEATURE_CATEGORIES.SWITCH,
  type: DEVICE_FEATURE_TYPES.SWITCH.POWER,
};

function createDevice({ local = true, features = [SWITCH, POWER] } = {}) {
  return {
    external_id: 'ext:tuya:device:dev1',
    device_type: DEVICE_TYPES.SMART_SOCKET,
    params: [
      { name: DEVICE_PARAM_NAME.DEVICE_ID, value: 'dev1' },
      ...(local
        ? [
            { name: DEVICE_PARAM_NAME.IP_ADDRESS, value: '192.168.1.50' },
            { name: DEVICE_PARAM_NAME.LOCAL_KEY, value: 'lk' },
            { name: DEVICE_PARAM_NAME.PROTOCOL_VERSION, value: '3.3' },
          ]
        : []),
    ],
    features,
  };
}

function createHandler({ localRead } = {}) {
  const gladys = createFakeGladys();
  const handler = new TuyaHandler(gladys);
  handler.config = { localMode: true };
  handler.localRead = localRead || (async () => ({ dps: { 1: true } }));
  const cloudCalls = [];
  handler.connector = {
    request: async ({ path }) => {
      cloudCalls.push(path);
      return {
        success: true,
        result: [
          { code: 'switch', value: false },
          { code: 'cur_power', value: 253 },
        ],
      };
    },
  };
  return { gladys, handler, cloudCalls };
}

// Pretend the last cloud read happened `ms` ago.
const ageLastCloudRead = (handler, ms) => {
  handler.lastCloudReadAt.set('dev1', Date.now() - ms);
};

test('the threshold stays below the 30 s cloud cadence (no skipped cloud-only cycle)', () => {
  assert.ok(CLOUD_MIN_INTERVAL_MS < 30 * 1000);
  assert.ok(CLOUD_MIN_INTERVAL_MS >= 20 * 1000);
});

test('features without a LAN mapping are read from the cloud at most once per interval', async () => {
  const { gladys, handler, cloudCalls } = createHandler();
  const device = createDevice();

  await handler.poll(device);
  assert.equal(cloudCalls.length, 1);

  // Next 10 s cycle: the local features are read, the cloud is not.
  gladys.published.length = 0;
  await handler.poll(device);
  assert.equal(cloudCalls.length, 1);
  assert.ok(!gladys.published.some((p) => p.featureExternalId === POWER.external_id));

  // Once the interval elapsed, the cloud features are refreshed again.
  ageLastCloudRead(handler, CLOUD_MIN_INTERVAL_MS);
  await handler.poll(device);
  assert.equal(cloudCalls.length, 2);
});

test('the cloud fallback of a failing LAN follows the same pace, without touching the badge', async () => {
  const { gladys, handler, cloudCalls } = createHandler({
    localRead: async () => {
      throw new Error('unreachable');
    },
  });
  const device = createDevice({ features: [SWITCH] });

  await handler.poll(device);
  assert.equal(cloudCalls.length, 1);
  const badges = gladys.transports.length;

  await handler.poll(device);
  assert.equal(cloudCalls.length, 1);
  assert.equal(gladys.transports.length, badges);

  ageLastCloudRead(handler, CLOUD_MIN_INTERVAL_MS + 1000);
  await handler.poll(device);
  assert.equal(cloudCalls.length, 2);
});

test('a cloud-only device is never throttled (its own cadence is already 30 s)', async () => {
  const { handler, cloudCalls } = createHandler();
  const device = createDevice({ local: false, features: [SWITCH] });
  await handler.poll(device);
  await handler.poll(device);
  assert.equal(cloudCalls.length, 2);
});

test('with local mode off, a LAN-capable device is polled over the cloud without throttle', async () => {
  const { handler, cloudCalls } = createHandler();
  handler.config = { localMode: false };
  const device = createDevice({ features: [SWITCH] });
  await handler.poll(device);
  await handler.poll(device);
  assert.equal(cloudCalls.length, 2);
});
