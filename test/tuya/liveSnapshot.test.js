import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';

import { createTuyaIntegration } from '../../src/app.js';
import { STATUS } from '../../src/tuya/constants.js';
import {
  captureFrame,
  captureLiveSnapshot,
  isSnapshotRefreshDue,
  refreshCameraSnapshot,
} from '../../src/tuya/media/tuya.liveSnapshot.js';

// A camera snapshot from the live RTSPS stream (allocate + one ffmpeg frame),
// for the PTZ cameras of @GBoulvin whose event pictures are encrypted.

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9]);
const IMAGE = `image/jpg;base64,${JPEG.toString('base64')}`;
const STREAM_URL = 'rtsps://eu.tuya.example:443/v1/proxy/echo_show/token123';

const CAMERA = {
  external_id: 'ext:tuya:device:cam1',
  selector: 'camera-entree',
  name: 'Caméra entrée',
  features: [{ external_id: 'ext:tuya:device:cam1:image', category: 'camera', type: 'image' }],
  params: [
    { name: 'DEVICE_ID', value: 'cam1' },
    { name: 'DEVICE_TYPE', value: 'camera' },
  ],
};

// A spawn() double: emits the given stdout / stderr / exit code.
function fakeSpawn({ stdout = JPEG, stderr = '', code = 0, hang = false, error = null } = {}) {
  const calls = [];
  const spawn = (command, args) => {
    calls.push({ command, args });
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.killed = false;
    child.kill = () => {
      child.killed = true;
    };
    setImmediate(() => {
      if (error) {
        child.emit('error', error);
        return;
      }
      if (hang) {
        return;
      }
      if (stdout.length > 0) {
        child.stdout.emit('data', stdout);
      }
      if (stderr) {
        child.stderr.emit('data', Buffer.from(stderr));
      }
      child.emit('close', code);
    });
    return child;
  };
  return { spawn, calls };
}

function createHandler({ allocate = { success: true, result: { url: STREAM_URL } }, frame } = {}) {
  const requests = [];
  const published = [];
  const handler = {
    status: STATUS.CONNECTED,
    connector: {
      request: async (req) => {
        requests.push(req);
        if (allocate instanceof Error) {
          throw allocate;
        }
        return allocate;
      },
    },
    gladys: {
      publishCameraImage: async (externalId, image) => published.push({ externalId, image }),
    },
    captureFrame: frame || (async () => JPEG),
  };
  return { handler, requests, published };
}

test('captureFrame reads one JPEG frame from the stream with ffmpeg, over TCP, on stdout', async () => {
  const { spawn, calls } = fakeSpawn();
  const frame = await captureFrame(STREAM_URL, { spawn });
  assert.deepEqual(frame, JPEG);
  assert.equal(calls[0].command, 'ffmpeg');
  const { args } = calls[0];
  assert.equal(args[args.indexOf('-i') + 1], STREAM_URL);
  assert.equal(args[args.indexOf('-rtsp_transport') + 1], 'tcp');
  assert.equal(args[args.indexOf('-frames:v') + 1], '1');
  assert.equal(args.at(-1), 'pipe:1');
});

test('captureFrame: a failing ffmpeg never leaks the stream token in its error', async () => {
  const { spawn } = fakeSpawn({
    stdout: Buffer.alloc(0),
    stderr: `${STREAM_URL}: Connection refused`,
    code: 1,
  });
  await assert.rejects(captureFrame(STREAM_URL, { spawn }), (err) => {
    assert.match(err.message, /code 1: <stream> Connection refused/);
    assert.doesNotMatch(err.message, /token123/);
    return true;
  });
});

test('captureFrame: a stream that never sends a frame is killed at the timeout', async () => {
  const { spawn } = fakeSpawn({ hang: true });
  await assert.rejects(captureFrame(STREAM_URL, { spawn, timeoutMs: 20 }), /no frame within 20 ms/);
});

test('captureFrame: a missing ffmpeg binary is reported as such', async () => {
  const error = Object.assign(new Error('spawn ffmpeg ENOENT'), { code: 'ENOENT' });
  const { spawn } = fakeSpawn({ error });
  await assert.rejects(captureFrame(STREAM_URL, { spawn }), /ffmpeg is not installed/);
});

test('captureLiveSnapshot allocates an RTSP stream and returns the frame as a camera image', async () => {
  const { handler, requests } = createHandler();
  const image = await captureLiveSnapshot(handler, CAMERA.external_id, 'cam1');
  assert.equal(image, IMAGE);
  assert.deepEqual(requests, [
    {
      method: 'POST',
      path: '/v1.0/devices/cam1/stream/actions/allocate',
      body: { type: 'rtsp' },
    },
  ]);
});

test('captureLiveSnapshot: concurrent requests share one capture, a recent one is re-served', async () => {
  let captures = 0;
  const { handler, requests } = createHandler({
    frame: async () => {
      captures += 1;
      return JPEG;
    },
  });
  const images = await Promise.all([
    captureLiveSnapshot(handler, CAMERA.external_id, 'cam1'),
    captureLiveSnapshot(handler, CAMERA.external_id, 'cam1'),
  ]);
  assert.deepEqual(images, [IMAGE, IMAGE]);
  assert.equal(await captureLiveSnapshot(handler, CAMERA.external_id, 'cam1'), IMAGE);
  assert.equal(captures, 1);
  assert.equal(requests.length, 1);
});

test('captureLiveSnapshot: a refused stream backs off instead of retrying on every request', async () => {
  const { handler, requests } = createHandler({
    allocate: { success: false, code: 1106, msg: 'permission deny' },
  });
  assert.equal(await captureLiveSnapshot(handler, CAMERA.external_id, 'cam1'), null);
  assert.equal(await captureLiveSnapshot(handler, CAMERA.external_id, 'cam1'), null);
  assert.equal(requests.length, 1);
  assert.equal(isSnapshotRefreshDue(handler, CAMERA.external_id), false);
});

test('refreshCameraSnapshot publishes the frame as the camera image, once per capture', async () => {
  const { handler, published } = createHandler();
  assert.equal(isSnapshotRefreshDue(handler, CAMERA.external_id), true);
  assert.equal(await refreshCameraSnapshot(handler, CAMERA), IMAGE);
  // Re-served from the cache: not published a second time.
  assert.equal(await refreshCameraSnapshot(handler, CAMERA), IMAGE);
  assert.deepEqual(published, [{ externalId: CAMERA.external_id, image: IMAGE }]);
  assert.equal(handler.lastCameraImage[CAMERA.external_id], IMAGE);
  assert.equal(isSnapshotRefreshDue(handler, CAMERA.external_id), false);
});

// --- Wiring in src/app.js ---------------------------------------------------

const CONFIG = {
  endpoint: 'westernEurope',
  access_key: 'access',
  secret_key: 'secret',
  app_account_id: 'uid',
};

async function setupApp(tuyaOverrides = {}) {
  const gladys = createFakeGladys({ selector: 'tuya', config: CONFIG, devices: [CAMERA] });
  const polled = [];
  const tuya = {
    status: STATUS.NOT_INITIALIZED,
    config: null,
    discoveredDevices: [],
    gladys,
    async connect() {
      this.status = STATUS.CONNECTED;
    },
    async disconnect() {},
    startReconnect() {},
    async startPulsar() {},
    stopPulsar() {},
    async discoverDevices() {
      return [];
    },
    async localScan() {
      return { devices: {} };
    },
    async closeAllLocalSessions() {},
    async poll(device) {
      polled.push(device);
    },
    ...tuyaOverrides,
  };
  createTuyaIntegration(gladys, tuya);
  await gladys.connect();
  return { gladys, tuya, polled };
}

test('onGetImage serves a fresh frame of the live stream', async () => {
  const { gladys } = await setupApp({
    connector: { request: async () => ({ success: true, result: { url: STREAM_URL } }) },
    captureFrame: async () => JPEG,
  });
  const ack = await gladys.fake.getImage({ external_id: CAMERA.external_id });
  assert.equal(ack.success, true);
  assert.equal(ack.data.image, IMAGE);
});

test('onGetImage falls back to the last event snapshot when the stream cannot be read', async () => {
  const { gladys } = await setupApp({
    connector: { request: async () => ({ success: false, msg: 'permission deny' }) },
    lastCameraImage: { [CAMERA.external_id]: 'image/jpg;base64,EVENT' },
  });
  const ack = await gladys.fake.getImage({ external_id: CAMERA.external_id });
  assert.equal(ack.success, true);
  assert.equal(ack.data.image, 'image/jpg;base64,EVENT');
});

test('a camera poll refreshes the stored image in the background', async () => {
  let captures = 0;
  const { gladys, polled } = await setupApp({
    connector: { request: async () => ({ success: true, result: { url: STREAM_URL } }) },
    captureFrame: async () => {
      captures += 1;
      return JPEG;
    },
  });
  await gladys.fake.poll({ external_id: CAMERA.external_id });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(polled.length, 1);
  assert.equal(captures, 1);
  // The next poll, minutes earlier than the refresh period: no new capture.
  await gladys.fake.poll({ external_id: CAMERA.external_id });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(captures, 1);
});
