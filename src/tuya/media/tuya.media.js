// -----------------------------------------------------------------------------
// Doorbell / camera media (snapshot image + doorbell ring event).
//
// Ported from the core branch server/services/tuya/lib/tuya.media.js
// (tuya-diagnostics-doorbell-ring), adapted to the external-integration model:
//   - the image is published through the SDK `gladys.publishCameraImage`
//     (dedicated camera channel) instead of the core `device.camera.setImage`;
//   - the doorbell ring is published through `gladys.publishState` on the
//     BUTTON feature instead of emitting a core NEW_STATE event;
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

import { createDecipheriv } from 'node:crypto';

import jpeg from 'jpeg-js';
import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'tuya' });

// Media DPs and their Tuya code (local DPS index -> cloud code).
export const MEDIA_CODES_BY_DPS = {
  115: 'movement_detect_pic',
  154: 'doorbell_pic',
};
export const MEDIA_CODES = Object.values(MEDIA_CODES_BY_DPS);

// Gladys single-click button state (server-side BUTTON_STATUS.CLICK).
const BUTTON_CLICK_STATE = 1;

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

// --- Snapshot image resolution (download + optional decryption) --------------
//
// The doorbell ring picture (`doorbell_pic`) arrives as a full presigned https
// URL and is unencrypted → downloaded and published directly. The motion
// picture (`movement_detect_pic`) is pushed in TWO shapes for the same event:
// one carrying the SIGNED download path (`?param=…`, empty key), the other a
// 16-char AES key (unsigned path). They share the same fingerprint, so we
// buffer both and, once we hold the bytes + the key, attempt an AES-128
// decryption (ECB, then CBC with a zero IV). Heavy diagnostics on purpose: this
// is validated on a real bench, so the logs must say exactly where it fails.

const JPEG_MAGIC = (buf) =>
  Buffer.isBuffer(buf) && buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8;

const MEDIA_BUFFER_TTL_MS = 10 * 60 * 1000;
const MEDIA_BUFFER_MAX = 50;

const pruneMediaBuffer = (buffer, now) => {
  buffer.forEach((entry, key) => {
    if (now - entry.ts > MEDIA_BUFFER_TTL_MS) {
      buffer.delete(key);
    }
  });
  while (buffer.size > MEDIA_BUFFER_MAX) {
    buffer.delete(buffer.keys().next().value);
  }
};

/**
 * @description Attempt to decrypt an encrypted snapshot with the 16-char AES
 * key (used as raw UTF-8 bytes), trying AES-128-ECB then CBC (zero IV).
 * @param {Buffer} bytes - The encrypted image bytes.
 * @param {string} key - The 16-character key from the media payload.
 * @param {string} code - The media code (for logs).
 * @param {string} deviceId - The device external id (for logs).
 * @returns {Buffer|null} The decrypted JPEG bytes, or null.
 * @example
 * const jpg = decryptImage(bytes, 'f9bf4643af4ad44a', 'movement_detect_pic', id);
 */
export const decryptImage = (bytes, key, code, deviceId) => {
  const keyBuf = Buffer.from(String(key), 'utf8');
  if (keyBuf.length !== 16) {
    logger.warn(
      `[Tuya][media] ${code} unexpected AES key length ${keyBuf.length} (expected 16) — cannot decrypt (device=${deviceId})`,
    );
    return null;
  }
  const attempts = [
    ['aes-128-ecb', null],
    ['aes-128-cbc', Buffer.alloc(16, 0)],
  ];
  for (let i = 0; i < attempts.length; i += 1) {
    const [algo, iv] = attempts[i];
    try {
      const decipher = createDecipheriv(algo, keyBuf, iv);
      decipher.setAutoPadding(false);
      const usable = bytes.length - (bytes.length % 16);
      const out = Buffer.concat([decipher.update(bytes.subarray(0, usable)), decipher.final()]);
      if (JPEG_MAGIC(out)) {
        logger.info(`[Tuya][media] ${code} decrypted with ${algo} (device=${deviceId})`);
        return out;
      }
    } catch (e) {
      logger.debug(`[Tuya][media] ${code} ${algo} decrypt error: ${e.message}`);
    }
  }
  logger.warn(
    `[Tuya][media] ${code} decryption did not yield a JPEG (tried aes-128 ecb/cbc) (device=${deviceId})`,
  );
  return null;
};

const publishImage = async (self, device, code, bytes) => {
  const image = encodeUnderLimit(bytes);
  if (image === null || !self.gladys || typeof self.gladys.publishCameraImage !== 'function') {
    return;
  }
  // Keep the last snapshot so onGetImage (live-view widget) can re-serve it.
  self.lastCameraImage = self.lastCameraImage || {};
  self.lastCameraImage[device.external_id] = image;
  try {
    await self.gladys.publishCameraImage(device.external_id, image);
    logger.info(`[Tuya][media] ${code} snapshot published (device=${device.external_id})`);
  } catch (e) {
    logger.warn(
      `[Tuya][media] publishCameraImage failed for device=${device.external_id}: ${e.message}`,
    );
  }
};

const tryResolveImage = async (self, device, code, entry) => {
  if (entry.done || !Array.isArray(entry.urls) || entry.urls.length === 0) {
    return;
  }
  if (entry.bytes === null && !entry.downloadAttempted) {
    entry.downloadAttempted = true;
    for (let i = 0; i < entry.urls.length && entry.bytes === null; i += 1) {
      try {
        entry.bytes = await downloadImageBuffer(entry.urls[i]);
        logger.info(
          `[Tuya][media] ${code} downloaded ${entry.bytes.length} bytes (device=${device.external_id})`,
        );
      } catch (e) {
        logger.debug(`[Tuya][media] ${code} download failed on candidate ${i + 1}: ${e.message}`);
      }
    }
    if (entry.bytes === null) {
      logger.warn(
        `[Tuya][media] no candidate host served the ${code} snapshot (device=${device.external_id})`,
      );
      return;
    }
  }
  if (entry.bytes === null) {
    return;
  }
  // Already a plain JPEG (doorbell ring picture) → publish as-is.
  if (JPEG_MAGIC(entry.bytes)) {
    entry.done = true;
    await publishImage(self, device, code, entry.bytes);
    return;
  }
  // Encrypted → we need the AES key of the twin payload shape.
  if (!entry.key) {
    logger.debug(`[Tuya][media] ${code} downloaded a non-JPEG payload; waiting for the AES key`);
    return;
  }
  const decrypted = decryptImage(entry.bytes, entry.key, code, device.external_id);
  entry.done = true;
  if (decrypted) {
    await publishImage(self, device, code, decrypted);
  }
};

/**
 * @description Feed the per-event image buffer with one media payload shape
 * (signed URL and/or AES key), then attempt to resolve and publish the image.
 * Never throws (runs behind the poll/push pipeline).
 * @param {object} self - The TuyaHandler instance.
 * @param {object} device - The Gladys device.
 * @param {string} code - The media code.
 * @param {string} rawValue - The raw DP payload.
 * @param {string} fingerprint - The event fingerprint (shared by both shapes).
 * @returns {void}
 * @example
 * bufferMediaShape(handler, device, 'doorbell_pic', raw, fp);
 */
export const bufferMediaShape = (self, device, code, rawValue, fingerprint) => {
  const media = decodeMediaPayload(rawValue);
  if (!media || !fingerprint) {
    return;
  }
  const now = Date.now();
  self.mediaImageBuffer = self.mediaImageBuffer || new Map();
  const bufKey = `${device.external_id}:${code}:${fingerprint}`;
  const entry = self.mediaImageBuffer.get(bufKey) || {
    urls: null,
    key: '',
    bytes: null,
    downloadAttempted: false,
    done: false,
    ts: now,
  };
  entry.ts = now;

  if (media.directUrl) {
    // Full presigned URL (`?X-Amz-Signature=…`) — the doorbell ring picture.
    // This is the ONLY shape we can download today: keep the first one (its
    // signature is fresh ~60s) and never reset, so a re-poll does not re-fetch.
    if (!entry.urls) {
      entry.urls = [media.directUrl];
    }
  } else if (media.encryptionKey) {
    // bucket/files motion reference: capture the 16-char AES key for the day we
    // can resolve its download URL. The `?param=` is a Tuya signature, NOT an S3
    // one, so the candidate hosts 403 — do NOT attempt a download (it only
    // floods the logs every poll). Resolving that URL is a separate research
    // task; decryptImage() is ready for when it lands.
    entry.key = media.encryptionKey;
  }
  self.mediaImageBuffer.set(bufKey, entry);
  pruneMediaBuffer(self.mediaImageBuffer, now);

  tryResolveImage(self, device, code, entry).catch((e) =>
    logger.warn(`[Tuya][media] unexpected media handling error for ${code}: ${e.message}`),
  );
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

    // Image: feed the buffer with BOTH payload shapes of the event (the signed
    // URL and the AES key share this fingerprint), BEFORE the event dedup drops
    // the twin. The buffer resolves + publishes the picture on its own.
    if (hasCamera) {
      bufferMediaShape(self, device, code, rawValue, fingerprint);
    }

    // Event: fire the doorbell ring / the motion event exactly once per
    // genuinely new image. The first observation only seeds the memory (a
    // payload seen at startup has an expired signed URL anyway).
    const memoryKey = `${device.external_id}:media:${code}`;
    const hadPrevious = Object.prototype.hasOwnProperty.call(self.eventDpMemory, memoryKey);
    const previousFingerprint = self.eventDpMemory[memoryKey];
    self.eventDpMemory[memoryKey] = fingerprint;
    if (!hadPrevious || previousFingerprint === fingerprint || !fingerprint) {
      return;
    }

    const suffix = EVENT_FEATURE_SUFFIX[code];
    const eventFeature = suffix ? findFeatureBySuffix(device, suffix) : null;
    if (eventFeature) {
      self.gladys
        .publishState(eventFeature.external_id, BUTTON_CLICK_STATE)
        .then(() => logger.info(`[Tuya][media] ${code} event fired (device=${device.external_id})`))
        .catch((e) => logger.warn(`[Tuya][media] ${code} event publish failed: ${e.message}`));
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
