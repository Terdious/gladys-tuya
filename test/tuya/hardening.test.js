import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  formatSocketError,
  SOCKET_ERROR_MESSAGE_MAX_LENGTH,
} from '../../src/tuya/local/tuya.socketError.js';
import { loadDevices, MAX_DEVICE_PAGES } from '../../src/tuya/cloud/tuya.loadDevices.js';
import { applyLocalScanResults } from '../../src/tuya/local/tuya.localScan.js';

test('formatSocketError explains network errors with the device IP', () => {
  const err = new Error('connect EHOSTUNREACH 192.168.1.50:6668');
  err.code = 'EHOSTUNREACH';
  const message = formatSocketError(err, '192.168.1.50');
  assert.match(message, /unreachable at 192\.168\.1\.50:6668 \(EHOSTUNREACH\)/);
});

test('formatSocketError truncates oversized parser errors', () => {
  const err = new Error(`Prefix does not match: ${'ab'.repeat(4000)}`);
  const message = formatSocketError(err, '10.0.0.1');
  assert.ok(message.length < SOCKET_ERROR_MESSAGE_MAX_LENGTH + 60);
  assert.match(message, /\(truncated\)$/);
});

test('formatSocketError survives errors without a message', () => {
  assert.equal(formatSocketError(null, '10.0.0.1'), 'Local socket error');
});

test('loadDevices stops at the pagination safety cap', async () => {
  let calls = 0;
  const fakeHandler = {
    config: { appAccountId: 'uid' },
    connector: {
      request: async () => {
        calls += 1;
        // A misbehaving API: always a full page with has_more=true.
        return {
          success: true,
          result: {
            list: Array.from({ length: 100 }, (_, i) => ({ id: `d${calls}-${i}` })),
            has_more: true,
          },
        };
      },
    },
  };
  fakeHandler.loadDevices = loadDevices.bind(fakeHandler);

  const devices = await fakeHandler.loadDevices();
  assert.equal(calls, MAX_DEVICE_PAGES);
  assert.equal(devices.length, MAX_DEVICE_PAGES * 100);
});

test('loadDevices tolerates a non-array result.list', async () => {
  const fakeHandler = {
    config: { appAccountId: 'uid' },
    connector: {
      request: async () => ({ success: true, result: { list: 'garbage' } }),
    },
  };
  fakeHandler.loadDevices = loadDevices.bind(fakeHandler);
  const devices = await fakeHandler.loadDevices();
  assert.deepEqual(devices, []);
});

test('applyLocalScanResults keeps working with merged partial announces', () => {
  // The merge itself lives in the UDP listener; this covers the downstream
  // application path with a device that ended up complete across announces.
  const tuyaDevices = [{ id: 'dev1', name: 'Plug' }];
  const scanDevices = { dev1: { ip: '10.0.0.9', version: '3.3', productKey: 'pk' } };
  const [enriched] = applyLocalScanResults(tuyaDevices, scanDevices, true);
  assert.equal(enriched.ip, '10.0.0.9');
  assert.equal(enriched.protocol_version, '3.3');
  assert.equal(enriched.local_override, true);
});
