import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';

import { createTuyaIntegration } from '../src/app.js';
import { STATUS } from '../src/tuya/constants.js';

// Orchestration tests of src/app.js (issue #20): the real SDK client bound to
// the SDK's in-memory Gladys, and a stub Tuya handler recording its calls.

const CONFIG = {
  endpoint: 'westernEurope',
  access_key: 'access',
  secret_key: 'secret',
  app_account_id: 'uid',
  GLADYS_PREFER_LOCAL: true,
};

const rawSocket = (id, name, extra = {}) => ({
  id,
  name,
  product_id: `p-${id}`,
  local_key: `lk-${id}`,
  online: true,
  specifications: {
    category: 'cz',
    functions: [{ code: 'switch_1', type: 'Boolean', values: '{}' }],
    status: [{ code: 'switch_1', type: 'Boolean', values: '{}' }],
  },
  ...extra,
});

function createStubTuya(cloudDevices = [rawSocket('dev1', 'Prise salon')]) {
  const calls = [];
  const tuya = {
    calls,
    status: STATUS.NOT_INITIALIZED,
    config: null,
    discoveredDevices: [],
    lastError: null,
    lastErrorMessage: null,
    cloudDevices,
    async connect() {
      calls.push('connect');
      this.status = STATUS.CONNECTED;
    },
    async disconnect() {
      calls.push('disconnect');
      this.status = STATUS.NOT_INITIALIZED;
    },
    startReconnect() {
      calls.push('startReconnect');
    },
    async startPulsar() {
      calls.push('startPulsar');
    },
    stopPulsar() {
      calls.push('stopPulsar');
    },
    async discoverDevices() {
      calls.push('discoverDevices');
      return this.cloudDevices.map((device) => ({ ...device }));
    },
    scanResult: {},
    async localScan() {
      calls.push('localScan');
      return { devices: this.scanResult };
    },
    async closeAllLocalSessions() {
      calls.push('closeAllLocalSessions');
    },
    async detectProtocol({ deviceId, ip }) {
      calls.push(`detectProtocol:${deviceId}:${ip}`);
      return { version: '3.4' };
    },
    async poll(device) {
      calls.push({ poll: device });
    },
    async setValue(device, feature, value) {
      calls.push({ setValue: { device, feature, value } });
    },
    async cleanupDevice(device) {
      calls.push(`cleanupDevice:${device.external_id}`);
    },
    async manualDisconnect() {
      calls.push('manualDisconnect');
    },
  };
  return tuya;
}

async function setup({ config = CONFIG, devices = [], tuya = createStubTuya(), options } = {}) {
  const gladys = createFakeGladys({ selector: 'tuya', config, devices });
  // The real handler keeps the SDK client (the diagnostic converts with it).
  tuya.gladys = gladys;
  const app = createTuyaIntegration(gladys, tuya, options);
  await gladys.connect();
  return { gladys, tuya, app };
}

const count = (calls, name) => calls.filter((call) => call === name).length;
const paramOf = (device, name) => (device.params.find((p) => p.name === name) || {}).value;

test('on connect: connects the Tuya cloud, publishes the devices and a connected status', async () => {
  const { gladys, tuya } = await setup();
  assert.equal(count(tuya.calls, 'connect'), 1);
  assert.equal(count(tuya.calls, 'startReconnect'), 1);
  assert.equal(count(tuya.calls, 'discoverDevices'), 1);
  // Local mode on: the cloud discovery is enriched with a LAN scan.
  assert.equal(count(tuya.calls, 'localScan'), 1);
  assert.deepEqual(
    gladys.fake.discoveredDevices.map((d) => d.name),
    ['Prise salon'],
  );
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('not configured yet: no cloud connection, a "not configured" status', async () => {
  const { gladys, tuya } = await setup({ config: {} });
  assert.equal(count(tuya.calls, 'connect'), 0);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /Not configured/);
});

test('a WebSocket flap with the same config does not reconnect nor rescan (#21)', async () => {
  const { gladys, tuya } = await setup();
  const published = gladys.fake.bodies('POST', '/discovered_device').length;
  await gladys.disconnect();
  await gladys.connect();
  assert.equal(count(tuya.calls, 'connect'), 1);
  assert.equal(count(tuya.calls, 'discoverDevices'), 1);
  assert.equal(count(tuya.calls, 'localScan'), 1);
  // The cached list is republished and the status re-reported.
  assert.equal(gladys.fake.bodies('POST', '/discovered_device').length, published + 1);
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('a WebSocket flap with a changed config reconnects', async () => {
  const { gladys, tuya } = await setup();
  await gladys.disconnect();
  gladys.fake.config.secret_key = 'new-secret';
  await gladys.connect();
  assert.equal(count(tuya.calls, 'connect'), 2);
  assert.equal(count(tuya.calls, 'discoverDevices'), 2);
});

test('concurrent scan requests share one discovery run', async () => {
  const { gladys, tuya } = await setup();
  await Promise.all([gladys.fake.scanRequest(), gladys.fake.scanRequest()]);
  // 1 on connect + 1 for the two concurrent requests.
  assert.equal(count(tuya.calls, 'discoverDevices'), 2);
});

test('poll rebuilds the device from the stored one: a minimal command never drops the LAN params', async () => {
  const stored = {
    external_id: 'ext:tuya:device:dev1',
    selector: 'prise-salon',
    name: 'Prise salon',
    device_type: 'smart-socket',
    features: [{ external_id: 'ext:tuya:device:dev1:switch_1' }],
    params: [
      { name: 'DEVICE_ID', value: 'dev1' },
      { name: 'IP_ADDRESS', value: '192.168.1.20' },
      { name: 'LOCAL_KEY', value: 'lk' },
      { name: 'PROTOCOL_VERSION', value: '3.4' },
    ],
  };
  const { gladys, tuya } = await setup({ devices: [stored] });
  await gladys.fake.poll({
    external_id: stored.external_id,
    selector: stored.selector,
    params: [],
  });
  const { poll } = tuya.calls.find((call) => call && call.poll);
  assert.equal(paramOf(poll, 'IP_ADDRESS'), '192.168.1.20');
  assert.equal(paramOf(poll, 'PROTOCOL_VERSION'), '3.4');
  assert.equal(poll.features.length, 1);
  assert.equal(poll.device_type, 'smart-socket');
});

test('a command param wins over the stored one with the same name', async () => {
  const stored = {
    external_id: 'ext:tuya:device:dev1',
    selector: 'prise-salon',
    name: 'Prise salon',
    features: [],
    params: [{ name: 'IP_ADDRESS', value: '192.168.1.20' }],
  };
  const { gladys, tuya } = await setup({ devices: [stored] });
  await gladys.fake.poll({
    external_id: stored.external_id,
    selector: stored.selector,
    params: [{ name: 'IP_ADDRESS', value: '192.168.1.99' }],
  });
  const { poll } = tuya.calls.find((call) => call && call.poll);
  assert.equal(paramOf(poll, 'IP_ADDRESS'), '192.168.1.99');
});

test('config update: new credentials reconnect, then rediscover', async () => {
  const { gladys, tuya } = await setup();
  await gladys.fake.configUpdated({ ...CONFIG, secret_key: 'other' });
  assert.equal(count(tuya.calls, 'disconnect'), 1);
  assert.equal(count(tuya.calls, 'connect'), 2);
  assert.equal(count(tuya.calls, 'discoverDevices'), 2);
});

test('config update: only the local toggle off releases the local sessions, no reconnect', async () => {
  const { gladys, tuya } = await setup();
  await gladys.fake.configUpdated({ ...CONFIG, GLADYS_PREFER_LOCAL: false });
  assert.equal(count(tuya.calls, 'connect'), 1);
  assert.equal(count(tuya.calls, 'closeAllLocalSessions'), 1);
  assert.equal(count(tuya.calls, 'discoverDevices'), 2);
  // Local mode off: the new discovery skips the LAN scan.
  assert.equal(count(tuya.calls, 'localScan'), 1);
});

test('config update: only the feature-name language republishes the cached list', async () => {
  const { gladys, tuya } = await setup();
  await gladys.fake.configUpdated({ ...CONFIG, feature_names: 'fr' });
  assert.equal(count(tuya.calls, 'connect'), 1);
  assert.equal(count(tuya.calls, 'discoverDevices'), 1);
  const [socket] = gladys.fake.discoveredDevices;
  assert.equal(socket.features[0].name, 'Interrupteur 1');
});

test('detect_protocol: the device picked in the list is probed and its ip/protocol persisted', async () => {
  const { gladys, tuya } = await setup();
  const ack = await gladys.fake.action('detect_protocol', {
    device: 'ext:tuya:device:dev1',
    ip: '192.168.1.42',
  });
  assert.equal(ack.success, true, JSON.stringify(ack));
  assert.match(ack.data.message.en, /Protocol 3\.4 detected at 192\.168\.1\.42/);
  assert.ok(tuya.calls.includes('detectProtocol:dev1:192.168.1.42'));
  const [socket] = gladys.fake.discoveredDevices;
  assert.equal(paramOf(socket, 'IP_ADDRESS'), '192.168.1.42');
  assert.equal(paramOf(socket, 'PROTOCOL_VERSION'), '3.4');
});

test('detect_protocol: an ambiguous name and a missing local key are explicit errors', async () => {
  const tuya = createStubTuya([
    rawSocket('dev1', 'Prise'),
    rawSocket('dev2', 'Prise'),
    rawSocket('dev3', 'Sans clé', { local_key: undefined }),
  ]);
  const { gladys } = await setup({ tuya });
  const ambiguous = await gladys.fake.action('detect_protocol', {
    device_ref: 'Prise',
    ip: '192.168.1.42',
  });
  assert.equal(ambiguous.success, false);
  assert.match(ambiguous.error, /Several devices are named/);
  const noKey = await gladys.fake.action('detect_protocol', {
    device_ref: 'dev3',
    ip: '192.168.1.43',
  });
  assert.equal(noKey.success, false);
  assert.match(noKey.error, /no local key/);
});

test('a discovery started during detect_protocol waits for it (#21 race)', async () => {
  const tuya = createStubTuya();
  let release;
  tuya.detectProtocol = async ({ deviceId }) => {
    tuya.calls.push(`probe-start:${deviceId}`);
    await new Promise((resolve) => {
      release = resolve;
    });
    tuya.calls.push(`probe-end:${deviceId}`);
    return { version: '3.3' };
  };
  const { gladys } = await setup({ tuya });
  const action = gladys.fake.action('detect_protocol', {
    device: 'ext:tuya:device:dev1',
    ip: '10.0.0.5',
  });
  // Let the action reach the probe, then ask for a discovery.
  await new Promise((resolve) => setImmediate(resolve));
  const scan = gladys.fake.scanRequest();
  await new Promise((resolve) => setImmediate(resolve));
  release();
  await Promise.all([action, scan]);
  const order = tuya.calls.filter(
    (call) => typeof call === 'string' && /^(probe-|discoverDevices)/.test(call),
  );
  assert.deepEqual(order, [
    'discoverDevices',
    'probe-start:dev1',
    'probe-end:dev1',
    'discoverDevices',
  ]);
});

test('device_diagnostic accepts the device picked in the list', async () => {
  const { gladys } = await setup();
  const ack = await gladys.fake.action('device_diagnostic', { device: 'ext:tuya:device:dev1' });
  assert.equal(ack.success, true, JSON.stringify(ack));
  assert.match(ack.data.message.en, /Tuya device diagnostic — "Prise salon"/);
});

test('an action without any device is refused with an explicit message', async () => {
  const { gladys } = await setup();
  const ack = await gladys.fake.action('device_diagnostic', {});
  assert.equal(ack.success, false);
  assert.match(ack.error, /Pick a device in the list/);
});

test('a deleted device releases its Tuya state', async () => {
  const { gladys, tuya } = await setup();
  await gladys.fake.deviceDeleted({ external_id: 'ext:tuya:device:dev1', selector: 'prise-salon' });
  assert.ok(tuya.calls.includes('cleanupDevice:ext:tuya:device:dev1'));
});

test('shutdown awaits the Tuya teardown (#21)', async () => {
  const tuya = createStubTuya();
  let closed = false;
  tuya.disconnect = async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    closed = true;
  };
  const { gladys } = await setup({ tuya });
  await gladys.fake.shutdown();
  assert.equal(closed, true);
});

test('shutdown is bounded when the teardown hangs', async () => {
  const tuya = createStubTuya();
  tuya.disconnect = () => new Promise(() => {});
  const { gladys } = await setup({ tuya, options: { shutdownTimeoutMs: 30 } });
  const started = Date.now();
  await gladys.fake.shutdown();
  assert.ok(Date.now() - started < 1000);
});

// --- Background LAN re-scan (issue #7) ----------------------------------------

const createdSocket = (params = []) => ({
  external_id: 'ext:tuya:device:dev1',
  selector: 'prise-salon',
  name: 'Prise salon',
  device_type: 'smart-socket',
  features: [{ external_id: 'ext:tuya:device:dev1:switch_1' }],
  params: [{ name: 'DEVICE_ID', value: 'dev1' }, ...params],
});

test('LAN re-scan: a created device found later gets its ip/protocol persisted (#7)', async () => {
  const { gladys, tuya, app } = await setup({ devices: [createdSocket()] });
  const scansBefore = count(tuya.calls, 'localScan');
  tuya.scanResult = { dev1: { ip: '192.168.1.77', version: '3.4' } };
  await app.rescanLan();
  assert.equal(count(tuya.calls, 'localScan'), scansBefore + 1);
  const [socket] = gladys.fake.discoveredDevices;
  assert.equal(paramOf(socket, 'IP_ADDRESS'), '192.168.1.77');
  assert.equal(paramOf(socket, 'PROTOCOL_VERSION'), '3.4');
  // No cloud discovery for that: only the LAN scan.
  assert.equal(count(tuya.calls, 'discoverDevices'), 1);
});

test('LAN re-scan: nothing new on the LAN, nothing republished', async () => {
  const { gladys, app } = await setup({ devices: [createdSocket()] });
  const published = gladys.fake.bodies('POST', '/discovered_device').length;
  await app.rescanLan();
  assert.equal(gladys.fake.bodies('POST', '/discovered_device').length, published);
});

test('LAN re-scan: skipped when every LAN-capable device already has its LAN info', async () => {
  const known = createdSocket([
    { name: 'IP_ADDRESS', value: '192.168.1.20' },
    { name: 'PROTOCOL_VERSION', value: '3.3' },
  ]);
  const { tuya, app } = await setup({ devices: [known] });
  const scansBefore = count(tuya.calls, 'localScan');
  await app.rescanLan();
  assert.equal(count(tuya.calls, 'localScan'), scansBefore);
});

test('LAN re-scan: skipped for a device type without LAN mapping (battery sensor)', async () => {
  const sensor = {
    external_id: 'ext:tuya:device:termo1',
    selector: 'termo',
    name: 'Termo',
    device_type: 'temperature-humidity-sensor',
    features: [{ external_id: 'ext:tuya:device:termo1:va_temperature' }],
    params: [{ name: 'DEVICE_ID', value: 'termo1' }],
  };
  const { tuya, app } = await setup({ devices: [sensor] });
  const scansBefore = count(tuya.calls, 'localScan');
  await app.rescanLan();
  assert.equal(count(tuya.calls, 'localScan'), scansBefore);
});

test('LAN re-scan: skipped when local mode is off', async () => {
  const { tuya, app } = await setup({
    config: { ...CONFIG, GLADYS_PREFER_LOCAL: false },
    devices: [createdSocket()],
  });
  await app.rescanLan();
  assert.equal(count(tuya.calls, 'localScan'), 0);
});

test('LAN re-scan: runs on its own timer after connect, stops on shutdown', async () => {
  const { gladys, tuya } = await setup({
    devices: [createdSocket()],
    options: { lanRescanIntervalMs: 20 },
  });
  const scansAfterConnect = count(tuya.calls, 'localScan');
  await new Promise((resolve) => setTimeout(resolve, 70));
  assert.ok(count(tuya.calls, 'localScan') > scansAfterConnect);
  await gladys.fake.shutdown();
  const scansAtShutdown = count(tuya.calls, 'localScan');
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(count(tuya.calls, 'localScan'), scansAtShutdown);
});
