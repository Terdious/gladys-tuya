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
