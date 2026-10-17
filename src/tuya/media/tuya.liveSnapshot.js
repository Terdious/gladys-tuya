// -----------------------------------------------------------------------------
// Camera live snapshot: a fresh frame grabbed from the camera's RTSPS stream.
//
// Tuya stores a picture only on an event (ring, motion), and the PTZ cameras
// encrypt it. The cloud however allocates a short-lived RTSPS URL of the live
// stream on demand (POST /v1.0/devices/{id}/stream/actions/allocate, checked on
// the LSC PTZ cameras of @GBoulvin): ffmpeg reads ONE frame from it and writes
// it as a JPEG on its stdout (nothing touches the read-only rootfs).
//
// Used by:
//   - onGetImage (dashboard live view, "show me the camera" chat intent, scene
//     "send camera image"): a fresh frame, within the core's 15 s deadline;
//   - the camera poll: the stored image is refreshed every few minutes, so the
//     dashboard widget (which shows the stored image, expired after 1 hour by
//     the core) always has a recent picture.
//
// A camera whose stream cannot be read (battery camera asleep, stream not
// allowed for the cloud project, no ffmpeg) backs off, so it costs neither an
// API call nor a 12 s wait on every request.
// -----------------------------------------------------------------------------

import { spawn as spawnProcess } from 'node:child_process';
import { createLogger } from '@gladysassistant/integration-sdk';

import { API } from '../constants.js';
import { getTuyaDeviceId } from '../utils/tuya.externalId.js';
import { encodeUnderLimit } from './tuya.media.js';

const logger = createLogger({ name: 'tuya' });

// Leaves room for the allocate call and the reply inside the core's 15 s.
export const CAPTURE_TIMEOUT_MS = 11 * 1000;
// A capture this recent is re-served instead of opening the stream again
// (several widgets / a scene asking at once).
export const SNAPSHOT_CACHE_MS = 10 * 1000;
// Background refresh of the stored image (camera poll).
export const SNAPSHOT_REFRESH_MS = 5 * 60 * 1000;
// Back-off after a failed capture, doubled on each failure up to the max.
export const FAILURE_BACKOFF_MS = 5 * 60 * 1000;
export const FAILURE_BACKOFF_MAX_MS = 60 * 60 * 1000;
// A JPEG larger than the camera budget is re-encoded by encodeUnderLimit
// anyway; this width keeps it under the budget at once on most streams.
const MAX_FRAME_WIDTH = 1280;
// Hard cap on what ffmpeg may write (a misbehaving stream never fills memory).
const MAX_FRAME_BYTES = 8 * 1024 * 1024;

const getState = (self, externalId) => {
  if (!self.liveSnapshots) {
    self.liveSnapshots = new Map();
  }
  if (!self.liveSnapshots.has(externalId)) {
    self.liveSnapshots.set(externalId, {
      image: null,
      capturedAt: 0,
      inFlight: null,
      failures: 0,
      retryAt: 0,
    });
  }
  return self.liveSnapshots.get(externalId);
};

/**
 * @description Ask the Tuya cloud for a short-lived RTSPS URL of the camera
 * live stream.
 * @param {object} self - The TuyaHandler instance.
 * @param {string} deviceId - The Tuya device id.
 * @returns {Promise<string>} The rtsps:// URL.
 * @example
 * const url = await allocateRtspUrl(handler, 'bf85d2ce4746ff3ebeifas');
 */
export const allocateRtspUrl = async (self, deviceId) => {
  if (!self.connector || typeof self.connector.request !== 'function') {
    throw new Error('Tuya cloud not connected');
  }
  const response = await self.connector.request({
    method: 'POST',
    path: `${API.PUBLIC_VERSION_1_0}/devices/${deviceId}/stream/actions/allocate`,
    body: { type: 'rtsp' },
  });
  const url = response && response.result && response.result.url;
  if (!response || response.success === false || typeof url !== 'string' || url.length === 0) {
    const reason = (response && (response.msg || response.code)) || 'no stream URL';
    throw new Error(`stream allocate refused: ${reason}`);
  }
  return url;
};

/**
 * @description Read one frame of a stream with ffmpeg, as JPEG bytes.
 * @param {string} url - The rtsp(s):// URL.
 * @param {object} [options] - Options.
 * @param {Function} [options.spawn] - child_process.spawn (injected by tests).
 * @param {number} [options.timeoutMs] - Kill ffmpeg after this delay.
 * @returns {Promise<Buffer>} The JPEG bytes.
 * @example
 * const jpeg = await captureFrame('rtsps://...');
 */
export const captureFrame = (url, { spawn = spawnProcess, timeoutMs = CAPTURE_TIMEOUT_MS } = {}) =>
  new Promise((resolve, reject) => {
    const args = [
      '-hide_banner',
      '-loglevel',
      'error',
      '-rtsp_transport',
      'tcp',
      '-i',
      url,
      '-frames:v',
      '1',
      '-vf',
      `scale='min(${MAX_FRAME_WIDTH},iw)':-2`,
      '-q:v',
      '5',
      '-f',
      'image2',
      '-c:v',
      'mjpeg',
      'pipe:1',
    ];
    let child;
    try {
      child = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      reject(e);
      return;
    }
    const chunks = [];
    let size = 0;
    let stderr = '';
    let settled = false;
    const finish = (error, value) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (error) {
        reject(error);
      } else {
        resolve(value);
      }
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(new Error(`no frame within ${timeoutMs} ms`));
    }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_FRAME_BYTES) {
        child.kill('SIGKILL');
        finish(new Error('frame too large'));
        return;
      }
      chunks.push(chunk);
    });
    child.stderr.on('data', (chunk) => {
      // Keep the end of the output: the last lines carry the reason.
      stderr = `${stderr}${chunk}`.slice(-500);
    });
    child.on('error', (e) => {
      finish(e.code === 'ENOENT' ? new Error('ffmpeg is not installed') : e);
    });
    child.on('close', (code) => {
      const frame = Buffer.concat(chunks);
      if (code === 0 && frame.length > 0) {
        finish(null, frame);
        return;
      }
      // The stream URL carries a token: never log the ffmpeg output as is.
      const reason = stderr.replace(/rtsps?:\/\/\S+/g, '<stream>').trim();
      finish(new Error(`ffmpeg exited with code ${code}${reason ? `: ${reason}` : ''}`));
    });
  });

/**
 * @description Grab a fresh frame of a camera (allocate + ffmpeg), sized for
 * the camera store. Concurrent calls share the same capture, a capture younger
 * than SNAPSHOT_CACHE_MS is re-served, and a camera that just failed is not
 * retried before its back-off ends (null is returned at once).
 * @param {object} self - The TuyaHandler instance.
 * @param {string} externalId - The Gladys device external id.
 * @param {string} deviceId - The Tuya device id.
 * @returns {Promise<string|null>} An `image/jpg;base64,...` string, or null.
 * @example
 * const image = await captureLiveSnapshot(handler, device.external_id, 'bf85...');
 */
export const captureLiveSnapshot = async (self, externalId, deviceId) => {
  const state = getState(self, externalId);
  const now = Date.now();
  if (state.image && now - state.capturedAt < SNAPSHOT_CACHE_MS) {
    return state.image;
  }
  if (state.inFlight) {
    return state.inFlight;
  }
  if (now < state.retryAt) {
    return null;
  }
  const capture = self.captureFrame || captureFrame;
  state.inFlight = (async () => {
    try {
      const url = await allocateRtspUrl(self, deviceId);
      const image = encodeUnderLimit(await capture(url));
      if (!image) {
        throw new Error('frame does not fit the camera image budget');
      }
      state.image = image;
      state.capturedAt = Date.now();
      state.failures = 0;
      state.retryAt = 0;
      logger.debug(`[Tuya][snapshot] live frame captured (device=${externalId})`);
      return image;
    } catch (e) {
      state.failures += 1;
      const backoff = Math.min(
        FAILURE_BACKOFF_MS * 2 ** (state.failures - 1),
        FAILURE_BACKOFF_MAX_MS,
      );
      state.retryAt = Date.now() + backoff;
      const log = state.failures === 1 ? logger.warn : logger.debug;
      log.call(
        logger,
        `[Tuya][snapshot] live frame unavailable (device=${externalId}): ${e.message} — next try in ${Math.round(backoff / 60000)} min`,
      );
      return null;
    } finally {
      state.inFlight = null;
    }
  })();
  return state.inFlight;
};

/**
 * @description Whether the stored image of a camera is due for a background
 * refresh (never refreshed, or older than SNAPSHOT_REFRESH_MS).
 * @param {object} self - The TuyaHandler instance.
 * @param {string} externalId - The Gladys device external id.
 * @returns {boolean} True when a refresh should run.
 * @example
 * if (isSnapshotRefreshDue(handler, device.external_id)) { ... }
 */
export const isSnapshotRefreshDue = (self, externalId) => {
  const state = getState(self, externalId);
  const now = Date.now();
  return !state.inFlight && now >= state.retryAt && now - state.capturedAt >= SNAPSHOT_REFRESH_MS;
};

/**
 * @description Grab a fresh frame of a camera and store it as the device
 * camera image (dashboard widget, last image of onGetImage). Never throws.
 * @param {object} self - The TuyaHandler instance.
 * @param {object} device - The Gladys device (external_id, params).
 * @returns {Promise<string|null>} The image published, or null.
 * @example
 * await refreshCameraSnapshot(handler, device);
 */
export const refreshCameraSnapshot = async (self, device) => {
  const externalId = device && device.external_id;
  let deviceId;
  try {
    deviceId = getTuyaDeviceId(device);
  } catch {
    return null;
  }
  if (!externalId || !deviceId) {
    return null;
  }
  const previous = getState(self, externalId).capturedAt;
  const image = await captureLiveSnapshot(self, externalId, deviceId);
  // A cached frame was already published when it was captured.
  if (!image || getState(self, externalId).capturedAt === previous) {
    return image;
  }
  self.lastCameraImage = self.lastCameraImage || {};
  self.lastCameraImage[externalId] = image;
  if (self.gladys && typeof self.gladys.publishCameraImage === 'function') {
    try {
      await self.gladys.publishCameraImage(externalId, image);
    } catch (e) {
      logger.warn(
        `[Tuya][snapshot] publishCameraImage failed for device=${externalId}: ${e.message}`,
      );
    }
  }
  return image;
};
