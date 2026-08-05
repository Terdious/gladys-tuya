import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DEVICE_FEATURE_CATEGORIES, DEVICE_FEATURE_TYPES } from '@gladysassistant/integration-sdk';

import { TuyaHandler } from '../../src/tuya/handler.js';
import { API, DEVICE_PARAM_NAME } from '../../src/tuya/constants.js';
import { CLOUD_STRATEGY } from '../../src/tuya/cloud/tuya.cloudStrategy.js';
import { createFakeGladys } from '../helpers/fakeGladys.js';

function createDevice(overrides = {}) {
  return {
    external_id: 'ext:tuya:device:dev1',
    params: [{ name: DEVICE_PARAM_NAME.DEVICE_ID, value: 'dev1' }],
    features: [
      {
        external_id: 'ext:tuya:device:dev1:switch',
        category: DEVICE_FEATURE_CATEGORIES.SWITCH,
        type: DEVICE_FEATURE_TYPES.SWITCH.BINARY,
      },
      {
        external_id: 'ext:tuya:device:dev1:cur_power',
        category: DEVICE_FEATURE_CATEGORIES.SWITCH,
        type: DEVICE_FEATURE_TYPES.SWITCH.POWER,
        scale: 1,
      },
    ],
    ...overrides,
  };
}

function createHandler() {
  const gladys = createFakeGladys();
  const handler = new TuyaHandler(gladys);
  return { gladys, handler };
}

test('poll reads the legacy status endpoint and publishes the transformed states', async () => {
  const { gladys, handler } = createHandler();
  let requestedPath = null;
  handler.connector = {
    request: async ({ path }) => {
      requestedPath = path;
      return {
        success: true,
        result: [
          { code: 'switch', value: true },
          { code: 'cur_power', value: 253 },
        ],
      };
    },
  };

  await handler.poll(createDevice());

  assert.equal(requestedPath, `${API.VERSION_1_0}/devices/dev1/status`);
  assert.deepEqual(gladys.published, [
    { featureExternalId: 'ext:tuya:device:dev1:switch', state: 1 },
    { featureExternalId: 'ext:tuya:device:dev1:cur_power', state: 25.3 },
  ]);
});

test('poll uses the shadow endpoint when the device is configured for it', async () => {
  const { gladys, handler } = createHandler();
  let requestedPath = null;
  handler.connector = {
    request: async ({ path }) => {
      requestedPath = path;
      return {
        success: true,
        result: { properties: [{ code: 'switch', value: false }] },
      };
    },
  };

  const device = createDevice({
    params: [
      { name: DEVICE_PARAM_NAME.DEVICE_ID, value: 'dev1' },
      { name: DEVICE_PARAM_NAME.CLOUD_READ_STRATEGY, value: CLOUD_STRATEGY.SHADOW },
    ],
  });
  await handler.poll(device);

  assert.equal(requestedPath, `${API.VERSION_2_0}/thing/dev1/shadow/properties`);
  assert.deepEqual(gladys.published, [
    { featureExternalId: 'ext:tuya:device:dev1:switch', state: 0 },
  ]);
});

test('poll falls back to the shadow endpoint when the configured legacy read returns no known code', async () => {
  const { gladys, handler } = createHandler();
  const requestedPaths = [];
  handler.connector = {
    request: async ({ path }) => {
      requestedPaths.push(path);
      if (path.endsWith('/status')) {
        // Legacy endpoint knows nothing about this (thing-model only) device.
        return { success: true, result: [] };
      }
      return { success: true, result: { properties: [{ code: 'switch', value: true }] } };
    },
  };

  // Device configured (at discovery) for the legacy strategy, wrongly.
  await handler.poll(createDevice());

  assert.deepEqual(requestedPaths, [
    `${API.VERSION_1_0}/devices/dev1/status`,
    `${API.VERSION_2_0}/thing/dev1/shadow/properties`,
  ]);
  assert.deepEqual(gladys.published, [
    { featureExternalId: 'ext:tuya:device:dev1:switch', state: 1 },
  ]);
});

test('poll does not fall back when the configured endpoint returns a known code', async () => {
  const { handler } = createHandler();
  const requestedPaths = [];
  handler.connector = {
    request: async ({ path }) => {
      requestedPaths.push(path);
      return { success: true, result: [{ code: 'switch', value: true }] };
    },
  };

  await handler.poll(createDevice());
  assert.deepEqual(requestedPaths, [`${API.VERSION_1_0}/devices/dev1/status`]);
});

test('poll does not republish an unchanged value before the re-emit interval', async () => {
  const { gladys, handler } = createHandler();
  handler.connector = {
    request: async () => ({ success: true, result: [{ code: 'switch', value: true }] }),
  };
  const device = createDevice();

  await handler.poll(device);
  await handler.poll(device);

  // Second poll returns the same value right away: no new publication.
  assert.equal(gladys.published.length, 1);
});

test('poll republishes an unchanged value after the re-emit interval', async () => {
  const { gladys, handler } = createHandler();
  handler.connector = {
    request: async () => ({ success: true, result: [{ code: 'switch', value: true }] }),
  };
  const device = createDevice();

  await handler.poll(device);
  // Age the cached emission beyond the 3-minute interval.
  const cached = handler.featureStates.get('ext:tuya:device:dev1:switch');
  cached.lastValueChanged = new Date(Date.now() - 4 * 60 * 1000);

  await handler.poll(device);
  assert.equal(gladys.published.length, 2);
});

test('poll counts missing codes without publishing', async () => {
  const { gladys, handler } = createHandler();
  handler.connector = {
    request: async () => ({ success: true, result: [{ code: 'unrelated', value: 42 }] }),
  };

  await handler.poll(createDevice());
  assert.equal(gladys.published.length, 0);
});

test('poll survives a cloud failure', async () => {
  const { gladys, handler } = createHandler();
  handler.connector = {
    request: async () => {
      throw new Error('cloud down');
    },
  };

  await handler.poll(createDevice());
  assert.equal(gladys.published.length, 0);
});

test('poll throws on an invalid external id', async () => {
  const { handler } = createHandler();
  await assert.rejects(
    () => handler.poll({ external_id: 'invalid', params: [], features: [] }),
    /external_id/,
  );
});

// --- devices without any feature (issue #36) ---------------------------------

test('poll skips a device with no feature instead of hitting the cloud', async () => {
  const { gladys, handler } = createHandler();
  let requests = 0;
  handler.connector = {
    request: async () => {
      requests += 1;
      return { success: true, result: [] };
    },
  };

  // A device type not mapped yet (e.g. the pet feeder before issue #35): the
  // user created it from the Discovery screen, but it can publish nothing.
  await handler.poll(createDevice({ features: [] }));

  assert.equal(requests, 0, 'no cloud call for a device with nothing to read');
  assert.equal(gladys.published.length, 0);
});

test('poll does not open a LAN session for a device whose features have no local DPS', async () => {
  const { handler } = createHandler();
  handler.config = { localMode: true };
  let localReads = 0;
  handler.localRead = async () => {
    localReads += 1;
    return { dps: { 1: true } };
  };
  handler.connector = { request: async () => ({ success: true, result: [] }) };

  const device = createDevice({
    device_type: 'pet-feeder',
    features: [
      {
        external_id: 'ext:tuya:device:dev1:manual_feed',
        category: DEVICE_FEATURE_CATEGORIES.BUTTON,
        type: DEVICE_FEATURE_TYPES.BUTTON.PUSH,
      },
    ],
    params: [
      { name: DEVICE_PARAM_NAME.DEVICE_ID, value: 'dev1' },
      { name: DEVICE_PARAM_NAME.IP_ADDRESS, value: '192.168.1.199' },
      { name: DEVICE_PARAM_NAME.LOCAL_KEY, value: 'lk' },
      { name: DEVICE_PARAM_NAME.PROTOCOL_VERSION, value: '3.4' },
    ],
  });

  // First cycle: one local read is still attempted, to capture the DPS
  // snapshot that documents the model-specific indexes we are missing.
  await handler.poll(device);
  assert.equal(localReads, 1);
  // Once captured, the device is polled over the cloud only: no more LAN
  // session churn every cycle.
  await handler.poll(device);
  await handler.poll(device);
  assert.equal(localReads, 1);
});
