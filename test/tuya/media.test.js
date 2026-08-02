import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  decodeMediaPayload,
  encodeUnderLimit,
  getMediaFingerprint,
  extractMediaValuesFromCodes,
  extractMediaValuesFromDps,
  processMediaCodes,
  getLastCameraImage,
  MEDIA_CODES,
} from '../../src/tuya/media/tuya.media.js';

const b64 = (value) => Buffer.from(value, 'utf8').toString('base64');

// --- decodeMediaPayload -------------------------------------------------------

test('decodeMediaPayload decodes a direct presigned URL', () => {
  const media = decodeMediaPayload(
    b64('https://ty-eu-storage30-pic.s3.eu-central-1.amazonaws.com/x.jpg?sig=1'),
  );
  assert.deepEqual(media, {
    directUrl: 'https://ty-eu-storage30-pic.s3.eu-central-1.amazonaws.com/x.jpg?sig=1',
  });
});

test('decodeMediaPayload decodes an unencrypted bucket/files payload', () => {
  const media = decodeMediaPayload(
    b64(
      JSON.stringify({
        bucket: 'ty-eu-storage30-pic',
        files: [['/detect/1.jpeg?param=z', '']],
        v: '3.0',
      }),
    ),
  );
  assert.deepEqual(media, {
    bucket: 'ty-eu-storage30-pic',
    filePath: '/detect/1.jpeg?param=z',
    encryptionKey: '',
    version: '3.0',
  });
});

test('decodeMediaPayload keeps the AES key of an encrypted payload', () => {
  const media = decodeMediaPayload(
    b64(JSON.stringify({ bucket: 'b', files: [['/detect/1.jpeg', 'f9bf4643af4ad44a']], v: '3.0' })),
  );
  assert.equal(media.encryptionKey, 'f9bf4643af4ad44a');
});

test('decodeMediaPayload returns null on garbage / non-string', () => {
  assert.equal(decodeMediaPayload(b64('not json and not a url')), null);
  assert.equal(decodeMediaPayload(''), null);
  assert.equal(decodeMediaPayload(null), null);
});

// --- encodeUnderLimit ---------------------------------------------------------

test('encodeUnderLimit wraps a small buffer as an image/jpg base64 string', () => {
  const image = encodeUnderLimit(Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  assert.ok(image.startsWith('image/jpg;base64,'));
  assert.equal(Buffer.from(image.replace('image/jpg;base64,', ''), 'base64').length, 4);
});

test('encodeUnderLimit rejects an empty or non-buffer input', () => {
  assert.equal(encodeUnderLimit(Buffer.alloc(0)), null);
  assert.equal(encodeUnderLimit('not a buffer'), null);
});

// --- fingerprint / extraction -------------------------------------------------

test('getMediaFingerprint reduces both payload shapes to the image path', () => {
  assert.equal(
    getMediaFingerprint(b64('https://host/1760/detect/1.jpeg?X-Amz-Signature=abc')),
    '/1760/detect/1.jpeg',
  );
  assert.equal(
    getMediaFingerprint(
      b64(JSON.stringify({ bucket: 'b', files: [['/detect/1.jpeg?param=z', '']], v: '3.0' })),
    ),
    '/detect/1.jpeg',
  );
});

test('extractMediaValuesFromCodes keeps only the media codes', () => {
  assert.deepEqual(extractMediaValuesFromCodes({ doorbell_pic: 'a', motion_switch: true }), {
    doorbell_pic: 'a',
  });
  assert.deepEqual(extractMediaValuesFromCodes(null), {});
});

test('extractMediaValuesFromDps maps the media DPS to their code', () => {
  assert.deepEqual(extractMediaValuesFromDps({ 154: 'a', 1: true }), { doorbell_pic: 'a' });
  assert.deepEqual(extractMediaValuesFromDps({ 115: 'x' }), { movement_detect_pic: 'x' });
});

test('MEDIA_CODES lists both snapshot codes', () => {
  assert.deepEqual([...MEDIA_CODES].sort(), ['doorbell_pic', 'movement_detect_pic']);
});

// --- processMediaCodes (ring gating) -----------------------------------------

const makeDoorbell = (calls) => ({
  gladys: {
    publishState: (externalId, value) => {
      calls.push([externalId, value]);
      return Promise.resolve();
    },
  },
  eventDpMemory: {},
});

const doorbellDevice = {
  external_id: 'ext:tuya:device:d1',
  // No camera feature here → the media download path is not exercised (no network).
  features: [{ external_id: 'ext:tuya:device:d1:doorbell_active', category: 'doorbell' }],
};

test('processMediaCodes seeds memory on the first snapshot, no ring', () => {
  const calls = [];
  const self = makeDoorbell(calls);
  processMediaCodes(self, doorbellDevice, { doorbell_pic: b64('https://host/a/1.jpeg?sig=1') });
  assert.equal(calls.length, 0);
});

test('processMediaCodes pulses the doorbell ring (1 -> 0) on a NEW snapshot', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const calls = [];
  const self = makeDoorbell(calls);
  processMediaCodes(self, doorbellDevice, { doorbell_pic: b64('https://host/a/1.jpeg?sig=1') });
  processMediaCodes(self, doorbellDevice, { doorbell_pic: b64('https://host/a/2.jpeg?sig=2') });
  assert.deepEqual(calls, [['ext:tuya:device:d1:doorbell_active', 1]]);
  // Auto-clear re-arms the ring for the next press.
  t.mock.timers.tick(30 * 1000);
  assert.deepEqual(calls, [
    ['ext:tuya:device:d1:doorbell_active', 1],
    ['ext:tuya:device:d1:doorbell_active', 0],
  ]);
});

test('processMediaCodes keeps the single click for a legacy BUTTON doorbell', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const calls = [];
  const self = makeDoorbell(calls);
  // Device discovered before the first-class DOORBELL category shipped.
  const legacyDevice = {
    external_id: 'ext:tuya:device:old1',
    features: [{ external_id: 'ext:tuya:device:old1:doorbell_active', category: 'button' }],
  };
  processMediaCodes(self, legacyDevice, { doorbell_pic: b64('https://host/a/1.jpeg?sig=1') });
  processMediaCodes(self, legacyDevice, { doorbell_pic: b64('https://host/a/2.jpeg?sig=2') });
  t.mock.timers.tick(60 * 1000);
  // One click, never auto-cleared (a button click is already a one-shot).
  assert.deepEqual(calls, [['ext:tuya:device:old1:doorbell_active', 1]]);
});

test('processMediaCodes does not ring twice for the same image', () => {
  const calls = [];
  const self = makeDoorbell(calls);
  const same = b64('https://host/a/1.jpeg?sig=1');
  const sameOtherSig = b64('https://host/a/1.jpeg?sig=DIFFERENT');
  processMediaCodes(self, doorbellDevice, { doorbell_pic: same });
  // Same underlying path, different signature → same fingerprint → no ring.
  processMediaCodes(self, doorbellDevice, { doorbell_pic: sameOtherSig });
  assert.equal(calls.length, 0);
});

test('processMediaCodes is a no-op for a device without camera nor doorbell feature', () => {
  const calls = [];
  const self = makeDoorbell(calls);
  const plainDevice = {
    external_id: 'ext:tuya:device:x',
    features: [{ external_id: 'x:switch', category: 'switch' }],
  };
  processMediaCodes(self, plainDevice, { doorbell_pic: b64('https://host/a/1.jpeg?sig=1') });
  assert.equal(calls.length, 0);
});

test('processMediaCodes pulses the motion sensor (1 -> 0) on a NEW movement_detect_pic', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const calls = [];
  const self = makeDoorbell(calls);
  const cameraDevice = {
    external_id: 'ext:tuya:device:cam1',
    // Motion sensor but no camera-image feature → no download path (no network).
    features: [
      { external_id: 'ext:tuya:device:cam1:movement_detect_pic', category: 'motion-sensor' },
    ],
  };
  const enc = (path) =>
    b64(JSON.stringify({ bucket: 'b', files: [[`${path}?param=z`, 'aeskey']], v: '3.0' }));
  processMediaCodes(self, cameraDevice, { movement_detect_pic: enc('/detect/1.jpeg') });
  processMediaCodes(self, cameraDevice, { movement_detect_pic: enc('/detect/2.jpeg') });
  // Immediate detection edge.
  assert.deepEqual(calls, [['ext:tuya:device:cam1:movement_detect_pic', 1]]);
  // Auto-clear a short while later, re-arming the sensor for the next detection.
  t.mock.timers.tick(30 * 1000);
  assert.deepEqual(calls, [
    ['ext:tuya:device:cam1:movement_detect_pic', 1],
    ['ext:tuya:device:cam1:movement_detect_pic', 0],
  ]);
});

// --- getLastCameraImage -------------------------------------------------------

test('getLastCameraImage returns the stored image or null', () => {
  assert.equal(getLastCameraImage({}, 'ext:tuya:device:d1'), null);
  const self = { lastCameraImage: { 'ext:tuya:device:d1': 'image/jpg;base64,AAAA' } };
  assert.equal(getLastCameraImage(self, 'ext:tuya:device:d1'), 'image/jpg;base64,AAAA');
  assert.equal(getLastCameraImage(self, 'ext:tuya:device:other'), null);
});
