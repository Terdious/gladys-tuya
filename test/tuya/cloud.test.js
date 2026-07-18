import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TuyaHandler } from '../../src/tuya/handler.js';
import { STATUS, API, TUYA_ENDPOINTS } from '../../src/tuya/constants.js';
import { mapConnectionError } from '../../src/tuya/cloud/tuya.connect.js';
import { buildConfigHash } from '../../src/tuya/utils/tuya.config.js';
import { normalizeConfig } from '../../src/config.js';
import { createFakeGladys } from '../helpers/fakeGladys.js';

const CONFIG = normalizeConfig({
  endpoint: 'centralEurope',
  access_key: 'access-key',
  secret_key: 'secret-key',
  app_account_id: 'app-uid',
});

function createHandler() {
  const handler = new TuyaHandler(createFakeGladys());
  handler.config = CONFIG;
  return handler;
}

// --- token store -------------------------------------------------------------

test('the token store implements the Tuya connector interface', async () => {
  const handler = createHandler();
  assert.equal(await handler.getAccessToken(), undefined);
  assert.equal(await handler.getRefreshToken(), undefined);

  await handler.setTokens({ access_token: 'at', refresh_token: 'rt', expire_time: '123' });
  assert.equal(await handler.getAccessToken(), 'at');
  assert.equal(await handler.getRefreshToken(), 'rt');
});

// --- connect -----------------------------------------------------------------

class FakeTuyaContext {
  constructor(options) {
    FakeTuyaContext.lastOptions = options;
    this.client = {
      init: async () => {
        if (FakeTuyaContext.initError) {
          throw FakeTuyaContext.initError;
        }
      },
    };
  }

  async request(options) {
    return FakeTuyaContext.onRequest(options);
  }
}

test('connect reaches CONNECTED and records the config hash on success', async () => {
  const handler = createHandler();
  FakeTuyaContext.initError = null;
  FakeTuyaContext.onRequest = async () => ({ success: true, result: [] });
  handler.TuyaContext = FakeTuyaContext;

  await handler.connect(CONFIG);

  assert.equal(handler.status, STATUS.CONNECTED);
  assert.equal(handler.lastError, null);
  assert.equal(handler.autoReconnectAllowed, true);
  assert.equal(handler.manualDisconnectEnabled, false);
  assert.equal(handler.lastConnectedConfigHash, buildConfigHash(CONFIG));
  assert.equal(FakeTuyaContext.lastOptions.baseUrl, TUYA_ENDPOINTS.centralEurope);
  assert.equal(FakeTuyaContext.lastOptions.store, handler);
});

test('connect validates the app account UID against the devices endpoint', async () => {
  const handler = createHandler();
  FakeTuyaContext.initError = null;
  let requestedPath = null;
  FakeTuyaContext.onRequest = async ({ path }) => {
    requestedPath = path;
    return { success: true, result: [] };
  };
  handler.TuyaContext = FakeTuyaContext;

  await handler.connect(CONFIG);

  assert.equal(requestedPath, `${API.PUBLIC_VERSION_1_0}/users/app-uid/devices`);
});

test('connect maps an invalid app account UID and disables auto-reconnect', async () => {
  const handler = createHandler();
  FakeTuyaContext.initError = null;
  FakeTuyaContext.onRequest = async () => ({ success: false, code: 1106, msg: 'permission deny' });
  handler.TuyaContext = FakeTuyaContext;

  await handler.connect(CONFIG);

  assert.equal(handler.status, STATUS.ERROR);
  assert.equal(handler.lastError, 'integration.tuya.setup.errorInvalidAppAccountUid');
  assert.equal(handler.autoReconnectAllowed, false);
});

test('connect throws when the configuration is incomplete', async () => {
  const handler = createHandler();
  await assert.rejects(() => handler.connect({ baseUrl: 'x', accessKey: 'a' }), /not configured/);
  assert.equal(handler.status, STATUS.NOT_INITIALIZED);
});

test('mapConnectionError maps the known Tuya error codes', () => {
  assert.equal(
    mapConnectionError({ code: '2009', message: 'x' }).key,
    'integration.tuya.setup.errorInvalidClientId',
  );
  assert.equal(
    mapConnectionError(new Error('GET_TOKEN_FAILED 1004, sign invalid')).key,
    'integration.tuya.setup.errorInvalidClientSecret',
  );
  assert.equal(
    mapConnectionError({ code: 28841107, message: 'this data center is suspended' }).key,
    'integration.tuya.setup.errorInvalidEndpoint',
  );
  assert.equal(
    mapConnectionError({ code: 'TUYA_APP_ACCOUNT_UID_MISSING', message: '' }).key,
    'integration.tuya.setup.errorInvalidAppAccountUid',
  );
  assert.equal(mapConnectionError(new Error('boom')), null);
});

// --- loadDevices -------------------------------------------------------------

test('loadDevices returns the list and follows pagination (has_more)', async () => {
  const handler = createHandler();
  const pages = [
    { success: true, result: { list: [{ id: 'a' }, { id: 'b' }], has_more: true } },
    { success: true, result: { list: [{ id: 'c' }], has_more: false } },
  ];
  const queries = [];
  handler.connector = {
    request: async ({ query }) => {
      queries.push(query.page_no);
      return pages[query.page_no - 1];
    },
  };

  const devices = await handler.loadDevices();

  assert.deepEqual(queries, [1, 2]);
  assert.deepEqual(
    devices.map((d) => d.id),
    ['a', 'b', 'c'],
  );
});

test('loadDevices accepts a plain array result and stops on a short page', async () => {
  const handler = createHandler();
  handler.connector = {
    request: async () => ({ success: true, result: [{ id: 'a' }] }),
  };

  const devices = await handler.loadDevices(1, 100);
  assert.deepEqual(
    devices.map((d) => d.id),
    ['a'],
  );
});

test('loadDevices throws on a Tuya API error response', async () => {
  const handler = createHandler();
  handler.connector = {
    request: async () => ({ success: false, msg: 'token invalid' }),
  };
  await assert.rejects(() => handler.loadDevices(), /token invalid/);
});

test('loadDevices throws when the app account UID is missing', async () => {
  const handler = createHandler();
  handler.config = normalizeConfig({ endpoint: 'centralEurope' });
  handler.connector = { request: async () => ({ success: true, result: [] }) };
  await assert.rejects(() => handler.loadDevices(), /APP_ACCOUNT_UID is missing/);
});

test('loadDevices validates the pagination parameters', async () => {
  const handler = createHandler();
  await assert.rejects(() => handler.loadDevices(0), /pageNo/);
  await assert.rejects(() => handler.loadDevices(1, -5), /pageSize/);
});

// --- loadDeviceDetails -------------------------------------------------------

const detailsResponses = (deviceId) => ({
  [`${API.VERSION_1_2}/devices/${deviceId}/specification`]: {
    success: true,
    result: { functions: [{ code: 'switch' }], status: [{ code: 'switch' }] },
  },
  [`${API.VERSION_1_0}/devices/${deviceId}`]: {
    success: true,
    result: { category: 'cz', local_key: 'lk', ip: '1.2.3.4' },
  },
  [`${API.VERSION_2_0}/thing/${deviceId}/shadow/properties`]: {
    success: true,
    result: { properties: [{ code: 'switch', value: true }] },
  },
  [`${API.VERSION_2_0}/thing/${deviceId}/model`]: {
    success: true,
    result: { model: JSON.stringify({ services: [{ properties: [{ code: 'switch' }] }] }) },
  },
});

test('loadDeviceDetails merges specification, details, properties and thing model', async () => {
  const handler = createHandler();
  const responses = detailsResponses('dev1');
  handler.connector = {
    request: async ({ path }) => responses[path],
  };

  const device = await handler.loadDeviceDetails({ id: 'dev1', name: 'My socket' });

  assert.equal(device.name, 'My socket');
  assert.equal(device.local_key, 'lk');
  assert.equal(device.ip, '1.2.3.4');
  assert.equal(device.specifications.category, 'cz');
  assert.deepEqual(device.specifications.functions, [{ code: 'switch' }]);
  assert.deepEqual(device.properties.properties, [{ code: 'switch', value: true }]);
  assert.deepEqual(device.thing_model.services, [{ properties: [{ code: 'switch' }] }]);
});

test('loadDeviceDetails survives partial cloud failures', async () => {
  const handler = createHandler();
  handler.connector = {
    request: async ({ path }) => {
      if (path.includes('/specification')) {
        throw new Error('spec endpoint down');
      }
      return { success: true, result: {} };
    },
  };

  const device = await handler.loadDeviceDetails({ id: 'dev1', category: 'cz' });
  assert.deepEqual(device.specifications, { category: 'cz' });
  // An empty model payload stays an empty object (same as the core port).
  assert.deepEqual(device.thing_model, {});
});

// --- discoverDevices ---------------------------------------------------------

test('discoverDevices loads details and normalizes the LAN-related fields', async () => {
  const handler = createHandler();
  handler.status = STATUS.CONNECTED;
  const responses = {
    ...detailsResponses('dev1'),
    [`${API.PUBLIC_VERSION_1_0}/users/app-uid/devices`]: {
      success: true,
      result: [{ id: 'dev1', name: 'My socket' }],
    },
  };
  handler.connector = {
    request: async ({ path }) => responses[path],
  };

  const devices = await handler.discoverDevices();

  assert.equal(devices.length, 1);
  assert.equal(devices[0].id, 'dev1');
  // The public IP reported by the cloud is kept as cloud_ip; the LAN fields
  // are reset until a local scan fills them.
  assert.equal(devices[0].cloud_ip, '1.2.3.4');
  assert.equal(devices[0].ip, null);
  assert.equal(devices[0].protocol_version, null);
  assert.equal(devices[0].local_override, false);
  assert.equal(handler.status, STATUS.CONNECTED);
  assert.equal(handler.discoveredDevices, devices);
});

test('discoverDevices refuses to run when not connected', async () => {
  const handler = createHandler();
  handler.status = STATUS.NOT_INITIALIZED;
  await assert.rejects(() => handler.discoverDevices(), /Unable to discover/);
});
