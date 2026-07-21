import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import { DEVICE_FEATURE_CATEGORIES, DEVICE_FEATURE_TYPES } from '@gladysassistant/integration-sdk';

import { TuyaHandler } from '../../src/tuya/handler.js';
import { DEVICE_PARAM_NAME } from '../../src/tuya/constants.js';
import { createFakeGladys } from '../helpers/fakeGladys.js';

const flush = () => new Promise((resolve) => setImmediate(resolve));

function createFakeApiFactory(log) {
  class FakePersistentApi extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      log.instances.push(this);
    }

    async connect() {
      log.connects += 1;
    }

    async get() {
      log.gets += 1;
      return { dps: { ...log.nextDps } };
    }

    async set(payload) {
      log.sets.push(payload);
    }

    async disconnect() {
      log.disconnects += 1;
    }
  }
  return FakePersistentApi;
}

function createLocalDevice() {
  return {
    external_id: 'ext:tuya:device:dev1',
    params: [
      { name: DEVICE_PARAM_NAME.DEVICE_ID, value: 'dev1' },
      { name: DEVICE_PARAM_NAME.IP_ADDRESS, value: '192.168.1.50' },
      { name: DEVICE_PARAM_NAME.LOCAL_KEY, value: 'lk' },
      { name: DEVICE_PARAM_NAME.PROTOCOL_VERSION, value: '3.3' },
    ],
    features: [
      {
        external_id: 'ext:tuya:device:dev1:switch',
        category: DEVICE_FEATURE_CATEGORIES.SWITCH,
        type: DEVICE_FEATURE_TYPES.SWITCH.BINARY,
      },
    ],
  };
}

function createHandler() {
  const gladys = createFakeGladys();
  const handler = new TuyaHandler(gladys);
  handler.config = { localMode: true };
  const log = {
    instances: [],
    connects: 0,
    gets: 0,
    sets: [],
    disconnects: 0,
    nextDps: { 1: true },
  };
  const Fake = createFakeApiFactory(log);
  handler.localApiClasses = { TuyAPI: Fake, TuyAPINewGen: Fake };
  return { gladys, handler, log };
}

test('poll opens one persistent session and reuses it across cycles', async () => {
  const { gladys, handler, log } = createHandler();
  const device = createLocalDevice();

  await handler.poll(device);
  await handler.poll(device);

  // One socket, one handshake — the second poll reuses the session (and the
  // fresh push cache, so not even a second get is needed).
  assert.equal(log.instances.length, 1);
  assert.equal(log.connects, 1);
  assert.equal(log.gets, 1);
  assert.deepEqual(gladys.published, [
    { featureExternalId: 'ext:tuya:device:dev1:switch', state: 1 },
  ]);
  assert.deepEqual(gladys.transports, [
    { external_id: 'ext:tuya:device:dev1', transport: 'local' },
  ]);
});

test('a DPS push on the session publishes the state instantly', async () => {
  const { gladys, handler, log } = createHandler();
  const device = createLocalDevice();
  gladys.devices = [device];

  await handler.poll(device);
  assert.equal(gladys.published.length, 1);

  // The device pushes a change on its own (someone pressed the physical button).
  log.instances[0].emit('data', { dps: { 1: false } });
  await flush();

  assert.deepEqual(gladys.published[1], {
    featureExternalId: 'ext:tuya:device:dev1:switch',
    state: 0,
  });
});

test('setValue goes through the live session, never a competing socket', async () => {
  const { handler, log } = createHandler();
  const device = createLocalDevice();

  await handler.poll(device);
  await handler.setValue(
    device,
    {
      external_id: 'ext:tuya:device:dev1:switch',
      category: DEVICE_FEATURE_CATEGORIES.SWITCH,
      type: DEVICE_FEATURE_TYPES.SWITCH.BINARY,
    },
    0,
  );

  assert.equal(log.instances.length, 1, 'no second local connection was opened');
  assert.deepEqual(log.sets, [{ dps: 1, set: false }]);
});

test('a changed LAN IP recreates the session', async () => {
  const { handler, log } = createHandler();
  const device = createLocalDevice();

  await handler.poll(device);
  device.params = device.params.map((param) =>
    param.name === DEVICE_PARAM_NAME.IP_ADDRESS ? { ...param, value: '192.168.1.99' } : param,
  );
  // Age the push cache so the second poll performs an active read.
  handler.localSessions.get('dev1').lastDpsAt = 0;
  await handler.poll(device);

  assert.equal(log.instances.length, 2, 'a new session was created for the new IP');
  assert.equal(log.disconnects >= 1, true, 'the old session was closed');
  assert.equal(handler.localSessions.get('dev1').ip, '192.168.1.99');
});

test('turning the local preference off releases the session and polls the cloud', async () => {
  const { gladys, handler, log } = createHandler();
  const device = createLocalDevice();

  await handler.poll(device);
  assert.equal(handler.localSessions.size, 1);

  handler.config = { localMode: false };
  handler.connector = {
    request: async () => ({ success: true, result: [{ code: 'switch', value: true }] }),
  };
  await handler.poll(device);
  await flush();

  assert.equal(handler.localSessions.size, 0, 'the session was released');
  assert.equal(log.disconnects >= 1, true);
  // The badge followed the switch to the cloud.
  assert.deepEqual(
    gladys.transports.map((t) => t.transport),
    ['local', 'cloud'],
  );
});

test('disconnect closes every persistent session', async () => {
  const { handler, log } = createHandler();
  await handler.poll(createLocalDevice());
  assert.equal(handler.localSessions.size, 1);

  handler.disconnect();
  await flush();

  assert.equal(handler.localSessions.size, 0);
  assert.equal(log.disconnects >= 1, true);
});
