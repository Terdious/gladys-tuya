// -----------------------------------------------------------------------------
// Doorbell / camera media (snapshot image + doorbell ring event).
//
// Ported from the core branch server/services/tuya/lib/tuya.media.js
// (tuya-diagnostics-doorbell-ring), adapted to the external-integration model:
//   - the image is published through the SDK `gladys.publishCameraImage`
//     (dedicated camera channel) instead of the core `device.camera.setImage`;
//   - the doorbell ring / motion event is published through
//     `gladys.publishState` on the DOORBELL / MOTION_SENSOR feature (a 1 -> 0
//     pulse) instead of emitting a core NEW_STATE event;
//   - oversized snapshots are re-encoded with jpeg-js (pure JS) — the core uses
//     ffmpeg, unavailable on the read-only rootfs — exactly like gladys-netatmo
//     (src/netatmo/camera.js), with the same ~96 KB camera-store budget.
//
// A doorbell media DP carries the base64 of a `{ bucket, files, v }` JSON (or,
// on Pulsar alerts, the base64 of a full presigned https URL). On the observed
// i5e3a4qxcsthszin doorbell the AES key is EMPTY, so the image is not encrypted
// and is downloadable as-is; an encrypted payload is skipped until a real one
// documents the IV layout.
// -----------------------------------------------------------------------------

import jpeg from 'jpeg-js';
import { createLogger, DEVICE_FEATURE_CATEGORIES } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'tuya' });

// Media DPs and their Tuya code (local DPS index -> cloud code).
export const MEDIA_CODES_BY_DPS = {
  115: 'movement_detect_pic',
  154: 'doorbell_pic',
};
export const MEDIA_CODES = Object.values(MEDIA_CODES_BY_DPS);

// Gladys single-click button state (server-side BUTTON_STATUS.CLICK).
const BUTTON_CLICK_STATE = 1;
// Momentary event states (motion sensor, doorbell ring): a detection/ring is a
// level, not a one-shot, so it is pulsed 1 -> 0. Auto-clearing after a short
// window makes every event a fresh 0 -> 1 edge (a scene trigger fires on that
// edge) and lets the widget fall back to "no motion" / the last-ring time.
const EVENT_ACTIVE_STATE = 1;
const EVENT_CLEARED_STATE = 0;
const EVENT_AUTO_CLEAR_MS = 30 * 1000;

// Categories whose media event is a 1 -> 0 pulse; anything else (the legacy
// BUTTON mapping of devices discovered before the first-class categories) gets
// the single click.
const PULSED_EVENT_CATEGORIES = new Set([
  DEVICE_FEATURE_CATEGORIES.MOTION_SENSOR,
  DEVICE_FEATURE_CATEGORIES.DOORBELL,
]);

const MEDIA_DOWNLOAD_TIMEOUT_MS = 10 * 1000;

// publishCameraImage rejects an image whose `image/jpg;base64,...` string is
// too large. gladys-netatmo targets 96 KB (the core mounts the camera route
// behind express.json() whose default body limit is 100 KB): keep that budget.
const IMAGE_PREFIX = 'image/jpg;base64,';
const MAX_IMAGE_STRING_SIZE = 96 * 1024;
export const MAX_RAW_JPEG_SIZE = Math.floor(
  ((MAX_IMAGE_STRING_SIZE - IMAGE_PREFIX.length) * 3) / 4,
);
const REENCODE_QUALITIES = [70, 50, 30, 15];

// The object-storage host is undocumented for the EU datacenter (the CN docs
// show `{bucket}.cos.tuyacn.com`): try the known domains in order.
const buildMediaUrlCandidates = (bucket, filePath) => [
  `https://${bucket}.oss-eu-central-1.aliyuncs.com${filePath}`,
  `https://${bucket}.s3.eu-central-1.amazonaws.com${filePath}`,
  `https://${bucket}.cos.tuyacn.com${filePath}`,
];

/**
 * @description Decode a doorbell media payload (base64 of a presigned https URL
 * or of a `{ bucket, files, v }` JSON).
 * @param {string} rawValue - The raw DP value pushed by the device.
 * @returns {object|null} A `{ directUrl }` or `{ bucket, filePath, encryptionKey, version }` descriptor, or null.
 * @example
 * const media = decodeMediaPayload('eyJidWNrZXQiOiJ0eS1ldS1z...');
 */
export const decodeMediaPayload = (rawValue) => {
  if (typeof rawValue !== 'string' || rawValue.length === 0) {
    return null;
  }
  let decoded;
  try {
    decoded = Buffer.from(rawValue, 'base64').toString('utf8');
  } catch {
    return null;
  }
  // Pulsar alert payloads carry the presigned download URL directly (base64 of
  // a full https URL, ~60s validity) — the only shape actually downloadable.
  if (/^https?:\/\//.test(decoded)) {
    return { directUrl: decoded };
  }
  let parsed;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    return null;
  }
  const file =
    parsed && typeof parsed.bucket === 'string' && Array.isArray(parsed.files)
      ? parsed.files[0]
      : null;
  if (!Array.isArray(file) || typeof file[0] !== 'string' || file[0].length === 0) {
    return null;
  }
  return {
    bucket: parsed.bucket,
    filePath: file[0],
    encryptionKey: typeof file[1] === 'string' ? file[1] : '',
    version: parsed.v,
  };
};

/**
 * @description Fit a raw JPEG buffer into the camera-store budget, re-encoding
 * with jpeg-js at decreasing quality when needed (no ffmpeg on the read-only
 * rootfs).
 * @param {Buffer} buffer - Raw JPEG bytes.
 * @returns {string|null} An `image/jpg;base64,...` string, or null when it cannot fit.
 * @example
 * const image = encodeUnderLimit(buffer);
 */
export const encodeUnderLimit = (buffer) => {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return null;
  }
  if (buffer.length <= MAX_RAW_JPEG_SIZE) {
    return `${IMAGE_PREFIX}${buffer.toString('base64')}`;
  }
  let decoded;
  try {
    decoded = jpeg.decode(buffer, { maxMemoryUsageInMB: 128 });
  } catch (err) {
    logger.warn(`[Tuya][media] snapshot re-encode failed (not a decodable JPEG?): ${err.message}`);
    return null;
  }
  for (let i = 0; i < REENCODE_QUALITIES.length; i += 1) {
    const { data } = jpeg.encode(decoded, REENCODE_QUALITIES[i]);
    if (data.length <= MAX_RAW_JPEG_SIZE) {
      logger.debug(
        `[Tuya][media] snapshot re-encoded at quality ${REENCODE_QUALITIES[i]} (${buffer.length} -> ${data.length} bytes)`,
      );
      return `${IMAGE_PREFIX}${Buffer.from(data).toString('base64')}`;
    }
  }
  logger.warn('[Tuya][media] snapshot still exceeds the camera budget after re-encoding — skipped');
  return null;
};

const downloadImageBuffer = async (url) => {
  const response = await fetch(url, { signal: AbortSignal.timeout(MEDIA_DOWNLOAD_TIMEOUT_MS) });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
};

const deviceHasCameraFeature = (device) =>
  Array.isArray(device.features) &&
  device.features.some((feature) => feature && feature.category === 'camera');

// Media code -> the event feature it fires. A new snapshot IS the event: the
// underlying ring / motion DP never reports a value on the observed devices, so
// a genuinely new picture is what triggers the doorbell ring / the motion event.
const EVENT_FEATURE_SUFFIX = {
  doorbell_pic: ':doorbell_active',
  movement_detect_pic: ':movement_detect_pic',
};

const findFeatureBySuffix = (device, suffix) =>
  (Array.isArray(device.features) ? device.features : []).find(
    (feature) =>
      feature && typeof feature.external_id === 'string' && feature.external_id.endsWith(suffix),
  ) || null;

/**
 * @description Fire the event feature a new snapshot stands for: a 1 -> 0 pulse
 * for a MOTION_SENSOR / DOORBELL feature (so the next event is a fresh edge),
 * or a single click for a legacy BUTTON mapping. Never throws.
 * @param {object} self - The TuyaHandler instance.
 * @param {object} device - The Gladys device.
 * @param {string} code - The media code (doorbell_pic / movement_detect_pic).
 * @param {object} feature - The event feature to fire.
 * @returns {void}
 * @example
 * fireEventFeature(handler, device, 'movement_detect_pic', motionFeature);
 */
const fireEventFeature = (self, device, code, feature) => {
  const isPulsed = PULSED_EVENT_CATEGORIES.has(feature.category);
  self.gladys
    .publishState(feature.external_id, isPulsed ? EVENT_ACTIVE_STATE : BUTTON_CLICK_STATE)
    .then(() => logger.info(`[Tuya][media] ${code} event fired (device=${device.external_id})`))
    .catch((e) => logger.warn(`[Tuya][media] ${code} event publish failed: ${e.message}`));

  if (!isPulsed) {
    return;
  }
  // Re-arm the event: clear any pending timer, then schedule the 0 edge.
  self.eventClearTimers = self.eventClearTimers || {};
  clearTimeout(self.eventClearTimers[feature.external_id]);
  const timer = setTimeout(() => {
    delete self.eventClearTimers[feature.external_id];
    self.gladys
      .publishState(feature.external_id, EVENT_CLEARED_STATE)
      .catch((e) => logger.warn(`[Tuya][media] ${code} auto-clear failed: ${e.message}`));
  }, EVENT_AUTO_CLEAR_MS);
  // Never keep the process alive just for a pending auto-clear.
  if (typeof timer.unref === 'function') {
    timer.unref();
  }
  self.eventClearTimers[feature.external_id] = timer;
};

/**
 * @description Download a snapshot and publish it on the device camera image
 * feature. Never throws (runs behind the poll/push pipeline).
 * @param {object} self - The TuyaHandler instance.
 * @param {object} device - The Gladys device.
 * @param {string} code - The media code (doorbell_pic / movement_detect_pic).
 * @param {string} rawValue - The raw DP payload.
 * @returns {Promise<boolean>} True when an image was published.
 * @example
 * await handleMediaValue(handler, device, 'doorbell_pic', raw);
 */
export const handleMediaValue = async (self, device, code, rawValue) => {
  const media = decodeMediaPayload(rawValue);
  if (!media) {
    return false;
  }
  if (!media.directUrl && media.encryptionKey !== '') {
    logger.warn(
      `[Tuya][media] encrypted ${code} image not supported yet (device=${device.external_id})`,
    );
    return false;
  }
  const candidates = media.directUrl
    ? [media.directUrl]
    : buildMediaUrlCandidates(media.bucket, media.filePath);

  let buffer = null;
  for (let i = 0; i < candidates.length && buffer === null; i += 1) {
    try {
      buffer = await downloadImageBuffer(candidates[i]);
    } catch (e) {
      logger.debug(`[Tuya][media] ${code} download failed on candidate ${i + 1}: ${e.message}`);
    }
  }
  if (buffer === null) {
    logger.warn(
      `[Tuya][media] no candidate host served the ${code} snapshot (device=${device.external_id})`,
    );
    return false;
  }

  const image = encodeUnderLimit(buffer);
  if (image === null) {
    return false;
  }
  if (!self.gladys || typeof self.gladys.publishCameraImage !== 'function') {
    return false;
  }
  // Keep the last snapshot so onGetImage (live-view widget) can re-serve it.
  self.lastCameraImage = self.lastCameraImage || {};
  self.lastCameraImage[device.external_id] = image;
  try {
    await self.gladys.publishCameraImage(device.external_id, image);
    logger.info(`[Tuya][media] ${code} snapshot published (device=${device.external_id})`);
    return true;
  } catch (e) {
    logger.warn(
      `[Tuya][media] publishCameraImage failed for device=${device.external_id}: ${e.message}`,
    );
    return false;
  }
};

/**
 * @description Fingerprint the underlying image of a media payload so the same
 * event, arriving in several payload shapes, fires exactly once.
 * @param {string} rawValue - The raw DP value.
 * @returns {string} A stable fingerprint.
 * @example
 * const fp = getMediaFingerprint(raw);
 */
export const getMediaFingerprint = (rawValue) => {
  const media = decodeMediaPayload(rawValue);
  if (!media) {
    return typeof rawValue === 'string' ? rawValue : '';
  }
  try {
    return media.directUrl
      ? new URL(media.directUrl).pathname
      : String(media.filePath).split('?')[0];
  } catch {
    return String(media.directUrl || media.filePath);
  }
};

/**
 * @description Pick the media values out of a cloud values-by-code map.
 * @param {object} values - Values keyed by Tuya code.
 * @returns {object} The media subset keyed by code.
 * @example
 * const media = extractMediaValuesFromCodes({ doorbell_pic: 'eyJi...' });
 */
export const extractMediaValuesFromCodes = (values) => {
  const media = {};
  if (!values || typeof values !== 'object') {
    return media;
  }
  MEDIA_CODES.forEach((code) => {
    if (Object.prototype.hasOwnProperty.call(values, code) && values[code] !== undefined) {
      media[code] = values[code];
    }
  });
  return media;
};

/**
 * @description Map a local DPS payload to media codes ({ '154': raw } -> { doorbell_pic: raw }).
 * @param {object} dps - The local DPS map.
 * @returns {object} The media values keyed by Tuya code.
 * @example
 * const media = extractMediaValuesFromDps({ 154: 'eyJi...' });
 */
export const extractMediaValuesFromDps = (dps) => {
  const media = {};
  if (!dps || typeof dps !== 'object') {
    return media;
  }
  Object.keys(MEDIA_CODES_BY_DPS).forEach((dpsKey) => {
    const code = MEDIA_CODES_BY_DPS[dpsKey];
    if (Object.prototype.hasOwnProperty.call(dps, dpsKey)) {
      media[code] = dps[dpsKey];
    } else if (Object.prototype.hasOwnProperty.call(dps, Number(dpsKey))) {
      media[code] = dps[Number(dpsKey)];
    }
  });
  return media;
};

/**
 * @description Gate the media codes on the underlying image (fingerprint) and,
 * on a NEW one, fire the doorbell ring (a new ring snapshot IS the ring — the
 * ring DP never reports a value) and download/publish the snapshot. Fire and
 * forget: the poll/push pipeline must never wait on a media download.
 * @param {object} self - The TuyaHandler instance.
 * @param {object} device - The Gladys device.
 * @param {object} valuesByCode - Observed raw media values keyed by code.
 * @returns {void}
 * @example
 * processMediaCodes(handler, device, { doorbell_pic: 'aHR0...' });
 */
export const processMediaCodes = (self, device, valuesByCode) => {
  if (!self || !device || !valuesByCode || typeof valuesByCode !== 'object') {
    return;
  }
  if (!Array.isArray(device.features) || device.features.length === 0) {
    return;
  }
  const hasCamera = deviceHasCameraFeature(device);
  self.eventDpMemory = self.eventDpMemory || {};

  MEDIA_CODES.forEach((code) => {
    if (!Object.prototype.hasOwnProperty.call(valuesByCode, code)) {
      return;
    }
    const rawValue = valuesByCode[code];
    const fingerprint = getMediaFingerprint(rawValue);
    const memoryKey = `${device.external_id}:media:${code}`;
    const hadPrevious = Object.prototype.hasOwnProperty.call(self.eventDpMemory, memoryKey);
    const previousFingerprint = self.eventDpMemory[memoryKey];
    self.eventDpMemory[memoryKey] = fingerprint;
    // The first observation only seeds the memory (a payload seen at startup has
    // an expired signed URL anyway); re-firing needs a genuinely new image.
    if (!hadPrevious || previousFingerprint === fingerprint || !fingerprint) {
      return;
    }

    // A new snapshot IS the event: fire the doorbell ring / the motion event on
    // the mapped feature when the device carries it.
    const suffix = EVENT_FEATURE_SUFFIX[code];
    const eventFeature = suffix ? findFeatureBySuffix(device, suffix) : null;
    if (eventFeature) {
      fireEventFeature(self, device, code, eventFeature);
    }

    // The image itself goes to the camera widget when the device carries one.
    if (hasCamera) {
      handleMediaValue(self, device, code, rawValue).catch((e) =>
        logger.warn(`[Tuya][media] unexpected media handling error for ${code}: ${e.message}`),
      );
    }
  });
};

/**
 * @description Return the last snapshot published for a device, so the
 * onGetImage live-view handler can re-serve it (Tuya has no on-demand capture).
 * @param {object} self - The TuyaHandler instance.
 * @param {string} externalId - The device external id.
 * @returns {string|null} The last `image/jpg;base64,...` string, or null.
 * @example
 * const image = getLastCameraImage(handler, device.external_id);
 */
export const getLastCameraImage = (self, externalId) =>
  (self && self.lastCameraImage && self.lastCameraImage[externalId]) || null;
