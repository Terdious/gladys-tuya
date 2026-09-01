import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveTuyaDeviceRef } from '../../src/tuya/utils/tuya.resolveDeviceRef.js';

function createFakeTuya(devices) {
  return {
    discoveredDevices: devices,
    discoverDevices: async () => {
      throw new Error(
        'discoverDevices should not be called when discoveredDevices is already populated',
      );
    },
  };
}

test('resolves a device by its Tuya id', async () => {
  const tuya = createFakeTuya([{ id: 'dev1', name: 'Living room socket' }]);
  const resolved = await resolveTuyaDeviceRef(tuya, 'dev1');
  assert.equal(resolved.id, 'dev1');
});

test('resolves a device by its display name (case-insensitive)', async () => {
  const tuya = createFakeTuya([{ id: 'dev1', name: 'Honiture Q6 Pro' }]);
  const resolved = await resolveTuyaDeviceRef(tuya, 'honiture q6 pro');
  assert.equal(resolved.id, 'dev1');
});

test('refreshes the discovery cache when it is empty', async () => {
  const tuya = {
    discoveredDevices: [],
    discoverDevices: async () => [{ id: 'dev1', name: 'Honiture Q6 Pro' }],
  };
  const resolved = await resolveTuyaDeviceRef(tuya, 'dev1');
  assert.equal(resolved.id, 'dev1');
});

test('rejects an ambiguous name shared by several devices', async () => {
  const tuya = createFakeTuya([
    { id: 'dev1', name: 'Socket' },
    { id: 'dev2', name: 'Socket' },
  ]);
  await assert.rejects(() => resolveTuyaDeviceRef(tuya, 'Socket'), /Several devices are named/);
});

test('rejects a device reference matching nothing', async () => {
  const tuya = createFakeTuya([{ id: 'dev1', name: 'Socket' }]);
  await assert.rejects(() => resolveTuyaDeviceRef(tuya, 'unknown'), /not found/);
});
