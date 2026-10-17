// -----------------------------------------------------------------------------
// WebRTC live view of a Tuya camera (issue #73).
//
// Gladys (GladysAssistant/Gladys#3215) negotiates the live view in the
// browser and relays the SDP offer / answer to the integration
// (onCameraWebRtcOffer / onCameraWebRtcStop); the media then flows from the
// Tuya cloud to the browser, never through Gladys nor this container.
//
// Tuya side, the flow of go2rtc (pkg/tuya) and tuya/webrtc-demo-go:
//   1. GET  /v1.0/users/{uid}/devices/{id}/webrtc-configs -> moto_id, auth,
//      the camera's TURN/STUN servers (p2p_config.ices), its skill (codecs,
//      streams, low power), its local key;
//   2. POST /v2.0/open-iot-hub/access/config -> the MQTT broker, credentials
//      and the ipc topics (publish to the camera, subscribe to its replies);
//   3. MQTT: an "offer" frame (protocol 302) with the SDP, the stream (HD/SD),
//      auth and the ICE servers, then one "candidate" frame per browser
//      candidate; the camera replies "answer", then trickles its candidates;
//   4. a "disconnect" frame ends the stream.
// A battery camera is woken first (CRC32 of its local key on m/w/{id}).
// -----------------------------------------------------------------------------

import { randomBytes, randomUUID } from 'node:crypto';
import { crc32 } from 'node:zlib';
import { createLogger } from '@gladysassistant/integration-sdk';

import { getTuyaDeviceId } from '../utils/tuya.externalId.js';
import { buildBrowserAnswer, normalizeTuyaCandidate, shapeOfferForTuya } from './tuya.webrtcSdp.js';

const logger = createLogger({ name: 'tuya' });

// The whole negotiation must fit in the core's 15 s offer deadline.
export const NEGOTIATION_BUDGET_MS = 12 * 1000;
// After the answer, the camera trickles its candidates within a few hundred
// ms: wait for this quiet window after the last one (or the budget end).
export const CANDIDATE_QUIET_MS = 1000;
// Safety net: a session the core never stopped is closed after this.
export const SESSION_MAX_MS = 60 * 60 * 1000;

const SIGNALLING_PROTOCOL = 302;
const SIGNALLING_VERSION = '2.2';
// Skill codes (go2rtc interface.go).
const SKILL_STREAM_HD = 2;
const SKILL_STREAM_SD = 4;
const SKILL_CODEC_HEVC = 4;

const request = async (self, options) => {
  if (!self.connector || typeof self.connector.request !== 'function') {
    throw new Error('Tuya cloud not connected');
  }
  const response = await self.connector.request(options);
  if (!response || response.success === false || !response.result) {
    const reason = (response && (response.msg || response.code)) || 'empty response';
    throw new Error(`${options.path.split('/').slice(-2).join('/')} refused: ${reason}`);
  }
  return response.result;
};

const parseSkill = (raw) => {
  if (raw && typeof raw === 'object') {
    return raw;
  }
  try {
    return JSON.parse(raw || '{}');
  } catch {
    return {};
  }
};

/**
 * @description The stream to ask for: the best H264 stream the camera
 * declares (a browser cannot play the HEVC streams, which Tuya only sends
 * over a data channel). Skill stream 2 (HD) -> 0, 4 (SD) -> 1.
 * @param {object} skill - The camera skill.
 * @returns {number} The MQTT stream_type.
 * @example
 * pickStreamType({ videos: [{ streamType: 2, codecType: 2, width: 1920, height: 1080 }] });
 */
export const pickStreamType = (skill) => {
  const videos = Array.isArray(skill && skill.videos) ? skill.videos : [];
  if (videos.length === 0) {
    return 0;
  }
  const h264 = videos
    .filter((video) => video.codecType !== SKILL_CODEC_HEVC)
    .sort((a, b) => (b.width || 0) * (b.height || 0) - (a.width || 0) * (a.height || 0));
  if (h264.length === 0) {
    throw new Error('this camera only streams HEVC (H.265), which browsers cannot play');
  }
  if (h264[0].streamType === SKILL_STREAM_SD) {
    return 1;
  }
  return h264[0].streamType === SKILL_STREAM_HD ? 0 : 1;
};

// CRC32 of the local key, as 4 big-endian bytes (go2rtc mqtt.go WakeUp).
export const buildWakeUpPayload = (localKey) => {
  const payload = Buffer.alloc(4);
  payload.writeUInt32BE(crc32(Buffer.from(String(localKey || ''))) >>> 0);
  return payload;
};

const defaultConnectMqtt = async (url, options) => {
  const { connectAsync } = await import('mqtt');
  return connectAsync(url, options);
};

const withTimeout = (promise, ms, message) => {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
};

const getSessions = (self) => {
  if (!self.webRtcSessions) {
    self.webRtcSessions = new Map();
  }
  return self.webRtcSessions;
};

const closeSession = async (self, key, { notifyCamera }) => {
  const sessions = getSessions(self);
  const session = sessions.get(key);
  if (!session) {
    return;
  }
  sessions.delete(key);
  clearTimeout(session.maxTimer);
  try {
    if (notifyCamera) {
      await session.send('disconnect', { mode: 'webrtc' });
    }
  } catch (e) {
    logger.debug(`[Tuya][webrtc] disconnect frame failed: ${e.message}`);
  }
  try {
    await session.client.endAsync();
  } catch (e) {
    logger.debug(`[Tuya][webrtc] MQTT close failed: ${e.message}`);
  }
};

/**
 * @description Negotiate a WebRTC live view with a Tuya camera.
 * @param {object} self - The TuyaHandler instance.
 * @param {object} device - The Gladys device ({ external_id, params }).
 * @param {object} offer - `{ sessionId, sdp }` from Gladys.
 * @returns {Promise<{ sdpAnswer: string, sessionId: string, streamId: string }>}
 * The answer for the browser.
 * @example
 * const answer = await startWebRtcSession(handler, device, { sessionId, sdp });
 */
export const startWebRtcSession = async (self, device, { sessionId, sdp }) => {
  const startedAt = Date.now();
  const remaining = () => Math.max(0, NEGOTIATION_BUDGET_MS - (Date.now() - startedAt));
  const deviceId = getTuyaDeviceId(device);
  const uid = self.config && self.config.appAccountId;
  if (!uid) {
    throw new Error('Tuya app account UID missing in the configuration');
  }
  const shaped = shapeOfferForTuya(sdp);

  const config = await request(self, {
    method: 'GET',
    path: `/v1.0/users/${uid}/devices/${deviceId}/webrtc-configs`,
  });
  if (config.supports_webrtc === false) {
    throw new Error('this camera does not support WebRTC');
  }
  const skill = parseSkill(config.skill);
  const streamType = pickStreamType(skill);
  const hub = await request(self, {
    method: 'POST',
    path: '/v2.0/open-iot-hub/access/config',
    body: { uid, unique_id: randomUUID(), link_type: 'mqtt', topics: 'ipc' },
  });
  const sinkTopic = hub.sink_topic && hub.sink_topic.ipc;
  const sourceTopic = hub.source_topic && hub.source_topic.ipc;
  if (!hub.url || !sinkTopic || !sourceTopic) {
    throw new Error('incomplete MQTT access config');
  }
  const publishTopic = sinkTopic
    .replace('moto_id', config.moto_id)
    .replace('{device_id}', deviceId);
  // The account uid the camera replies to: 4th segment of the source topic.
  const from = sourceTopic.split('/')[3] || uid;
  const tuyaSessionId = randomBytes(6).toString('hex');

  const connect = self.connectMqtt || defaultConnectMqtt;
  const client = await withTimeout(
    connect(hub.url, {
      clientId: hub.client_id,
      username: hub.username,
      password: hub.password,
      reconnectPeriod: 0,
      connectTimeout: Math.min(5000, remaining()),
    }),
    remaining(),
    'MQTT broker unreachable',
  );

  const send = (type, msg) =>
    client.publishAsync(
      publishTopic,
      JSON.stringify({
        protocol: SIGNALLING_PROTOCOL,
        pv: SIGNALLING_VERSION,
        t: Math.floor(Date.now() / 1000),
        data: {
          header: {
            type,
            from,
            to: deviceId,
            sub_dev_id: '',
            sessionid: tuyaSessionId,
            moto_id: config.moto_id,
            tid: '',
          },
          msg,
        },
      }),
      { qos: 1 },
    );

  const key = String(sessionId || tuyaSessionId);
  // An 'error' event without a listener would crash the process.
  client.on('error', (e) => {
    logger.warn(`[Tuya][webrtc] MQTT error (device=${device.external_id}): ${e.message}`);
  });
  client.on('close', () => {
    const session = getSessions(self).get(key);
    if (session && session.client === client) {
      clearTimeout(session.maxTimer);
      getSessions(self).delete(key);
    }
  });
  try {
    let answerSdp = null;
    const candidates = [];
    let onAnswer;
    let onCandidate = () => {};
    let onDisconnect = () => {};
    const answered = new Promise((resolve, reject) => {
      onAnswer = resolve;
      onDisconnect = () => reject(new Error('the camera ended the session'));
    });
    // Awaited below; a disconnect before that must not surface as unhandled.
    answered.catch(() => {});
    client.on('message', (topic, payload) => {
      let message;
      try {
        message = JSON.parse(payload.toString());
      } catch {
        return;
      }
      const header = message && message.data && message.data.header;
      if (!header || header.sessionid !== tuyaSessionId) {
        return;
      }
      const msg = message.data.msg || {};
      if (header.type === 'answer' && typeof msg.sdp === 'string') {
        answerSdp = msg.sdp;
        onAnswer();
      } else if (header.type === 'candidate') {
        const candidate = normalizeTuyaCandidate(msg.candidate);
        if (candidate && !candidates.includes(candidate)) {
          candidates.push(candidate);
          onCandidate();
        }
      } else if (header.type === 'disconnect') {
        onDisconnect();
        closeSession(self, key, { notifyCamera: false });
      }
    });
    await client.subscribeAsync(sourceTopic, { qos: 1 });

    if (Number(skill.lowPower) > 0) {
      await client.publishAsync(`m/w/${deviceId}`, buildWakeUpPayload(config.local_key), {
        qos: 1,
      });
    }
    await send('offer', {
      mode: 'webrtc',
      sdp: shaped.sdp,
      stream_type: streamType,
      auth: config.auth,
      datachannel_enable: false,
      token: (config.p2p_config && config.p2p_config.ices) || [],
    });
    for (const candidate of shaped.candidates) {
      await send('candidate', { mode: 'webrtc', candidate: `a=${candidate}` });
    }

    await withTimeout(answered, remaining(), 'no answer from the camera');
    // Its candidates arrive right after the answer: wait for a quiet window.
    await new Promise((resolve) => {
      let quiet;
      const deadline = setTimeout(resolve, remaining());
      const rearm = () => {
        clearTimeout(quiet);
        quiet = setTimeout(() => {
          clearTimeout(deadline);
          resolve();
        }, CANDIDATE_QUIET_MS);
      };
      onCandidate = rearm;
      rearm();
    });

    const sdpAnswer = buildBrowserAnswer(answerSdp, candidates, shaped.mids, shaped.sentMids);
    const maxTimer = setTimeout(() => {
      closeSession(self, key, { notifyCamera: true });
    }, SESSION_MAX_MS);
    if (typeof maxTimer.unref === 'function') {
      maxTimer.unref();
    }
    getSessions(self).set(key, { client, send, maxTimer, externalId: device.external_id });
    logger.info(
      `[Tuya][webrtc] live view started (device=${device.external_id}, ${candidates.length} camera candidates, ${Date.now() - startedAt} ms)`,
    );
    return { sdpAnswer, sessionId: key, streamId: tuyaSessionId };
  } catch (e) {
    try {
      await send('disconnect', { mode: 'webrtc' });
    } catch {
      // the stream never started
    }
    await client.endAsync().catch(() => {});
    throw e;
  }
};

/**
 * @description End a WebRTC live view: "disconnect" frame to the camera, then
 * the MQTT connection is closed. Unknown sessions are ignored.
 * @param {object} self - The TuyaHandler instance.
 * @param {object} device - The Gladys device.
 * @param {object} ids - `{ sessionId, streamId }` returned by the offer.
 * @returns {Promise<void>} Resolves once closed.
 * @example
 * await stopWebRtcSession(handler, device, { sessionId, streamId });
 */
export const stopWebRtcSession = async (self, device, { sessionId }) => {
  await closeSession(self, String(sessionId), { notifyCamera: true });
};

/**
 * @description Close every live view (container shutdown).
 * @param {object} self - The TuyaHandler instance.
 * @returns {Promise<void>} Resolves once all are closed.
 * @example
 * await stopAllWebRtcSessions(handler);
 */
export const stopAllWebRtcSessions = async (self) => {
  const keys = Array.from(getSessions(self).keys());
  await Promise.all(keys.map((key) => closeSession(self, key, { notifyCamera: true })));
};
