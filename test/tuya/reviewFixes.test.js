import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TuyaHandler } from '../../src/tuya/handler.js';
import { getDeviceType, DEVICE_TYPES } from '../../src/tuya/mappings/index.js';
import { DEVICE_PARAM_NAME, STATUS } from '../../src/tuya/constants.js';
import { createFakeGladys } from '../helpers/fakeGladys.js';

const DEVICE_ID = 'devclean1';
const EXTERNAL_ID = `ext:tuya:device:${DEVICE_ID}`;

function createHandler() {
  const fake = createFakeGladys();
  const handler = new TuyaHandler(fake);
  return { fake, handler };
}

test('cleanupDevice releases the session and every per-device cache entry', async () => {
  const { handler } = createHandler();
  let disconnected = false;
  handler.localSessions.set(DEVICE_ID, {
    deviceId: DEVICE_ID,
    connected: true,
    api: {
      disconnect: async () => {
        disconnected = true;
      },
    },
  });
  handler.localCircuit.set(DEVICE_ID, { failures: 2 });
  handler.lastTransports.set(EXTERNAL_ID, 'local');
  handler.featureStates.set(`${EXTERNAL_ID}:switch`, { lastValue: 1 });
  handler.featureStates.set('ext:tuya:device:other:switch', { lastValue: 0 });

  await handler.cleanupDevice({
    external_id: EXTERNAL_ID,
    params: [{ name: DEVICE_PARAM_NAME.DEVICE_ID, value: DEVICE_ID }],
  });

  assert.equal(disconnected, true);
  assert.equal(handler.localSessions.has(DEVICE_ID), false);
  assert.equal(handler.localCircuit.has(DEVICE_ID), false);
  assert.equal(handler.lastTransports.has(EXTERNAL_ID), false);
  assert.equal(handler.featureStates.has(`${EXTERNAL_ID}:switch`), false);
  // Other devices' entries are untouched.
  assert.equal(handler.featureStates.has('ext:tuya:device:other:switch'), true);
});

test('discoverDevices does not clobber a disconnect that happened mid-run', async () => {
  const { handler } = createHandler();
  handler.status = STATUS.CONNECTED;
  handler.loadDevices = async () => {
    // A config change disconnects while the discovery is in flight.
    handler.status = STATUS.NOT_INITIALIZED;
    return [];
  };
  handler.loadDeviceDetails = async (d) => d;

  await handler.discoverDevices();
  assert.equal(handler.status, STATUS.NOT_INITIALIZED, 'stale run must not restore CONNECTED');
});

test('discoverDevices keeps the previous list when the cloud load fails', async () => {
  const { handler } = createHandler();
  handler.status = STATUS.CONNECTED;
  handler.discoveredDevices = [{ id: 'kept' }];
  handler.loadDevices = async () => {
    throw new Error('cloud down');
  };

  await assert.rejects(() => handler.discoverDevices(), /cloud down/);
  assert.deepEqual(handler.discoveredDevices, [{ id: 'kept' }]);
  assert.equal(handler.status, STATUS.CONNECTED);
});

test('poll skips a device whose previous poll is still running', async () => {
  const { handler } = createHandler();
  handler.config = { localMode: false };
  let inFlight = 0;
  let maxInFlight = 0;
  handler.connector = {
    request: async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => {
        setTimeout(resolve, 30);
      });
      inFlight -= 1;
      return { success: true, result: [] };
    },
  };
  const device = {
    external_id: EXTERNAL_ID,
    device_type: DEVICE_TYPES.SMART_SOCKET,
    features: [{ external_id: `${EXTERNAL_ID}:switch_1`, category: 'switch', type: 'binary' }],
    params: [{ name: DEVICE_PARAM_NAME.DEVICE_ID, value: DEVICE_ID }],
  };

  await Promise.all([handler.poll(device), handler.poll(device), handler.poll(device)]);
  assert.equal(maxInFlight, 1, 'overlapping polls must be skipped, not run concurrently');
});

test('getDeviceType trusts the persisted DEVICE_TYPE param over heuristics', () => {
  const device = {
    // A renamed device with no recognizable name/codes.
    name: 'Renommé sans indice',
    params: [
      { name: DEVICE_PARAM_NAME.DEVICE_ID, value: 'x1' },
      { name: DEVICE_PARAM_NAME.DEVICE_TYPE, value: 'air-conditioner' },
    ],
  };
  assert.equal(getDeviceType(device), DEVICE_TYPES.AIR_CONDITIONER);
  // An invalid stored value falls back to the heuristics.
  device.params[1].value = 'not-a-type';
  assert.equal(getDeviceType(device), DEVICE_TYPES.UNKNOWN);
});

test('a command joins a reconnecting session instead of opening a one-shot connect', async () => {
  const { handler } = createHandler();
  handler.config = { localMode: true };
  let oneShotCreated = false;
  handler.localApiClasses = {
    TuyAPI: class {
      constructor() {
        oneShotCreated = true;
      }
    },
    TuyAPINewGen: class {
      constructor() {
        oneShotCreated = true;
      }
    },
  };
  // A session object exists but is NOT connected (mid-reconnect).
  let setCalls = 0;
  const session = {
    deviceId: DEVICE_ID,
    ip: '10.0.0.5',
    localKey: 'lk',
    protocolVersion: '3.3',
    connected: false,
    connecting: null,
    api: {
      connect: async () => {
        session.connected = true;
      },
      set: async () => {
        setCalls += 1;
      },
      on: () => {},
      disconnect: async () => {},
    },
  };
  handler.localSessions.set(DEVICE_ID, session);

  const device = {
    external_id: EXTERNAL_ID,
    device_type: DEVICE_TYPES.SMART_SOCKET,
    params: [
      { name: DEVICE_PARAM_NAME.DEVICE_ID, value: DEVICE_ID },
      { name: DEVICE_PARAM_NAME.IP_ADDRESS, value: '10.0.0.5' },
      { name: DEVICE_PARAM_NAME.LOCAL_KEY, value: 'lk' },
      { name: DEVICE_PARAM_NAME.PROTOCOL_VERSION, value: '3.3' },
    ],
  };
  const feature = { external_id: `${EXTERNAL_ID}:switch_1`, category: 'switch', type: 'binary' };

  await handler.setValue(device, feature, 1);

  assert.equal(oneShotCreated, false, 'no competing one-shot connect while a session exists');
  assert.equal(setCalls, 1, 'the command went through the reconnected session');
});

test('localRead serves the pushed cache when an active read fails on a live session', async () => {
  const { handler } = createHandler();
  const session = {
    deviceId: DEVICE_ID,
    ip: '10.0.0.5',
    localKey: 'lk',
    protocolVersion: '3.5',
    connected: true,
    connecting: null,
    // Pushed 10s ago: stale for the fresh-cache path, fresh enough to prove
    // the LAN link is alive.
    lastDps: { 1: true, 2: 240 },
    lastDpsAt: Date.now() - 10 * 1000,
    api: {
      get: async () => {
        throw new Error('Local poll timeout');
      },
      disconnect: async () => {},
    },
  };
  handler.localSessions.set(DEVICE_ID, session);

  const { dps } = await handler.localRead({
    deviceId: DEVICE_ID,
    ip: '10.0.0.5',
    localKey: 'lk',
    protocolVersion: '3.5',
  });
  assert.deepEqual(dps, { 1: true, 2: 240 });
  // The session survives: the socket demonstrably pushes.
  assert.equal(handler.localSessions.has(DEVICE_ID), true);
});

test('continuous-sensor pushes are throttled to one emission per interval', async () => {
  const { fake, handler } = createHandler();
  const device = {
    external_id: EXTERNAL_ID,
    device_type: DEVICE_TYPES.AIR_CONDITIONER,
    features: [
      {
        external_id: `${EXTERNAL_ID}:temp_current`,
        category: 'temperature-sensor',
        type: 'decimal',
        scale: 1,
      },
      { external_id: `${EXTERNAL_ID}:Power`, category: 'air-conditioning', type: 'binary' },
    ],
    params: [{ name: DEVICE_PARAM_NAME.DEVICE_ID, value: DEVICE_ID }],
  };
  fake.devices.push(device);
  handler.localSessions.set(DEVICE_ID, { deviceId: DEVICE_ID, connected: true, api: {} });

  // A sensor flapping several times in a burst: only the first value passes.
  await handler.handleLocalPush(DEVICE_ID, { 3: 231 });
  await handler.handleLocalPush(DEVICE_ID, { 3: 232 });
  await handler.handleLocalPush(DEVICE_ID, { 3: 233 });
  // Event-like DPS stay instantaneous even inside the throttle window.
  await handler.handleLocalPush(DEVICE_ID, { 1: true });

  const tempStates = fake.published.filter(
    (p) => p.featureExternalId === `${EXTERNAL_ID}:temp_current`,
  );
  const powerStates = fake.published.filter((p) => p.featureExternalId === `${EXTERNAL_ID}:Power`);
  assert.equal(tempStates.length, 1, 'continuous sensor throttled to one emission');
  assert.equal(tempStates[0].state, 23.1);
  assert.equal(powerStates.length, 1, 'event-like feature passed through');
});
