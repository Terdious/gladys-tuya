import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DEVICE_FEATURE_CATEGORIES, DEVICE_FEATURE_TYPES } from '@gladysassistant/integration-sdk';

import { TuyaHandler } from '../../src/tuya/handler.js';
import { API, DEVICE_PARAM_NAME } from '../../src/tuya/constants.js';
import { createFakeGladys } from '../helpers/fakeGladys.js';

const DEVICE = {
  external_id: 'ext:tuya:device:dev1',
  params: [{ name: DEVICE_PARAM_NAME.DEVICE_ID, value: 'dev1' }],
};

const SWITCH_FEATURE = {
  external_id: 'ext:tuya:device:dev1:switch',
  category: DEVICE_FEATURE_CATEGORIES.SWITCH,
  type: DEVICE_FEATURE_TYPES.SWITCH.BINARY,
};

test('setValue posts the transformed command to the Tuya cloud', async () => {
  const handler = new TuyaHandler(createFakeGladys());
  let request = null;
  handler.connector = {
    request: async (options) => {
      request = options;
      return { success: true };
    },
  };

  await handler.setValue(DEVICE, SWITCH_FEATURE, 1);

  assert.equal(request.method, 'POST');
  assert.equal(request.path, `${API.VERSION_1_0}/devices/dev1/commands`);
  assert.deepEqual(request.body, { commands: [{ code: 'switch', value: true }] });
});

test('setValue converts 0 to false for a binary switch', async () => {
  const handler = new TuyaHandler(createFakeGladys());
  let request = null;
  handler.connector = {
    request: async (options) => {
      request = options;
      return { success: true };
    },
  };

  await handler.setValue(DEVICE, SWITCH_FEATURE, 0);
  assert.deepEqual(request.body.commands, [{ code: 'switch', value: false }]);
});

test('setValue passes through values without a write transform', async () => {
  const handler = new TuyaHandler(createFakeGladys());
  let request = null;
  handler.connector = {
    request: async (options) => {
      request = options;
      return { success: true };
    },
  };

  const feature = {
    external_id: 'ext:tuya:device:dev1:custom_code',
    category: 'unknown-category',
    type: 'unknown-type',
  };
  await handler.setValue(DEVICE, feature, 42);
  assert.deepEqual(request.body.commands, [{ code: 'custom_code', value: 42 }]);
});

test('setValue is a no-op without a cloud connector', async () => {
  const handler = new TuyaHandler(createFakeGladys());
  await handler.setValue(DEVICE, SWITCH_FEATURE, 1);
});

test('setValue throws on an invalid device external id', async () => {
  const handler = new TuyaHandler(createFakeGladys());
  handler.connector = { request: async () => ({ success: true }) };
  await assert.rejects(
    () => handler.setValue({ external_id: 'garbage', params: [] }, SWITCH_FEATURE, 1),
    /external_id/,
  );
});
