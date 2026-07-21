import { test } from 'node:test';
import assert from 'node:assert/strict';

import { enrichFromCreatedDevices } from '../../src/tuya/device/tuya.enrichDiscovery.js';
import { DEVICE_PARAM_NAME } from '../../src/tuya/constants.js';

const createdDevice = (id, params) => ({
  external_id: `ext:tuya:device:${id}`,
  params: [{ name: DEVICE_PARAM_NAME.DEVICE_ID, value: id }, ...params],
});

test('a device the scan missed keeps the LAN info stored on its created device', () => {
  const raw = [{ id: 'dev1', name: 'Clim TLT' }];
  const created = [
    createdDevice('dev1', [
      { name: DEVICE_PARAM_NAME.IP_ADDRESS, value: '10.1.0.189' },
      { name: DEVICE_PARAM_NAME.PROTOCOL_VERSION, value: '3.5' },
    ]),
  ];

  const [enriched] = enrichFromCreatedDevices(raw, created, true);
  assert.equal(enriched.ip, '10.1.0.189');
  assert.equal(enriched.protocol_version, '3.5');
  assert.equal(enriched.local_override, true);
});

test('the scan result wins when it provided the full LAN info', () => {
  const raw = [{ id: 'dev1', ip: '10.1.0.50', protocol_version: '3.3', local_override: true }];
  const created = [
    createdDevice('dev1', [
      { name: DEVICE_PARAM_NAME.IP_ADDRESS, value: '10.1.0.99' },
      { name: DEVICE_PARAM_NAME.PROTOCOL_VERSION, value: '3.1' },
    ]),
  ];

  const [enriched] = enrichFromCreatedDevices(raw, created, true);
  // Fresh scan data is more current than the stored params.
  assert.equal(enriched.ip, '10.1.0.50');
  assert.equal(enriched.protocol_version, '3.3');
  assert.equal(enriched.local_override, true);
});

test('a partial scan result is completed from the stored params', () => {
  const raw = [{ id: 'dev1', ip: '10.1.0.50' }];
  const created = [
    createdDevice('dev1', [
      { name: DEVICE_PARAM_NAME.IP_ADDRESS, value: '10.1.0.99' },
      { name: DEVICE_PARAM_NAME.PROTOCOL_VERSION, value: '3.3' },
    ]),
  ];

  const [enriched] = enrichFromCreatedDevices(raw, created, true);
  assert.equal(enriched.ip, '10.1.0.50', 'the fresh ip wins');
  assert.equal(enriched.protocol_version, '3.3', 'the missing protocol is preserved');
  assert.equal(enriched.local_override, true);
});

test('local preference off preserves the LAN info but keeps the device on the cloud', () => {
  const raw = [{ id: 'dev1' }];
  const created = [
    createdDevice('dev1', [
      { name: DEVICE_PARAM_NAME.IP_ADDRESS, value: '10.1.0.189' },
      { name: DEVICE_PARAM_NAME.PROTOCOL_VERSION, value: '3.5' },
    ]),
  ];

  const [enriched] = enrichFromCreatedDevices(raw, created, false);
  // The data is never lost...
  assert.equal(enriched.ip, '10.1.0.189');
  assert.equal(enriched.protocol_version, '3.5');
  // ...but the device follows the cloud preference.
  assert.equal(enriched.local_override, false);
});

test('unknown or complete devices pass through untouched', () => {
  const raw = [{ id: 'unknown-dev' }, { id: 'dev2', name: 'No LAN info anywhere' }];
  const created = [createdDevice('dev2', [])];

  const enriched = enrichFromCreatedDevices(raw, created, true);
  assert.deepEqual(enriched, raw);
});
