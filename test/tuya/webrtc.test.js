import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { crc32 } from 'node:zlib';

import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';

import { createTuyaIntegration } from '../../src/app.js';
import { STATUS } from '../../src/tuya/constants.js';

import {
  buildBrowserAnswer,
  shapeOfferForTuya,
  splitSdp,
  getKind,
} from '../../src/tuya/camera/tuya.webrtcSdp.js';
import {
  buildWakeUpPayload,
  pickStreamType,
  startWebRtcSession,
  stopWebRtcSession,
  stopAllWebRtcSessions,
} from '../../src/tuya/camera/tuya.webrtc.js';

// A Chrome offer as the Gladys dashboard sends it (GladysAssistant/Gladys#3215):
// recvonly video then audio, every candidate inlined after the gathering.
const BROWSER_OFFER = [
  'v=0',
  'o=- 4611731400430051336 2 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'a=group:BUNDLE 0 1',
  'a=extmap-allow-mixed',
  'a=msid-semantic: WMS',
  'm=video 9 UDP/TLS/RTP/SAVPF 96 97 102 103 106 107 39',
  'c=IN IP4 0.0.0.0',
  'a=rtcp:9 IN IP4 0.0.0.0',
  'a=candidate:1 1 udp 2122260223 192.168.1.10 54321 typ host generation 0',
  'a=candidate:2 1 udp 1686052607 90.1.2.3 54321 typ srflx raddr 192.168.1.10 rport 54321',
  'a=ice-ufrag:abcd',
  'a=ice-pwd:0123456789abcdefghijklmn',
  'a=ice-options:trickle',
  'a=fingerprint:sha-256 AA:BB:CC',
  'a=setup:actpass',
  'a=mid:0',
  'a=extmap:1 urn:ietf:params:rtp-hdrext:toffset',
  'a=extmap:2 http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time',
  'a=recvonly',
  'a=rtcp-mux',
  'a=rtcp-rsize',
  'a=rtpmap:96 VP8/90000',
  'a=rtcp-fb:96 nack',
  'a=rtpmap:97 rtx/90000',
  'a=fmtp:97 apt=96',
  'a=rtpmap:102 H264/90000',
  'a=rtcp-fb:102 nack',
  'a=rtcp-fb:102 nack pli',
  'a=fmtp:102 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42001f',
  'a=rtpmap:103 rtx/90000',
  'a=fmtp:103 apt=102',
  'a=rtpmap:106 H264/90000',
  'a=fmtp:106 level-asymmetry-allowed=1;packetization-mode=0;profile-level-id=42001f',
  'a=rtpmap:107 rtx/90000',
  'a=fmtp:107 apt=106',
  'a=rtpmap:39 AV1/90000',
  'a=end-of-candidates',
  'm=audio 9 UDP/TLS/RTP/SAVPF 111 63 0 8 126',
  'c=IN IP4 0.0.0.0',
  'a=candidate:1 1 udp 2122260223 192.168.1.10 54321 typ host generation 0',
  'a=candidate:2 1 udp 1686052607 90.1.2.3 54321 typ srflx raddr 192.168.1.10 rport 54321',
  'a=ice-ufrag:abcd',
  'a=ice-pwd:0123456789abcdefghijklmn',
  'a=fingerprint:sha-256 AA:BB:CC',
  'a=setup:actpass',
  'a=mid:1',
  'a=extmap:14 urn:ietf:params:rtp-hdrext:ssrc-audio-level',
  'a=recvonly',
  'a=rtcp-mux',
  'a=rtpmap:111 opus/48000/2',
  'a=fmtp:111 minptime=10;useinbandfec=1',
  'a=rtpmap:63 red/48000/2',
  'a=rtpmap:0 PCMU/8000',
  'a=rtpmap:8 PCMA/8000',
  'a=rtpmap:126 telephone-event/8000',
  '',
].join('\r\n');

// The camera's answer to the shaped offer (audio first, as sent).
const CAMERA_ANSWER = [
  'v=0',
  'o=- 1 1 IN IP4 0.0.0.0',
  's=-',
  't=0 0',
  'a=group:BUNDLE 1 0',
  'm=audio 9 UDP/TLS/RTP/SAVPF 8',
  'c=IN IP4 0.0.0.0',
  'a=ice-ufrag:tuya',
  'a=ice-pwd:tuyapassword',
  'a=fingerprint:sha-256 DD:EE:FF',
  'a=setup:active',
  'a=mid:1',
  'a=sendonly',
  'a=rtcp-mux',
  'a=rtpmap:8 PCMA/8000',
  'm=video 9 UDP/TLS/RTP/SAVPF 102',
  'c=IN IP4 0.0.0.0',
  'a=ice-ufrag:tuya',
  'a=ice-pwd:tuyapassword',
  'a=fingerprint:sha-256 DD:EE:FF',
  'a=setup:active',
  'a=mid:0',
  'a=sendonly',
  'a=rtcp-mux',
  'a=rtpmap:102 H264/90000',
  'a=fmtp:102 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42001f',
  '',
].join('\r\n');

const TUYA_CANDIDATES = [
  'a=candidate:3 1 udp 2130706431 10.0.0.5 40000 typ host\r\n',
  'a=candidate:4 1 udp 16777215 47.1.2.3 3478 typ relay raddr 0.0.0.0 rport 0\r\n',
];

test('the offer sent to the camera: audio first, H264 + PCMA/PCMU only, no extmap nor candidate', () => {
  const shaped = shapeOfferForTuya(BROWSER_OFFER);
  const { session, media } = splitSdp(shaped.sdp);
  assert.deepEqual(media.map(getKind), ['audio', 'video']);
  assert.equal(media[0][0], 'm=audio 9 UDP/TLS/RTP/SAVPF 0 8');
  // H264 packetization-mode=1 only (the RTX, VP8, AV1 and mode 0 are dropped).
  assert.equal(media[1][0], 'm=video 9 UDP/TLS/RTP/SAVPF 102');
  assert.ok(media[1].includes('a=rtcp-fb:102 nack pli'));
  assert.ok(
    !media[1].some((line) => /^a=(rtpmap|fmtp|rtcp-fb):(96|97|103|106|107|39) /.test(line)),
  );
  assert.ok(!media[0].some((line) => /^a=rtpmap:(111|63|126) /.test(line)));
  const all = [...session, ...media.flat()];
  assert.ok(!all.some((line) => line.startsWith('a=extmap:')));
  assert.ok(!all.some((line) => line.startsWith('a=candidate:')));
  assert.ok(!all.includes('a=end-of-candidates'));
  // The ICE / DTLS identity of the browser is kept.
  assert.ok(media[1].includes('a=ice-ufrag:abcd'));
  assert.ok(media[1].includes('a=fingerprint:sha-256 AA:BB:CC'));
  // The browser's candidates, once each, to trickle.
  assert.deepEqual(shaped.candidates, [
    'candidate:1 1 udp 2122260223 192.168.1.10 54321 typ host generation 0',
    'candidate:2 1 udp 1686052607 90.1.2.3 54321 typ srflx raddr 192.168.1.10 rport 54321',
  ]);
  assert.deepEqual(shaped.mids, ['0', '1']);
  assert.deepEqual(shaped.sentMids, ['1', '0']);
  // Well under the camera's 8 KB message, with room for the ICE servers.
  assert.ok(shaped.sdp.length < 2500, `${shaped.sdp.length} bytes`);
  assert.ok(shaped.sdp.endsWith('\r\n'));
});

test('a browser offering no H264 is refused with a clear reason', () => {
  const vp8Only = BROWSER_OFFER.replace(/H264/g, 'VP9');
  assert.throws(() => shapeOfferForTuya(vp8Only), /no H264 video/);
});

test('the answer for the browser: its section order back, the camera candidates inlined', () => {
  const shaped = shapeOfferForTuya(BROWSER_OFFER);
  const candidates = TUYA_CANDIDATES.map((c) => c.trim().replace(/^a=/, ''));
  const answer = buildBrowserAnswer(CAMERA_ANSWER, candidates, shaped.mids, shaped.sentMids);
  const { media } = splitSdp(answer);
  assert.deepEqual(media.map(getKind), ['video', 'audio']);
  for (const section of media) {
    assert.deepEqual(
      section.filter((line) => line.startsWith('a=candidate:')),
      [
        'a=candidate:3 1 udp 2130706431 10.0.0.5 40000 typ host',
        'a=candidate:4 1 udp 16777215 47.1.2.3 3478 typ relay raddr 0.0.0.0 rport 0',
      ],
    );
    assert.equal(section.at(-1), 'a=end-of-candidates');
  }
});

test('stream choice: the best H264 stream, HEVC-only cameras refused', () => {
  assert.equal(pickStreamType({}), 0);
  assert.equal(
    pickStreamType({
      videos: [
        { streamType: 2, codecType: 2, width: 1920, height: 1080 },
        { streamType: 4, codecType: 2, width: 640, height: 360 },
      ],
    }),
    0,
  );
  // HD in HEVC, SD in H264: the SD stream.
  assert.equal(
    pickStreamType({
      videos: [
        { streamType: 2, codecType: 4, width: 2304, height: 1296 },
        { streamType: 4, codecType: 2, width: 640, height: 360 },
      ],
    }),
    1,
  );
  assert.throws(
    () => pickStreamType({ videos: [{ streamType: 2, codecType: 4, width: 1, height: 1 }] }),
    /HEVC/,
  );
});

test('the wake-up of a battery camera is the CRC32 of its local key, big-endian', () => {
  const payload = buildWakeUpPayload('0123456789abcdef');
  assert.equal(payload.length, 4);
  assert.equal(payload.readUInt32BE(), crc32(Buffer.from('0123456789abcdef')) >>> 0);
});

// --- Signalling over a fake Tuya MQTT broker ---------------------------------

const DEVICE = {
  external_id: 'ext:tuya:device:cam1',
  params: [{ name: 'DEVICE_ID', value: 'cam1' }],
};
const WEBRTC_CONFIG = {
  moto_id: 'moto_eu_1',
  auth: 'auth-token',
  supports_webrtc: true,
  local_key: 'lk',
  p2p_config: { ices: [{ urls: 'turn:turn.tuya.example:3478', username: 'u', credential: 'p' }] },
  skill: JSON.stringify({
    webrtc: 3,
    videos: [{ streamType: 2, codecType: 2, width: 1920, height: 1080 }],
  }),
};
const HUB_CONFIG = {
  url: 'ssl://m1.tuyaeu.com:8883',
  client_id: 'client',
  username: 'user',
  password: 'pass',
  sink_topic: { ipc: '/av/moto/moto_id/u/{device_id}' },
  source_topic: { ipc: '/av/u/user-uid-1' },
};

// Plays the camera: answers the offer, then trickles its candidates.
function createFakeCamera({ answer = true, configOverrides = {} } = {}) {
  const published = [];
  const connections = [];
  const requests = [];
  const handler = {
    config: { appAccountId: 'uid-1' },
    connector: {
      request: async (req) => {
        requests.push(req);
        if (req.path.endsWith('/webrtc-configs')) {
          return { success: true, result: { ...WEBRTC_CONFIG, ...configOverrides } };
        }
        return { success: true, result: HUB_CONFIG };
      },
    },
    connectMqtt: async (url, options) => {
      const client = new EventEmitter();
      connections.push({ url, options, client });
      client.subscribeAsync = async () => {};
      client.endAsync = async () => {
        client.ended = true;
      };
      client.publishAsync = async (topic, payload) => {
        const message = Buffer.isBuffer(payload) ? payload : JSON.parse(payload);
        published.push({ topic, message });
        if (!answer || Buffer.isBuffer(payload) || message.data.header.type !== 'offer') {
          return;
        }
        const reply = (type, msg) =>
          client.emit(
            'message',
            HUB_CONFIG.source_topic.ipc,
            Buffer.from(
              JSON.stringify({
                protocol: 302,
                data: { header: { type, sessionid: message.data.header.sessionid }, msg },
              }),
            ),
          );
        setTimeout(() => {
          // Another session's frame is ignored.
          client.emit(
            'message',
            HUB_CONFIG.source_topic.ipc,
            Buffer.from(JSON.stringify({ data: { header: { type: 'answer', sessionid: 'x' } } })),
          );
          reply('answer', { mode: 'webrtc', sdp: CAMERA_ANSWER });
          TUYA_CANDIDATES.forEach((candidate, i) =>
            setTimeout(() => reply('candidate', { mode: 'webrtc', candidate }), 5 * (i + 1)),
          );
        }, 5);
      };
      return client;
    },
  };
  return { handler, published, connections, requests };
}

test('a live view: offer and candidates sent to the camera, its answer returned complete', async () => {
  const { handler, published, connections, requests } = createFakeCamera();
  const result = await startWebRtcSession(handler, DEVICE, {
    sessionId: 'gladys-session-1',
    sdp: BROWSER_OFFER,
  });

  assert.deepEqual(
    requests.map((r) => `${r.method} ${r.path}`),
    ['GET /v1.0/users/uid-1/devices/cam1/webrtc-configs', 'POST /v2.0/open-iot-hub/access/config'],
  );
  assert.equal(requests[1].body.uid, 'uid-1');
  assert.equal(requests[1].body.link_type, 'mqtt');
  assert.equal(connections[0].url, HUB_CONFIG.url);
  assert.equal(connections[0].options.username, 'user');

  const [offer, ...candidates] = published;
  assert.equal(offer.topic, '/av/moto/moto_eu_1/u/cam1');
  assert.equal(offer.message.protocol, 302);
  assert.deepEqual(
    {
      type: offer.message.data.header.type,
      from: offer.message.data.header.from,
      to: offer.message.data.header.to,
      moto_id: offer.message.data.header.moto_id,
    },
    { type: 'offer', from: 'user-uid-1', to: 'cam1', moto_id: 'moto_eu_1' },
  );
  assert.equal(offer.message.data.msg.stream_type, 0);
  assert.equal(offer.message.data.msg.auth, 'auth-token');
  assert.equal(offer.message.data.msg.datachannel_enable, false);
  assert.deepEqual(offer.message.data.msg.token, WEBRTC_CONFIG.p2p_config.ices);
  assert.ok(offer.message.data.msg.sdp.startsWith('v=0'));
  assert.ok(JSON.stringify(offer.message).length < 8 * 1024);
  assert.deepEqual(
    candidates.map(({ message }) => [message.data.header.type, message.data.msg.candidate]),
    [
      ['candidate', 'a=candidate:1 1 udp 2122260223 192.168.1.10 54321 typ host generation 0'],
      [
        'candidate',
        'a=candidate:2 1 udp 1686052607 90.1.2.3 54321 typ srflx raddr 192.168.1.10 rport 54321',
      ],
    ],
  );

  assert.equal(result.sessionId, 'gladys-session-1');
  assert.equal(result.streamId, offer.message.data.header.sessionid);
  const { media } = splitSdp(result.sdpAnswer);
  assert.deepEqual(media.map(getKind), ['video', 'audio']);
  assert.equal(media[0].filter((line) => line.startsWith('a=candidate:')).length, 2);

  // Stop: "disconnect" frame, MQTT closed; a second stop is a no-op.
  await stopWebRtcSession(handler, DEVICE, { sessionId: 'gladys-session-1' });
  assert.equal(published.at(-1).message.data.header.type, 'disconnect');
  assert.equal(connections[0].client.ended, true);
  const count = published.length;
  await stopWebRtcSession(handler, DEVICE, { sessionId: 'gladys-session-1' });
  assert.equal(published.length, count);
});

test('a camera that never answers: the offer fails within the budget and the session is closed', async (t) => {
  const { handler, published, connections } = createFakeCamera({ answer: false });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = startWebRtcSession(handler, DEVICE, { sessionId: 's2', sdp: BROWSER_OFFER });
  // Let the API calls and the MQTT connection resolve, then run out the budget.
  for (let i = 0; i < 20; i += 1) {
    await Promise.resolve();
  }
  t.mock.timers.tick(13000);
  await assert.rejects(pending, /no answer from the camera/);
  assert.equal(published.at(-1).message.data.header.type, 'disconnect');
  assert.equal(connections[0].client.ended, true);
});

test('a battery camera is woken before the offer', async () => {
  const { handler, published } = createFakeCamera({
    configOverrides: { skill: JSON.stringify({ lowPower: 1, videos: [] }) },
  });
  await startWebRtcSession(handler, DEVICE, { sessionId: 's3', sdp: BROWSER_OFFER });
  assert.equal(published[0].topic, 'm/w/cam1');
  assert.deepEqual(published[0].message, buildWakeUpPayload('lk'));
  assert.equal(published[1].message.data.header.type, 'offer');
  await stopAllWebRtcSessions(handler);
});

test('a camera without WebRTC support is refused before any MQTT connection', async () => {
  const { handler, connections } = createFakeCamera({
    configOverrides: { supports_webrtc: false },
  });
  await assert.rejects(
    startWebRtcSession(handler, DEVICE, { sessionId: 's4', sdp: BROWSER_OFFER }),
    /does not support WebRTC/,
  );
  assert.equal(connections.length, 0);
});

// --- Wiring in src/app.js ----------------------------------------------------

const RAW_CAMERA = {
  id: 'cam1',
  name: 'Caméra entrée',
  product_id: 'rogprwflblumx2co',
  local_key: 'lk',
  online: true,
  specifications: {
    category: 'sp',
    functions: [{ code: 'basic_private', type: 'Boolean', values: '{}' }],
    status: [{ code: 'basic_private', type: 'Boolean', values: '{}' }],
  },
};
const RAW_SOCKET = {
  id: 'dev1',
  name: 'Prise salon',
  product_id: 'p-dev1',
  local_key: 'lk1',
  online: true,
  specifications: {
    category: 'cz',
    functions: [{ code: 'switch_1', type: 'Boolean', values: '{}' }],
    status: [{ code: 'switch_1', type: 'Boolean', values: '{}' }],
  },
};

async function setupApp({ withSdkWebRtc = true, rejectWebRtcParam = false } = {}) {
  const gladys = createFakeGladys({
    selector: 'tuya',
    config: { endpoint: 'westernEurope', access_key: 'a', secret_key: 's', app_account_id: 'uid' },
  });
  const handlers = {};
  if (withSdkWebRtc) {
    // What the SDK release carrying GladysAssistant/integration-sdk-js#43 adds.
    gladys.onCameraWebRtcOffer = (cb) => {
      handlers.offer = cb;
    };
    gladys.onCameraWebRtcStop = (cb) => {
      handlers.stop = cb;
    };
  }
  const publishes = [];
  const publish = gladys.publishDiscoveredDevices.bind(gladys);
  gladys.publishDiscoveredDevices = async (devices) => {
    publishes.push(devices);
    const declares = devices.some((d) =>
      d.params.some((p) => p.name === 'GLADYS_CAMERA_STREAM_PROTOCOL'),
    );
    if (rejectWebRtcParam && declares) {
      throw new Error(
        'devices[0].params[3].name: GLADYS_* names are reserved (GLADYS_CAMERA_STREAM_PROTOCOL)',
      );
    }
    return publish(devices);
  };
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
      return [{ ...RAW_CAMERA }, { ...RAW_SOCKET }];
    },
    async localScan() {
      return { devices: {} };
    },
    async closeAllLocalSessions() {},
    async poll() {},
  };
  createTuyaIntegration(gladys, tuya);
  await gladys.connect();
  return { gladys, publishes, handlers, tuya };
}

const streamProtocol = (device) =>
  (device.params.find((p) => p.name === 'GLADYS_CAMERA_STREAM_PROTOCOL') || {}).value;

test('with an SDK relaying the offers, cameras declare the WebRTC live view (only them)', async () => {
  const { publishes, handlers } = await setupApp();
  const [camera, socket] = publishes.at(-1);
  assert.equal(streamProtocol(camera), 'webrtc');
  assert.equal(streamProtocol(socket), undefined);
  assert.equal(typeof handlers.offer, 'function');
  assert.equal(typeof handlers.stop, 'function');
});

test('an SDK without the WebRTC handlers: no param, nothing registered (current SDK)', async () => {
  const { publishes, handlers } = await setupApp({ withSdkWebRtc: false });
  assert.equal(publishes.length, 1);
  assert.equal(streamProtocol(publishes[0][0]), undefined);
  assert.deepEqual(handlers, {});
});

test('a core refusing the param: the list is republished without it, and not offered again', async () => {
  const { gladys, publishes } = await setupApp({ rejectWebRtcParam: true });
  assert.equal(publishes.length, 2);
  assert.equal(streamProtocol(publishes[0][0]), 'webrtc');
  assert.equal(streamProtocol(publishes[1][0]), undefined);
  assert.equal(gladys.fake.discoveredDevices.length, 2);
  // The next scan on the same core does not try again.
  await gladys.fake.scanRequest();
  assert.equal(publishes.length, 3);
  assert.equal(streamProtocol(publishes[2][0]), undefined);
});

test('a broker error never crashes the process, a closed connection forgets the session', async () => {
  const { handler, connections } = createFakeCamera();
  await startWebRtcSession(handler, DEVICE, { sessionId: 's5', sdp: BROWSER_OFFER });
  const { client } = connections[0];
  client.emit('error', new Error('connection reset'));
  assert.equal(handler.webRtcSessions.has('s5'), true);
  client.emit('close');
  assert.equal(handler.webRtcSessions.has('s5'), false);
});
