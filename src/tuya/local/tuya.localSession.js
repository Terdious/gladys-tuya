// Persistent local (LAN) sessions — issue #9, backport of the core
// tuya-persistent-local-push work adapted to the external-integration model.
//
// The one-shot localPoll (connect → get → disconnect) pays a full handshake on
// every cycle and caps feedback latency at the poll interval. A persistent
// session keeps ONE socket open per local device and listens to the DPS
// updates the device pushes on change ('data' / 'dp-refresh'), giving
// near-instant LAN state feedback. Polling degrades to a cheap read over the
// live socket (or the fresh push cache).
//
// A Tuya device accepts a SINGLE local session: while a session is open,
// every local operation (poll read AND setValue) must go through it — a
// parallel one-shot connect would fight our own socket.

import { createLogger } from '@gladysassistant/integration-sdk';

import { DEVICE_PARAM_NAME } from '../constants.js';
import { getParamValue } from '../utils/tuya.deviceParams.js';
import { getFeatureCode } from '../utils/tuya.externalId.js';
import { localApiClasses } from './tuya.localPoll.js';
import { recordLocalSuccess } from './tuya.localCircuit.js';
import { formatSocketError } from './tuya.socketError.js';
import { getLocalDpsFromCode, hasDpsKey } from '../device/tuya.localMapping.js';
import { emitLocalDpsStates, publishTransport, TRANSPORT } from '../tuya.poll.js';

const logger = createLogger({ name: 'tuya' });

const CONNECT_TIMEOUT_MS = 5000;
const READ_TIMEOUT_MS = 3000;
// Protocol 3.4/3.5 devices are slower to answer an active read over the live
// socket (session-key crypto per frame): give them the same 5s floor as the
// one-shot localPoll.
const READ_TIMEOUT_NEWGEN_MS = 5000;
const SET_TIMEOUT_MS = 3000;
// A push received this recently makes an active read pointless.
const FRESH_DPS_MS = 5000;
// A device whose session pushed this recently is demonstrably alive on the
// LAN: a timed-out active read then falls back to the pushed cache instead of
// failing the poll to the cloud (which made the Local/Cloud badge yoyo).
const STALE_DPS_OK_MS = 60 * 1000;

/**
 * @description Bound-time guard around a local operation.
 * @param {Promise} promise - Operation to bound.
 * @param {number} ms - Timeout in milliseconds.
 * @param {string} label - Error message on timeout.
 * @returns {Promise} The operation result.
 * @example
 * await withTimeout(api.connect(), 5000, 'Local session connect timeout');
 */
export const withTimeout = (promise, ms, label) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(label)), ms);
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });

const mergeDps = (session, dps) => {
  session.lastDps = { ...(session.lastDps || {}), ...dps };
  session.lastDpsAt = Date.now();
};

// A gateway session (#78) carries the DPS of several sub-devices: one cache
// per node id (`cid`), never mixed.
const getCidCache = (session, cid) => {
  if (!session.cidDps) {
    session.cidDps = new Map();
  }
  if (!session.cidDps.has(cid)) {
    session.cidDps.set(cid, { dps: null, at: 0 });
  }
  return session.cidDps.get(cid);
};

const mergeCidDps = (session, cid, dps) => {
  const cache = getCidCache(session, cid);
  cache.dps = { ...(cache.dps || {}), ...dps };
  cache.at = Date.now();
  // The gateway itself is alive whatever sub-device spoke.
  session.lastDpsAt = cache.at;
};

// Operations over a gateway session run one at a time: several sub-devices
// polled in the same cycle would otherwise interleave their requests on the
// single socket.
const enqueue = (session, operation) => {
  const run = (session.queue || Promise.resolve()).then(operation, operation);
  session.queue = run.catch(() => {});
  return run;
};

/**
 * @description When the gateway session last received the DPS of a node.
 * @param {object} self - The TuyaHandler instance.
 * @param {string} sessionId - The gateway's Tuya id.
 * @param {string} cid - The sub-device's node id.
 * @returns {number} Epoch ms, 0 when never.
 * @example
 * const at = getCidDpsAt(handler, 'gw1', 'a4c1...');
 */
export const getCidDpsAt = (self, sessionId, cid) => {
  const session = self.localSessions && self.localSessions.get(sessionId);
  const cache = session && session.cidDps && session.cidDps.get(cid);
  return cache ? cache.at : 0;
};

/**
 * @description Close a tuyapi instance for real. `disconnect()` early-returns
 * while a connect is still pending (`_connected` false), which would leak the
 * open socket of a stalled handshake: destroy the underlying net.Socket
 * explicitly after it.
 * @param {object} api - Tuyapi / tuyapi-newgen instance.
 * @returns {Promise} Promise of nothing.
 * @example
 * await forceCloseApi(session.api);
 */
export const forceCloseApi = async (api) => {
  if (!api) {
    return;
  }
  try {
    await api.disconnect();
  } catch {
    // ignore
  }
  const socket = api.client || api._client;
  if (socket && typeof socket.destroy === 'function') {
    try {
      socket.destroy();
    } catch {
      // ignore
    }
  }
};

/**
 * @description Get or open the persistent session of a device. Reconnects a
 * dropped session; recreates it when the LAN parameters changed (DHCP).
 * @param {object} payload - Local connection info.
 * @param {string} payload.deviceId - Tuya device id.
 * @param {string} payload.ip - Device LAN IP.
 * @param {string} payload.localKey - Device local key.
 * @param {string} payload.protocolVersion - Local protocol version.
 * @returns {Promise<object>} The connected session.
 * @example
 * const session = await handler.ensureLocalSession({ deviceId, ip, localKey, protocolVersion });
 */
export async function ensureLocalSession(payload) {
  // Single-flight per device: two concurrent callers (a poll and the ~1s
  // feedback poll of a command, for instance) must never both create a
  // session — the second one would orphan the first one's socket while the
  // device only accepts a single local session.
  if (!this.localSessionEnsures) {
    this.localSessionEnsures = new Map();
  }
  const inFlight = this.localSessionEnsures.get(payload.deviceId);
  if (inFlight) {
    return inFlight;
  }
  const run = ensureLocalSessionInner.call(this, payload).finally(() => {
    this.localSessionEnsures.delete(payload.deviceId);
  });
  this.localSessionEnsures.set(payload.deviceId, run);
  return run;
}

async function ensureLocalSessionInner({ deviceId, ip, localKey, protocolVersion, cid }) {
  // A session opened for a sub-device is its gateway's (#78).
  const gateway = Boolean(cid);
  if (!this.localSessions) {
    this.localSessions = new Map();
  }
  let session = this.localSessions.get(deviceId);

  // LAN parameters changed (new DHCP lease, protocol re-detected, device
  // re-paired with a new local key): the old socket points at the wrong
  // place or encrypts with a stale key — drop it and start clean.
  if (
    session &&
    (session.ip !== ip ||
      session.protocolVersion !== protocolVersion ||
      session.localKey !== localKey)
  ) {
    await this.closeLocalSession(deviceId);
    session = null;
  }

  if (!session) {
    const isNewGenProtocol = protocolVersion === '3.4' || protocolVersion === '3.5';
    const apiClasses = this.localApiClasses || localApiClasses;
    const TuyaLocalApi = isNewGenProtocol ? apiClasses.TuyAPINewGen : apiClasses.TuyAPI;
    const api = new TuyaLocalApi({
      id: deviceId,
      key: localKey,
      ip,
      version: protocolVersion,
      // Ask for the full DPS state right at connect: the reply arrives as a
      // 'data' event and flows through the push pipeline, so a device gets
      // its initial states on every session (re)connect — crucial for
      // cloud-blind devices whose active reads are unreliable and which
      // otherwise only report on CHANGE (a freshly created device would show
      // nothing until someone toggled it). DP refresh on ping keeps push
      // data flowing on 3.4/3.5 devices.
      // A gateway has no DP of its own: a bare read or refresh of it never
      // answers, the sub-devices are read with their `cid`.
      issueGetOnConnect: !gateway,
      issueRefreshOnConnect: false,
      issueRefreshOnPing: !gateway,
    });
    session = {
      deviceId,
      ip,
      localKey,
      protocolVersion,
      api,
      connected: false,
      connecting: null,
      lastDps: null,
      lastDpsAt: 0,
      gateway,
    };
    if (typeof api.on === 'function') {
      const onPush = (payload) => {
        const dps = payload && payload.dps;
        if (!dps || typeof dps !== 'object') {
          return;
        }
        const pushCid = payload.cid ? String(payload.cid) : null;
        if (pushCid) {
          mergeCidDps(session, pushCid, dps);
        } else {
          mergeDps(session, dps);
        }
        // The device just talked to us: the LAN link is healthy.
        recordLocalSuccess(this.localCircuit, deviceId);
        this.handleLocalPush(deviceId, dps, pushCid);
      };
      api.on('data', onPush);
      api.on('dp-refresh', onPush);
      api.on('error', (err) => {
        logger.debug(
          `[Tuya][localSession] device=${deviceId} socket error: ${formatSocketError(err, ip)}`,
        );
      });
      api.on('disconnected', () => {
        session.connected = false;
        logger.debug(`[Tuya][localSession] device=${deviceId} disconnected`);
      });
    }
    this.localSessions.set(deviceId, session);
  }

  if (session.connected) {
    return session;
  }
  if (!session.connecting) {
    session.connecting = withTimeout(
      session.api.connect(),
      CONNECT_TIMEOUT_MS,
      'Local session connect timeout',
    )
      .then(() => {
        session.connected = true;
        logger.info(
          `[Tuya][localSession] device=${deviceId} connected (${ip}, ${protocolVersion})`,
        );
      })
      .catch(async (e) => {
        // Never leave a half-open socket: the device would refuse the retry.
        await forceCloseApi(session.api);
        throw e;
      })
      .finally(() => {
        session.connecting = null;
      });
  }
  await session.connecting;
  return session;
}

/**
 * @description Read the DPS map of a device through its persistent session:
 * fresh push cache when available, otherwise an active read over the live
 * socket. This is the poll-facing replacement of the one-shot localPoll.
 * @param {object} payload - Same shape as localPoll.
 * @returns {Promise<{dps: object}>} DPS map.
 * @example
 * const { dps } = await handler.localRead({ deviceId, ip, localKey, protocolVersion });
 */
export async function localRead(payload) {
  const session = await this.ensureLocalSession(payload);
  if (payload.cid) {
    return readSubDevice(session, String(payload.cid));
  }
  if (session.lastDps && Date.now() - session.lastDpsAt < FRESH_DPS_MS) {
    return { dps: session.lastDps };
  }
  const readTimeoutMs =
    session.protocolVersion === '3.4' || session.protocolVersion === '3.5'
      ? READ_TIMEOUT_NEWGEN_MS
      : READ_TIMEOUT_MS;
  try {
    const data = await withTimeout(
      session.api.get({ schema: true }),
      readTimeoutMs,
      'Local poll timeout',
    );
    if (!data || typeof data !== 'object' || !data.dps) {
      throw new Error('Invalid local read response');
    }
    mergeDps(session, data.dps);
    return { dps: data.dps };
  } catch (e) {
    // Some devices push reliably but answer active reads erratically: when
    // the session pushed recently, serve the pushed cache and KEEP the
    // session — the socket is demonstrably alive, and failing the poll to
    // the cloud would just flap the Local/Cloud badge.
    if (session.lastDps && Date.now() - session.lastDpsAt < STALE_DPS_OK_MS) {
      logger.debug(
        `[Tuya][localSession] device=${session.deviceId} read failed (${e.message}); serving recent pushed cache`,
      );
      return { dps: session.lastDps };
    }
    // A failed read over a silent socket usually means the socket is gone:
    // drop the session so the next attempt reconnects from scratch.
    session.connected = false;
    await forceCloseApi(session.api);
    throw e;
  }
}

// The first outcome of each kind per node, at info level: what a user
// reports when a Zigbee device does not go local, without flooding the logs.
const logSubDeviceRead = (session, cid, outcome) => {
  const kind = outcome.startsWith('read OK') ? 'ok' : 'failed';
  session.loggedCidOutcomes = session.loggedCidOutcomes || new Set();
  const key = `${cid}:${kind}`;
  if (session.loggedCidOutcomes.has(key)) {
    return;
  }
  session.loggedCidOutcomes.add(key);
  logger.info(
    `[Tuya][localSession] gateway=${session.deviceId} (${session.protocolVersion}) sub-device cid=${cid}: ${outcome}`,
  );
};

// Read one sub-device through its gateway session (#78): the fresh pushed
// cache of its node, else an active read addressed with its `cid`.
async function readSubDevice(session, cid) {
  const cache = getCidCache(session, cid);
  if (cache.dps && Date.now() - cache.at < FRESH_DPS_MS) {
    return { dps: cache.dps };
  }
  const readTimeoutMs =
    session.protocolVersion === '3.4' || session.protocolVersion === '3.5'
      ? READ_TIMEOUT_NEWGEN_MS
      : READ_TIMEOUT_MS;
  try {
    const data = await enqueue(session, () =>
      withTimeout(session.api.get({ schema: true, cid }), readTimeoutMs, 'Local poll timeout'),
    );
    if (!data || typeof data !== 'object' || !data.dps) {
      throw new Error(
        typeof data === 'string'
          ? `Invalid local read response: ${data}`
          : 'Invalid local read response',
      );
    }
    mergeCidDps(session, cid, data.dps);
    logSubDeviceRead(session, cid, `read OK (${Object.keys(data.dps).length} DPS)`);
    return { dps: data.dps };
  } catch (e) {
    logSubDeviceRead(session, cid, `read failed: ${e.message}`);
    // A sleeping battery sensor never answers a read, but the gateway pushes
    // its reports: serve them while recent. The gateway session itself stays
    // open — its other sub-devices use it.
    if (cache.dps && Date.now() - cache.at < STALE_DPS_OK_MS) {
      return { dps: cache.dps };
    }
    throw e;
  }
}

/**
 * @description Set a DPS value through the persistent session when one is
 * live. Returns false when no live session exists (caller falls back to the
 * one-shot path).
 * @param {string} deviceId - Tuya device id.
 * @param {number|string} dpsKey - DPS index to set.
 * @param {*} value - Transformed value.
 * @returns {Promise<boolean>} True when the set went through the session.
 * @example
 * const done = await handler.localSessionSet('dev1', 1, true);
 */
export async function localSessionSet(deviceId, dpsKey, value, cid = null) {
  const session = this.localSessions && this.localSessions.get(deviceId);
  if (!session || !session.connected) {
    return false;
  }
  try {
    const options = cid ? { dps: dpsKey, set: value, cid } : { dps: dpsKey, set: value };
    const send = () => withTimeout(session.api.set(options), SET_TIMEOUT_MS, 'Local set timeout');
    await (session.gateway ? enqueue(session, send) : send());
    logger.debug(
      `[Tuya][localSession] device=${deviceId}${cid ? ` cid=${cid}` : ''} set dps=${dpsKey} value=${value}`,
    );
    return true;
  } catch (e) {
    logger.warn(`[Tuya][localSession] set failed for device=${deviceId}: ${e.message}`);
    // A gateway session serves its other sub-devices: only a plain device
    // session is torn down on a failed command.
    if (session.gateway) {
      throw e;
    }
    session.connected = false;
    await forceCloseApi(session.api);
    // The session was supposed to own the local slot and failed: let the
    // caller fall back to the cloud rather than fight for the socket.
    throw e;
  }
}

/**
 * @description Handle a DPS push received on a persistent session: map the
 * DPS to the created device features and publish the states immediately —
 * this is the near-instant LAN state feedback of issue #9.
 * @param {string} deviceId - Tuya device id.
 * @param {object} dps - Pushed DPS map (partial).
 * @returns {Promise} Promise of nothing.
 * @example
 * await handler.handleLocalPush('dev1', { 1: true });
 */
// Ported from the core fix "throttle continuous-sensor states pushed by
// persistent connections": a running device can push several DP updates per
// second (an AC ambient sensor flapping between two tenths), flooding the DB,
// websockets and scene triggers with states the 10s poll used to naturally
// cap. Continuous sensors are capped to one push-driven emission per 10s per
// feature; event-like features (switches, modes, target temperature) stay
// instantaneous.
const CONTINUOUS_SENSOR_TYPES = new Set([
  'decimal',
  'integer',
  'power',
  'energy',
  'voltage',
  'current',
  'index',
  'index-today',
]);
const PUSH_CONTINUOUS_EMIT_INTERVAL_MS = 10 * 1000;

const filterThrottledContinuousDps = (session, device, dps, cid = null) => {
  if (!session) {
    return dps;
  }
  const now = Date.now();
  session.continuousEmitAt = session.continuousEmitAt || {};
  const filtered = { ...dps };
  const deviceFeatures = Array.isArray(device.features) ? device.features : [];
  deviceFeatures.forEach((deviceFeature) => {
    if (!CONTINUOUS_SENSOR_TYPES.has(deviceFeature.type)) {
      return;
    }
    const code = getFeatureCode(deviceFeature);
    const dpsKey = getLocalDpsFromCode(code, device);
    if (dpsKey === null || !hasDpsKey(filtered, dpsKey)) {
      return;
    }
    // Per node on a gateway session: sub-devices share their codes.
    const throttleKey = cid ? `${cid}:${code}` : code;
    const lastEmitAt = session.continuousEmitAt[throttleKey];
    if (lastEmitAt !== undefined && now - lastEmitAt < PUSH_CONTINUOUS_EMIT_INTERVAL_MS) {
      delete filtered[String(dpsKey)];
      delete filtered[dpsKey];
      return;
    }
    session.continuousEmitAt[throttleKey] = now;
  });
  return filtered;
};

export async function handleLocalPush(deviceId, dps, cid = null) {
  try {
    const devices = (this.gladys && this.gladys.devices) || [];
    // A push of a gateway session (#78) names the sub-device by its node id.
    const device = devices.find((d) => {
      const params = d && d.params;
      if (cid) {
        return (
          getParamValue(params, DEVICE_PARAM_NAME.GATEWAY_ID) === deviceId &&
          String(getParamValue(params, DEVICE_PARAM_NAME.NODE_ID)) === cid
        );
      }
      return getParamValue(params, DEVICE_PARAM_NAME.DEVICE_ID) === deviceId;
    });
    if (!device) {
      return;
    }
    const session = this.localSessions && this.localSessions.get(deviceId);
    const throttledDps = filterThrottledContinuousDps(session, device, dps, cid);
    const pending = [];
    const { localChanged } = emitLocalDpsStates(this, device, throttledDps, pending);
    publishTransport(this, device, TRANSPORT.LOCAL);
    await Promise.all(pending);
    if (localChanged > 0) {
      logger.info(
        `[Tuya][push] device=${deviceId}${cid ? ` cid=${cid}` : ''} local push published ${localChanged} change(s)`,
      );
    }
  } catch (e) {
    logger.warn(`[Tuya][push] failed to publish push for device=${deviceId}`, e);
  }
}

/**
 * @description Close and forget the persistent session of a device.
 * @param {string} deviceId - Tuya device id.
 * @returns {Promise} Promise of nothing.
 * @example
 * await handler.closeLocalSession('dev1');
 */
export async function closeLocalSession(deviceId) {
  const session = this.localSessions && this.localSessions.get(deviceId);
  if (!session) {
    return;
  }
  this.localSessions.delete(deviceId);
  session.connected = false;
  await forceCloseApi(session.api);
  logger.debug(`[Tuya][localSession] device=${deviceId} closed`);
}

/**
 * @description Close every persistent session (shutdown, disconnect, local
 * mode turned off).
 * @returns {Promise} Promise of nothing.
 * @example
 * await handler.closeAllLocalSessions();
 */
export async function closeAllLocalSessions() {
  if (!this.localSessions) {
    return;
  }
  const ids = [...this.localSessions.keys()];
  await Promise.all(ids.map((deviceId) => this.closeLocalSession(deviceId)));
}
