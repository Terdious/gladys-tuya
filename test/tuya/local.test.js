import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import { DEVICE_FEATURE_CATEGORIES, DEVICE_FEATURE_TYPES } from '@gladysassistant/integration-sdk';

import { TuyaHandler } from '../../src/tuya/handler.js';
import { DEVICE_PARAM_NAME, STATUS } from '../../src/tuya/constants.js';
import {
  getLocalDpsFromCode,
  addFallbackBinaryFeature,
  hasDpsKey,
} from '../../src/tuya/device/tuya.localMapping.js';
import { createScanCollector, applyLocalScanResults } from '../../src/tuya/local/tuya.localScan.js';
import {
  getLocalMapping,
  getIgnoredLocalDps,
  DEVICE_TYPES,
} from '../../src/tuya/mappings/index.js';
import { normalizeConfig } from '../../src/config.js';
import { createFakeGladys } from '../helpers/fakeGladys.js';

const require = createRequire(import.meta.url);

// --- local mappings ----------------------------------------------------------

test('getLocalMapping returns the per-type mapping with the global fallback', () => {
  const socket = getLocalMapping(DEVICE_TYPES.SMART_SOCKET);
  assert.equal(socket.strict, true);
  assert.equal(socket.dps.switch_2, 2);
  assert.deepEqual(socket.ignoredDps, ['11']);

  const meter = getLocalMapping(DEVICE_TYPES.SMART_METER);
  assert.equal(meter.dps.total_power, 115);
  assert.ok(getIgnoredLocalDps(DEVICE_TYPES.SMART_METER).includes('102'));

  const unknown = getLocalMapping(DEVICE_TYPES.UNKNOWN);
  assert.equal(unknown.strict, false);
  assert.equal(unknown.dps.switch, 1);
});

test('getLocalDpsFromCode resolves direct codes, aliases and fallbacks', () => {
  const socketDevice = { device_type: DEVICE_TYPES.SMART_SOCKET };
  assert.equal(getLocalDpsFromCode('switch_2', socketDevice), 2);
  assert.equal(getLocalDpsFromCode('power', socketDevice), 1);

  const meterDevice = { device_type: DEVICE_TYPES.SMART_METER };
  assert.equal(getLocalDpsFromCode('energy_forword_a', meterDevice), 106);
  // Strict mapping: unknown codes do NOT fall back to the switch_N inference.
  assert.equal(getLocalDpsFromCode('cur_power', meterDevice), null);

  const unknownDevice = { device_type: DEVICE_TYPES.UNKNOWN };
  assert.equal(getLocalDpsFromCode('switch', unknownDevice), 1);
  // Non-strict mapping: switch_N infers DPS N.
  assert.equal(getLocalDpsFromCode('switch_3', unknownDevice), 3);
  assert.equal(getLocalDpsFromCode('unmapped_code', unknownDevice), null);
  assert.equal(getLocalDpsFromCode(null, unknownDevice), null);
});

test('hasDpsKey matches string and numeric keys', () => {
  assert.equal(hasDpsKey({ 1: true }, 1), true);
  assert.equal(hasDpsKey({ 1: true }, '1'), true);
  assert.equal(hasDpsKey({ 2: true }, 1), false);
  assert.equal(hasDpsKey(null, 1), false);
});

test('addFallbackBinaryFeature adds a switch feature when DPS 1 is exposed', () => {
  const gladys = createFakeGladys();
  const ids = gladys.externalIds('device', 'dev1');
  const device = { external_id: ids.device, features: [], device_type: DEVICE_TYPES.UNKNOWN };

  const withFallback = addFallbackBinaryFeature(device, { 1: true }, ids);
  assert.equal(withFallback.features.length, 1);
  assert.equal(withFallback.features[0].external_id, 'ext:tuya:device:dev1:switch_1');
  assert.equal(withFallback.features[0].read_only, false);

  // No DPS 1 -> untouched.
  const noDps = addFallbackBinaryFeature({ ...device, features: [] }, { 2: true }, ids);
  assert.equal(noDps.features.length, 0);
});

// --- scan collector ----------------------------------------------------------

test('createScanCollector parses a Tuya UDP discovery packet', () => {
  const { MessageParser, CommandType } = require('@demirdeniz/tuyapi-newgen/lib/message-parser.js');
  const { UDP_KEY } = require('@demirdeniz/tuyapi-newgen/lib/config.js');
  const parser = new MessageParser({ key: UDP_KEY, version: 3.1 });
  const packet = parser.encode({
    data: { ip: '192.168.1.50', gwId: 'dev1', productKey: 'pk', version: '3.3' },
    commandByte: CommandType.UDP_NEW,
    sequenceN: 0,
  });

  const { devices, onMessage } = createScanCollector();
  onMessage(packet, { address: '192.168.1.50', port: 6667 });

  assert.deepEqual(devices, {
    dev1: { ip: '192.168.1.50', version: '3.3', productKey: 'pk' },
  });
});

test('createScanCollector ignores unparseable packets', () => {
  const { devices, onMessage } = createScanCollector();
  onMessage(Buffer.from('not a tuya packet'), { address: '1.2.3.4', port: 6666 });
  assert.deepEqual(devices, {});
});

test('localScan runs a mediated udp-broadcast scan and parses the relayed payloads', async () => {
  const { MessageParser, CommandType } = require('@demirdeniz/tuyapi-newgen/lib/message-parser.js');
  const { UDP_KEY } = require('@demirdeniz/tuyapi-newgen/lib/config.js');
  const parser = new MessageParser({ key: UDP_KEY, version: 3.1 });
  const packet = parser.encode({
    data: { ip: '192.168.1.50', gwId: 'dev1', productKey: 'pk', version: '3.3' },
    commandByte: CommandType.UDP_NEW,
    sequenceN: 0,
  });

  const gladys = createFakeGladys();
  let scanArgs = null;
  gladys.scanNetwork = async (type, options) => {
    scanArgs = { type, options };
    return [
      { source_ip: '192.168.1.50', source_port: 6667, payload_base64: packet.toString('base64') },
      { source_ip: '1.2.3.4', source_port: 6666, payload_base64: 'bm90IHR1eWE=' },
    ];
  };
  const handler = new TuyaHandler(gladys);

  const scan = await handler.localScan({ timeoutSeconds: 10 });

  assert.deepEqual(scanArgs, { type: 'udp-broadcast', options: { timeoutSeconds: 10 } });
  assert.deepEqual(scan.devices, {
    dev1: { ip: '192.168.1.50', version: '3.3', productKey: 'pk' },
  });
});

test('localScan clamps the timeout to an integer between 1 and 30 seconds', async () => {
  const gladys = createFakeGladys();
  const timeouts = [];
  gladys.scanNetwork = async (type, options) => {
    timeouts.push(options.timeoutSeconds);
    return [];
  };
  const handler = new TuyaHandler(gladys);

  await handler.localScan({ timeoutSeconds: 90 });
  await handler.localScan({ timeoutSeconds: 2.6 });
  await handler.localScan({ timeoutSeconds: 'not-a-number' });

  assert.deepEqual(timeouts, [30, 3, 10]);
});

test('localScan degrades gracefully when the SDK has no scanNetwork', async () => {
  const handler = new TuyaHandler(createFakeGladys());
  const scan = await handler.localScan({ timeoutSeconds: 10 });
  assert.deepEqual(scan.devices, {});
  assert.equal(scan.unsupported, true);
});

test('applyLocalScanResults enriches matching devices and flags local_override', () => {
  const tuyaDevices = [
    {
      id: 'dev1',
      name: 'Socket',
      cloud_ip: '82.1.1.1',
      ip: null,
      protocol_version: null,
      local_override: false,
    },
    {
      id: 'dev2',
      name: 'Other',
      cloud_ip: '82.1.1.2',
      ip: null,
      protocol_version: null,
      local_override: false,
    },
  ];
  const enriched = applyLocalScanResults(tuyaDevices, {
    dev1: { ip: '192.168.1.50', version: '3.3', productKey: 'pk' },
  });

  assert.equal(enriched[0].ip, '192.168.1.50');
  assert.equal(enriched[0].protocol_version, '3.3');
  assert.equal(enriched[0].product_key, 'pk');
  assert.equal(enriched[0].local_override, true);
  assert.equal(enriched[1].local_override, false);
  assert.equal(enriched[1].ip, null);
});

// --- poll: local branch ------------------------------------------------------

function createLocalDevice() {
  return {
    external_id: 'ext:tuya:device:dev1',
    device_type: DEVICE_TYPES.SMART_SOCKET,
    params: [
      { name: DEVICE_PARAM_NAME.DEVICE_ID, value: 'dev1' },
      { name: DEVICE_PARAM_NAME.IP_ADDRESS, value: '192.168.1.50' },
      { name: DEVICE_PARAM_NAME.LOCAL_KEY, value: 'lk' },
      { name: DEVICE_PARAM_NAME.PROTOCOL_VERSION, value: '3.3' },
      { name: DEVICE_PARAM_NAME.LOCAL_OVERRIDE, value: true },
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

test('poll uses the local DPS map when the device opted into local mode', async () => {
  const gladys = createFakeGladys();
  const handler = new TuyaHandler(gladys);
  let localArgs = null;
  handler.localPoll = async (payload) => {
    localArgs = payload;
    return { dps: { 1: true } };
  };
  handler.connector = {
    request: async () => {
      throw new Error('cloud must not be called');
    },
  };

  await handler.poll(createLocalDevice());

  assert.equal(localArgs.deviceId, 'dev1');
  assert.equal(localArgs.ip, '192.168.1.50');
  assert.equal(localArgs.protocolVersion, '3.3');
  assert.deepEqual(gladys.published, [
    { featureExternalId: 'ext:tuya:device:dev1:switch', state: 1 },
  ]);
});

test('poll falls back to the cloud for features missing from the local mapping', async () => {
  const gladys = createFakeGladys();
  const handler = new TuyaHandler(gladys);
  handler.localPoll = async () => ({ dps: { 1: true } });
  const cloudPaths = [];
  handler.connector = {
    request: async ({ path }) => {
      cloudPaths.push(path);
      return { success: true, result: [{ code: 'cur_power', value: 253 }] };
    },
  };

  const device = createLocalDevice();
  device.features.push({
    external_id: 'ext:tuya:device:dev1:cur_power',
    category: DEVICE_FEATURE_CATEGORIES.SWITCH,
    type: DEVICE_FEATURE_TYPES.SWITCH.POWER,
  });

  await handler.poll(device);

  assert.equal(cloudPaths.length, 1);
  assert.deepEqual(gladys.published, [
    { featureExternalId: 'ext:tuya:device:dev1:switch', state: 1 },
    { featureExternalId: 'ext:tuya:device:dev1:cur_power', state: 25.3 },
  ]);
});

test('poll falls back to the cloud when the local poll fails', async () => {
  const gladys = createFakeGladys();
  const handler = new TuyaHandler(gladys);
  handler.localPoll = async () => {
    throw new Error('unreachable');
  };
  handler.connector = {
    request: async () => ({ success: true, result: [{ code: 'switch', value: false }] }),
  };

  await handler.poll(createLocalDevice());
  assert.deepEqual(gladys.published, [
    { featureExternalId: 'ext:tuya:device:dev1:switch', state: 0 },
  ]);
});

test('poll skips the cloud fallback when local mode is on and the connector is missing', async () => {
  const gladys = createFakeGladys();
  const handler = new TuyaHandler(gladys);
  handler.localPoll = async () => {
    throw new Error('unreachable');
  };
  handler.connector = null;

  await handler.poll(createLocalDevice());
  assert.deepEqual(gladys.published, []);
});

// --- setValue: local branch --------------------------------------------------

function createFakeLocalApi(log, { failSet = false } = {}) {
  return class FakeLocalApi {
    constructor(options) {
      log.push({ event: 'new', options });
    }

    on() {}

    async connect() {
      log.push({ event: 'connect' });
    }

    async set(payload) {
      if (failSet) {
        throw new Error('local set failed');
      }
      log.push({ event: 'set', payload });
    }

    async disconnect() {
      log.push({ event: 'disconnect' });
    }
  };
}

test('setValue sets the DPS locally for a local-override device', async () => {
  const handler = new TuyaHandler(createFakeGladys());
  const log = [];
  handler.localApiClasses = {
    TuyAPI: createFakeLocalApi(log),
    TuyAPINewGen: createFakeLocalApi([]),
  };
  handler.connector = {
    request: async () => {
      throw new Error('cloud must not be called');
    },
  };

  const device = createLocalDevice();
  await handler.setValue(
    device,
    {
      external_id: 'ext:tuya:device:dev1:switch',
      category: DEVICE_FEATURE_CATEGORIES.SWITCH,
      type: DEVICE_FEATURE_TYPES.SWITCH.BINARY,
    },
    1,
  );

  const setCall = log.find((entry) => entry.event === 'set');
  assert.deepEqual(setCall.payload, { dps: 1, set: true });
  assert.ok(log.some((entry) => entry.event === 'disconnect'));
});

test('setValue uses the new-gen API for protocols 3.4/3.5', async () => {
  const handler = new TuyaHandler(createFakeGladys());
  const legacyLog = [];
  const newGenLog = [];
  handler.localApiClasses = {
    TuyAPI: createFakeLocalApi(legacyLog),
    TuyAPINewGen: createFakeLocalApi(newGenLog),
  };

  const device = createLocalDevice();
  device.params = device.params.map((param) =>
    param.name === DEVICE_PARAM_NAME.PROTOCOL_VERSION ? { ...param, value: '3.4' } : param,
  );
  await handler.setValue(
    device,
    {
      external_id: 'ext:tuya:device:dev1:switch',
      category: DEVICE_FEATURE_CATEGORIES.SWITCH,
      type: DEVICE_FEATURE_TYPES.SWITCH.BINARY,
    },
    0,
  );

  assert.equal(legacyLog.length, 0);
  const setCall = newGenLog.find((entry) => entry.event === 'set');
  assert.deepEqual(setCall.payload, { dps: 1, set: false });
});

test('setValue falls back to the cloud when the local set fails', async () => {
  const handler = new TuyaHandler(createFakeGladys());
  const log = [];
  handler.localApiClasses = {
    TuyAPI: createFakeLocalApi(log, { failSet: true }),
    TuyAPINewGen: createFakeLocalApi([]),
  };
  let cloudRequest = null;
  handler.connector = {
    request: async (options) => {
      cloudRequest = options;
      return { success: true };
    },
  };

  await handler.setValue(
    createLocalDevice(),
    {
      external_id: 'ext:tuya:device:dev1:switch',
      category: DEVICE_FEATURE_CATEGORIES.SWITCH,
      type: DEVICE_FEATURE_TYPES.SWITCH.BINARY,
    },
    1,
  );

  assert.ok(log.some((entry) => entry.event === 'disconnect'));
  assert.deepEqual(cloudRequest.body.commands, [{ code: 'switch', value: true }]);
});

// --- reconnect / disconnect --------------------------------------------------

const CONFIG = normalizeConfig({
  endpoint: 'centralEurope',
  access_key: 'a',
  secret_key: 's',
  app_account_id: 'u',
});

test('tryReconnect does nothing when auto-reconnect is not allowed', async () => {
  const handler = new TuyaHandler(createFakeGladys());
  handler.autoReconnectAllowed = false;
  assert.equal(await handler.tryReconnect(), false);
});

test('tryReconnect reconnects a configured handler in error state', async () => {
  const handler = new TuyaHandler(createFakeGladys());
  handler.config = CONFIG;
  handler.autoReconnectAllowed = true;
  handler.status = STATUS.ERROR;
  let connected = false;
  handler.connect = async () => {
    connected = true;
    handler.status = STATUS.CONNECTED;
  };

  const shouldRetry = await handler.tryReconnect();
  assert.equal(connected, true);
  assert.equal(shouldRetry, false);
});

test('tryReconnect does not reconnect after a manual disconnect', async () => {
  const handler = new TuyaHandler(createFakeGladys());
  handler.config = CONFIG;
  handler.autoReconnectAllowed = true;
  handler.status = STATUS.ERROR;
  await handler.manualDisconnect();
  let connected = false;
  handler.connect = async () => {
    connected = true;
  };

  await handler.tryReconnect();
  assert.equal(connected, false);
});

test('disconnect resets the connection state and stops the reconnect manager', async () => {
  const handler = new TuyaHandler(createFakeGladys());
  handler.connector = {};
  handler.status = STATUS.CONNECTED;
  handler.lastError = 'x';
  handler.startReconnect();
  assert.ok(handler.reconnectInterval);

  handler.disconnect();

  assert.equal(handler.connector, null);
  assert.equal(handler.status, STATUS.NOT_INITIALIZED);
  assert.equal(handler.lastError, null);
  assert.equal(handler.reconnectInterval, null);
});

test('getStatus reports configuration and manual disconnect', async () => {
  const handler = new TuyaHandler(createFakeGladys());
  handler.config = CONFIG;
  const status = await handler.getStatus();
  assert.equal(status.configured, true);
  assert.equal(status.connected, false);
  assert.equal(status.manual_disconnect, false);

  await handler.manualDisconnect();
  const after = await handler.getStatus();
  assert.equal(after.manual_disconnect, true);
});
