// Real-time cloud events through the Tuya Message Service (Pulsar over
// websocket) — issue #10. Backport of the core tuya.pulsar.js, adapted to the
// external-integration model: the config comes from `this.config` (not the
// Gladys variable store), devices are resolved from the SDK `gladys.devices`
// cache, and the doorbell/diagnostics collaborators of the core branch are
// left out (only the real-time state reporting is ported here).
//
// The cloud pushes device status reports in real time — exactly what the 30s
// poll cannot give for a cloud-only device. OPT-IN: it requires the "Message
// Service" to be enabled on the Tuya IoT project, and the "Real-time cloud
// events" toggle (config `pulsar_enabled`) to be on. Outbound-only websocket,
// so it works from the isolated integration container.

import crypto from 'crypto';

import WebSocket from 'ws';
import { createLogger } from '@gladysassistant/integration-sdk';

import { DEVICE_PARAM_NAME } from '../constants.js';
import { getParamValue } from '../utils/tuya.deviceParams.js';
import { emitCloudCodeStates, publishTransport, TRANSPORT } from '../tuya.poll.js';

const logger = createLogger({ name: 'tuya' });

// Regional message-service endpoints (config endpoint key -> wss host).
const PULSAR_HOSTS = {
  china: 'wss://mqe.tuyacn.com:8285/',
  westernAmerica: 'wss://mqe.tuyaus.com:8285/',
  easternAmerica: 'wss://mqe.tuyaus.com:8285/',
  centralEurope: 'wss://mqe.tuyaeu.com:8285/',
  westernEurope: 'wss://mqe.tuyaeu.com:8285/',
  india: 'wss://mqe.tuyain.com:8285/',
};
const PULSAR_DEFAULT_HOST = PULSAR_HOSTS.centralEurope;
// Failover subscription on the production event topic, same parameters as the
// official SDK.
const PULSAR_TOPIC_QUERY = 'ackTimeoutMillis=3000&subscriptionType=Failover';
const PULSAR_PING_INTERVAL_MS = 30 * 1000;
const PULSAR_RECONNECT_DELAYS_MS = [3000, 10000, 30000, 60000];
// Protocol 4 = legacy device data report ({ devId, status: [{ code, value }] });
// protocol 1000 = its IoT-core twin ({ bizCode: 'devicePropertyMessage', bizData }).
const PULSAR_ROUTED_PROTOCOLS = new Set([4, 1000]);
// Every report currently arrives TWICE (legacy protocol 4 AND its IoT-core
// twin protocol 1000): remember the recent ones to route each only once.
const PULSAR_DUPLICATE_WINDOW_MS = 5 * 1000;

const md5Hex = (value) => crypto.createHash('md5').update(value, 'utf8').digest('hex');

/**
 * @description Build the Pulsar websocket password (official SDK derivation).
 * @param {string} accessId - The Tuya cloud Access ID.
 * @param {string} accessKey - The Tuya cloud Access Secret.
 * @returns {string} The 16-character websocket password.
 * @example
 * buildPulsarPassword('accessId', 'accessKey');
 */
export const buildPulsarPassword = (accessId, accessKey) =>
  md5Hex(`${accessId}${md5Hex(accessKey)}`).substr(8, 16);

/**
 * @description Decrypt a Pulsar message data blob. The `em` message property
 * carries the model: 'aes_gcm' (12-byte nonce prefix + ciphertext + 16-byte
 * auth tag, no AAD — per the official tuya-pulsar-sdk-go) or legacy
 * AES-128-ECB. The key is a fixed 16-byte slice of the secret.
 * @param {string} data - The base64 encrypted data.
 * @param {string} accessKey - The Tuya cloud Access Secret.
 * @param {string} [decryptModel] - The `em` property ('aes_gcm' or undefined).
 * @returns {object|null} The decrypted JSON document, or null on failure.
 * @example
 * decryptPulsarData('kTVln...', 'accessKey', 'aes_gcm');
 */
export const decryptPulsarData = (data, accessKey, decryptModel) => {
  try {
    const key = Buffer.from(accessKey.substring(8, 24), 'utf8');
    const encrypted = Buffer.from(data, 'base64');
    let decrypted;
    if (decryptModel === 'aes_gcm') {
      const decipher = crypto.createDecipheriv('aes-128-gcm', key, encrypted.subarray(0, 12));
      decipher.setAuthTag(encrypted.subarray(encrypted.length - 16));
      decrypted = Buffer.concat([
        decipher.update(encrypted.subarray(12, encrypted.length - 16)),
        decipher.final(),
      ]);
    } else {
      const decipher = crypto.createDecipheriv('aes-128-ecb', key, null);
      decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    }
    return JSON.parse(decrypted.toString('utf8'));
  } catch {
    return null;
  }
};

const findDeviceById = (self, devId) => {
  const devices = (self.gladys && self.gladys.devices) || [];
  return devices.find(
    (device) => getParamValue(device && device.params, DEVICE_PARAM_NAME.DEVICE_ID) === devId,
  );
};

const routePulsarValues = (self, devId, values) => {
  const now = Date.now();
  self.pulsarRecentReports = self.pulsarRecentReports || new Map();
  const duplicateKey = `${devId}:${JSON.stringify(values)}`;
  const lastSeenAt = self.pulsarRecentReports.get(duplicateKey);
  self.pulsarRecentReports.forEach((seenAt, key) => {
    if (now - seenAt > PULSAR_DUPLICATE_WINDOW_MS) {
      self.pulsarRecentReports.delete(key);
    }
  });
  self.pulsarRecentReports.set(duplicateKey, now);
  if (lastSeenAt !== undefined && now - lastSeenAt <= PULSAR_DUPLICATE_WINDOW_MS) {
    // Twin-format report already routed (protocol 4 + 1000): skip.
    return;
  }

  const device = findDeviceById(self, devId);
  if (!device) {
    logger.debug(`[Tuya][pulsar] report for a device not in Gladys (${devId})`);
    return;
  }
  const pending = [];
  const { changed } = emitCloudCodeStates(self, device, values, pending);
  Promise.all(pending).catch(() => {});
  if (changed > 0) {
    // A real-time cloud report just refreshed the device: it IS reachable over
    // the cloud (unless it is already served locally, which keeps its Local
    // badge — publishTransport is on-change only).
    const topic = getParamValue(device.params, DEVICE_PARAM_NAME.DEVICE_ID);
    const hasLiveLocalSession = Boolean(
      self.localSessions &&
      self.localSessions.get(topic) &&
      self.localSessions.get(topic).connected,
    );
    if (!hasLiveLocalSession) {
      publishTransport(self, device, TRANSPORT.CLOUD);
    }
    logger.info(`[Tuya][pulsar] device=${devId} real-time report published ${changed} change(s)`);
  }
};

/**
 * @description Handle one decrypted Pulsar event: extract the reported code
 * values and route them through the cloud-code state pipeline.
 * @param {object} decrypted - The decrypted Pulsar document.
 * @returns {void}
 * @example
 * this.handlePulsarEvent({ devId: 'id', status: [{ code: 'switch_1', value: true }] });
 */
export function handlePulsarEvent(decrypted) {
  // IoT-core format (protocol 1000): { bizCode: 'devicePropertyMessage',
  // bizData: { devId, properties: [{ code, value }] } }.
  if (decrypted && decrypted.bizCode === 'devicePropertyMessage' && decrypted.bizData) {
    const propertyList = Array.isArray(decrypted.bizData.properties)
      ? decrypted.bizData.properties
      : [];
    const values = {};
    propertyList.forEach((entry) => {
      if (entry && entry.code !== undefined && entry.code !== null) {
        values[String(entry.code)] = entry.value;
      }
    });
    if (!decrypted.bizData.devId || Object.keys(values).length === 0) {
      return;
    }
    routePulsarValues(this, decrypted.bizData.devId, values);
    return;
  }
  const devId = decrypted && (decrypted.devId || decrypted.deviceId);
  if (!devId) {
    return;
  }
  if (decrypted.bizCode) {
    // Lifecycle events (online/offline/name change...): informational only.
    logger.debug(`[Tuya][pulsar] lifecycle event ${decrypted.bizCode} for device=${devId}`);
    return;
  }
  const statusList = Array.isArray(decrypted.status) ? decrypted.status : [];
  const values = {};
  statusList.forEach((entry) => {
    if (entry && entry.code !== undefined && entry.code !== null) {
      values[String(entry.code)] = entry.value;
    }
  });
  if (Object.keys(values).length === 0) {
    return;
  }
  routePulsarValues(this, devId, values);
}

/**
 * @description Open (or reopen) the Pulsar websocket and wire its listeners.
 * @param {object} self - The TuyaHandler instance.
 * @param {object} context - The { host, accessId, accessKey, retryCount } context.
 * @returns {void}
 * @example
 * openPulsarConnection(this, { host, accessId, accessKey, retryCount: 0 });
 */
function openPulsarConnection(self, context) {
  const { host, accessId, accessKey } = context;
  const url = `${host}ws/v2/consumer/persistent/${accessId}/out/event/${accessId}-sub?${PULSAR_TOPIC_QUERY}`;
  const ws = new WebSocket(url, {
    headers: {
      username: accessId,
      password: buildPulsarPassword(accessId, accessKey),
    },
  });
  const entry = { status: 'connecting', ws, pingTimer: null, retryTimer: null, context };
  self.pulsar = entry;
  const isActive = () => self.pulsar === entry;

  const scheduleReconnect = () => {
    entry.status = 'reconnecting';
    const delay =
      PULSAR_RECONNECT_DELAYS_MS[
        Math.min(context.retryCount, PULSAR_RECONNECT_DELAYS_MS.length - 1)
      ];
    context.retryCount += 1;
    entry.retryTimer = setTimeout(() => {
      openPulsarConnection(self, context);
    }, delay);
    if (entry.retryTimer && typeof entry.retryTimer.unref === 'function') {
      entry.retryTimer.unref();
    }
  };

  ws.on('open', () => {
    if (!isActive()) {
      return;
    }
    entry.status = 'connected';
    context.retryCount = 0;
    logger.info('[Tuya][pulsar] connected to the Tuya message service (real-time cloud events)');
    entry.pingTimer = setInterval(() => {
      try {
        ws.ping();
      } catch (e) {
        logger.debug(`[Tuya][pulsar] ping failed: ${e.message}`);
      }
    }, PULSAR_PING_INTERVAL_MS);
    if (typeof entry.pingTimer.unref === 'function') {
      entry.pingTimer.unref();
    }
  });

  ws.on('message', (raw) => {
    if (!isActive()) {
      return;
    }
    let envelope;
    try {
      envelope = JSON.parse(raw.toString());
    } catch (e) {
      logger.debug(`[Tuya][pulsar] unparseable frame: ${e.message}`);
      return;
    }
    // Acknowledge first: an unacked message is redelivered after ackTimeoutMillis.
    if (envelope && envelope.messageId) {
      try {
        ws.send(JSON.stringify({ messageId: envelope.messageId }));
      } catch (e) {
        logger.debug(`[Tuya][pulsar] ack failed: ${e.message}`);
      }
    }
    if (!envelope || !envelope.payload) {
      return;
    }
    let payload;
    try {
      payload = JSON.parse(Buffer.from(envelope.payload, 'base64').toString('utf8'));
    } catch (e) {
      logger.debug(`[Tuya][pulsar] unparseable payload: ${e.message}`);
      return;
    }
    if (payload.protocol !== undefined && !PULSAR_ROUTED_PROTOCOLS.has(payload.protocol)) {
      logger.debug(`[Tuya][pulsar] ignored message with protocol ${payload.protocol}`);
      return;
    }
    // The `em` property selects the encryption model of the data blob.
    const decryptModel = envelope.properties && envelope.properties.em;
    const decrypted = decryptPulsarData(payload.data, accessKey, decryptModel);
    if (!decrypted) {
      logger.warn('[Tuya][pulsar] a message could not be decrypted');
      return;
    }
    self.handlePulsarEvent(decrypted);
  });

  ws.on('error', (e) => {
    if (!isActive()) {
      return;
    }
    if (String(e.message).includes('401')) {
      // The message service refused our credentials: retrying cannot fix it —
      // "Message Service" is most likely not enabled on the Tuya IoT project.
      entry.unauthorized = true;
      logger.warn(
        '[Tuya][pulsar] rejected (HTTP 401): enable "Message Service" on your Tuya IoT project (https://iot.tuya.com/cloud/ > your project > Service API), then save the Tuya configuration again',
      );
      return;
    }
    logger.info(`[Tuya][pulsar] websocket error: ${e.message}`);
  });

  ws.on('close', () => {
    if (!isActive()) {
      return;
    }
    if (entry.pingTimer) {
      clearInterval(entry.pingTimer);
      entry.pingTimer = null;
    }
    if (entry.unauthorized) {
      entry.status = 'unauthorized';
      return;
    }
    logger.debug('[Tuya][pulsar] connection closed, reconnecting');
    scheduleReconnect();
  });
}

/**
 * @description Start the Pulsar listener when enabled and configured. Never
 * throws.
 * @returns {Promise} Resolves once the connection has been kicked off (or skipped).
 * @example
 * await this.startPulsar();
 */
export async function startPulsar() {
  try {
    // Always start from a clean slate (config change, reconnect).
    this.stopPulsar();
    const config = this.config || {};
    if (config.pulsarEnabled !== true) {
      this.pulsar = { status: 'disabled' };
      logger.debug('[Tuya][pulsar] disabled (real-time cloud events toggle is off)');
      return;
    }
    const accessId = config.accessKey;
    const accessKey = config.secretKey;
    if (!accessId || !accessKey) {
      this.pulsar = { status: 'not_configured' };
      logger.warn('[Tuya][pulsar] enabled but the cloud credentials are missing');
      return;
    }
    const host = PULSAR_HOSTS[config.endpoint] || PULSAR_DEFAULT_HOST;
    openPulsarConnection(this, { host, accessId, accessKey, retryCount: 0 });
  } catch (e) {
    logger.warn(`[Tuya][pulsar] failed to start: ${e.message}`);
    this.pulsar = { status: 'error' };
  }
}

/**
 * @description Stop the Pulsar listener (service stop / configuration change).
 * @returns {void}
 * @example
 * this.stopPulsar();
 */
export function stopPulsar() {
  const entry = this.pulsar;
  this.pulsar = { status: 'stopped' };
  if (!entry) {
    return;
  }
  if (entry.pingTimer) {
    clearInterval(entry.pingTimer);
  }
  if (entry.retryTimer) {
    clearTimeout(entry.retryTimer);
  }
  if (entry.ws) {
    try {
      entry.ws.terminate();
    } catch {
      // The socket is being dropped anyway.
    }
  }
}
