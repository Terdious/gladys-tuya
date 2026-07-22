import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';

import { TuyaHandler } from '../../src/tuya/handler.js';
import { convertDevice } from '../../src/tuya/device/tuya.convertDevice.js';
import { buildPulsarPassword, decryptPulsarData } from '../../src/tuya/cloud/tuya.pulsar.js';
import { DEVICE_PARAM_NAME } from '../../src/tuya/constants.js';
import { createFakeGladys } from '../helpers/fakeGladys.js';

const SECRET = 'anAccessSecretForTests0123456789';

// Encrypt a JSON document exactly as the Tuya message service does, so the
// decrypt path is exercised end to end.
const encryptGcm = (doc) => {
  const key = Buffer.from(SECRET.substring(8, 24), 'utf8');
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-128-gcm', key, nonce);
  const body = Buffer.concat([cipher.update(JSON.stringify(doc), 'utf8'), cipher.final()]);
  return Buffer.concat([nonce, body, cipher.getAuthTag()]).toString('base64');
};

const encryptEcb = (doc) => {
  const key = Buffer.from(SECRET.substring(8, 24), 'utf8');
  const cipher = crypto.createCipheriv('aes-128-ecb', key, null);
  return Buffer.concat([cipher.update(JSON.stringify(doc), 'utf8'), cipher.final()]).toString(
    'base64',
  );
};

test('buildPulsarPassword derives the 16-char SDK password deterministically', () => {
  const pwd = buildPulsarPassword('accessId', SECRET);
  assert.equal(pwd.length, 16);
  assert.equal(pwd, buildPulsarPassword('accessId', SECRET));
});

test('decryptPulsarData round-trips the AES-GCM and ECB models', () => {
  const doc = { devId: 'x', status: [{ code: 'switch_1', value: true }] };
  assert.deepEqual(decryptPulsarData(encryptGcm(doc), SECRET, 'aes_gcm'), doc);
  assert.deepEqual(decryptPulsarData(encryptEcb(doc), SECRET, undefined), doc);
});

test('decryptPulsarData returns null on garbage instead of throwing', () => {
  assert.equal(decryptPulsarData('not-base64-@@@', SECRET, 'aes_gcm'), null);
});

const AC_DEVICE = {
  id: 'pulsarac',
  name: 'Clim Salon',
  product_id: 'f3goccgfj6qino4c',
  local_key: 'lk',
  online: true,
  specifications: {
    category: 'kt',
    status: [
      { code: 'switch', type: 'Boolean', values: '{}' },
      {
        code: 'temp_set',
        type: 'Integer',
        values: '{"unit":"℃","min":160,"max":880,"scale":1,"step":10}',
      },
      { code: 'mode', type: 'Enum', values: '{"range":["auto","cold","wet","heat","fan"]}' },
    ],
    functions: [
      { code: 'switch', type: 'Boolean', values: '{}' },
      {
        code: 'temp_set',
        type: 'Integer',
        values: '{"unit":"℃","min":160,"max":880,"scale":1,"step":10}',
      },
      { code: 'mode', type: 'Enum', values: '{"range":["auto","cold","wet","heat","fan"]}' },
    ],
  },
  properties: {
    properties: [
      { code: 'Power', dp_id: 1, type: 'bool', value: true },
      { code: 'temp_set', dp_id: 2, type: 'value', value: 200 },
      { code: 'mode', dp_id: 4, type: 'enum', value: 'heat' },
    ],
  },
};

function createHandlerWithDevice() {
  const fake = createFakeGladys();
  const handler = new TuyaHandler(fake);
  const converted = convertDevice(fake, AC_DEVICE);
  const device = {
    external_id: converted.external_id,
    device_type: converted.device_type,
    features: converted.features,
    params: [{ name: DEVICE_PARAM_NAME.DEVICE_ID, value: 'pulsarac' }],
  };
  fake.devices.push(device);
  return { fake, handler };
}

test('handlePulsarEvent routes a legacy status report to the device features (scaled)', () => {
  const { fake, handler } = createHandlerWithDevice();
  handler.handlePulsarEvent({
    devId: 'pulsarac',
    status: [
      { code: 'temp_set', value: 240 },
      { code: 'mode', value: 'cold' },
    ],
  });

  const states = Object.fromEntries(fake.published.map((p) => [p.featureExternalId, p.state]));
  // Scale 1 restored from the mapping: 240 -> 24.0.
  assert.equal(states['ext:tuya:device:pulsarac:temp_set'], 24);
  assert.equal(states['ext:tuya:device:pulsarac:mode'], 1);
});

test('handlePulsarEvent routes the IoT-core devicePropertyMessage twin', () => {
  const { fake, handler } = createHandlerWithDevice();
  handler.handlePulsarEvent({
    bizCode: 'devicePropertyMessage',
    bizData: {
      devId: 'pulsarac',
      properties: [{ code: 'temp_set', value: 220 }],
    },
  });
  const states = Object.fromEntries(fake.published.map((p) => [p.featureExternalId, p.state]));
  assert.equal(states['ext:tuya:device:pulsarac:temp_set'], 22);
});

test('the twin-format duplicate report is routed only once', () => {
  const { fake, handler } = createHandlerWithDevice();
  // Same values arriving as protocol 4 then protocol 1000 within the window.
  handler.handlePulsarEvent({ devId: 'pulsarac', status: [{ code: 'temp_set', value: 250 }] });
  handler.handlePulsarEvent({
    bizCode: 'devicePropertyMessage',
    bizData: { devId: 'pulsarac', properties: [{ code: 'temp_set', value: 250 }] },
  });
  const tempStates = fake.published.filter(
    (p) => p.featureExternalId === 'ext:tuya:device:pulsarac:temp_set',
  );
  assert.equal(tempStates.length, 1);
});

test('handlePulsarEvent ignores a report for a device not in Gladys', () => {
  const { fake, handler } = createHandlerWithDevice();
  handler.handlePulsarEvent({
    devId: 'unknown-device',
    status: [{ code: 'temp_set', value: 240 }],
  });
  assert.equal(fake.published.length, 0);
});

test('startPulsar is a no-op when the toggle is off', async () => {
  const { handler } = createHandlerWithDevice();
  handler.config = { pulsarEnabled: false, accessKey: 'a', secretKey: SECRET };
  await handler.startPulsar();
  assert.equal(handler.pulsar.status, 'disabled');
});

test('startPulsar reports not_configured when enabled without credentials', async () => {
  const { handler } = createHandlerWithDevice();
  handler.config = { pulsarEnabled: true, accessKey: '', secretKey: '' };
  await handler.startPulsar();
  assert.equal(handler.pulsar.status, 'not_configured');
});
