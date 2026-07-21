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
import { localApiClasses } from './tuya.localPoll.js';
import { recordLocalSuccess } from './tuya.localCircuit.js';
import { emitLocalDpsStates, publishTransport, TRANSPORT } from '../tuya.poll.js';

const logger = createLogger({ name: 'tuya' });

const CONNECT_TIMEOUT_MS = 5000;
const READ_TIMEOUT_MS = 3000;
const SET_TIMEOUT_MS = 3000;
// A push received this recently makes an active read pointless.
const FRESH_DPS_MS = 5000;

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
export async function ensureLocalSession({ deviceId, ip, localKey, protocolVersion }) {
  if (!this.localSessions) {
    this.localSessions = new Map();
  }
  let session = this.localSessions.get(deviceId);

  // LAN parameters changed (new DHCP lease, protocol re-detected): the old
  // socket points at the wrong place — drop it and start clean.
  if (session && (session.ip !== ip || session.protocolVersion !== protocolVersion)) {
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
      // The session is long-lived: no get on connect (the first poll reads),
      // and DP refresh on ping keeps push data flowing on 3.4/3.5 devices.
      issueGetOnConnect: false,
      issueRefreshOnConnect: false,
      issueRefreshOnPing: true,
    });
    session = {
      deviceId,
      ip,
      protocolVersion,
      api,
      connected: false,
      connecting: null,
      lastDps: null,
      lastDpsAt: 0,
    };
    if (typeof api.on === 'function') {
      const onPush = (payload) => {
        const dps = payload && payload.dps;
        if (!dps || typeof dps !== 'object') {
          return;
        }
        mergeDps(session, dps);
        // The device just talked to us: the LAN link is healthy.
        recordLocalSuccess(this.localCircuit, deviceId);
        this.handleLocalPush(deviceId, dps);
      };
      api.on('data', onPush);
      api.on('dp-refresh', onPush);
      api.on('error', (err) => {
        logger.debug(
          `[Tuya][localSession] device=${deviceId} socket error: ${err && err.message ? err.message : err}`,
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
        try {
          await session.api.disconnect();
        } catch {
          // ignore
        }
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
  if (session.lastDps && Date.now() - session.lastDpsAt < FRESH_DPS_MS) {
    return { dps: session.lastDps };
  }
  try {
    const data = await withTimeout(
      session.api.get({ schema: true }),
      READ_TIMEOUT_MS,
      'Local poll timeout',
    );
    if (!data || typeof data !== 'object' || !data.dps) {
      throw new Error('Invalid local read response');
    }
    mergeDps(session, data.dps);
    return { dps: data.dps };
  } catch (e) {
    // A failed read over a live socket usually means the socket is gone:
    // drop the session so the next attempt reconnects from scratch.
    session.connected = false;
    try {
      await session.api.disconnect();
    } catch {
      // ignore
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
export async function localSessionSet(deviceId, dpsKey, value) {
  const session = this.localSessions && this.localSessions.get(deviceId);
  if (!session || !session.connected) {
    return false;
  }
  try {
    await withTimeout(
      session.api.set({ dps: dpsKey, set: value }),
      SET_TIMEOUT_MS,
      'Local set timeout',
    );
    logger.debug(`[Tuya][localSession] device=${deviceId} set dps=${dpsKey} value=${value}`);
    return true;
  } catch (e) {
    logger.warn(`[Tuya][localSession] set failed for device=${deviceId}: ${e.message}`);
    session.connected = false;
    try {
      await session.api.disconnect();
    } catch {
      // ignore
    }
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
export async function handleLocalPush(deviceId, dps) {
  try {
    const devices = (this.gladys && this.gladys.devices) || [];
    const device = devices.find(
      (d) => getParamValue(d && d.params, DEVICE_PARAM_NAME.DEVICE_ID) === deviceId,
    );
    if (!device) {
      return;
    }
    const pending = [];
    const { localChanged } = emitLocalDpsStates(this, device, dps, pending);
    publishTransport(this, device, TRANSPORT.LOCAL);
    await Promise.all(pending);
    if (localChanged > 0) {
      logger.info(`[Tuya][push] device=${deviceId} local push published ${localChanged} change(s)`);
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
  try {
    await session.api.disconnect();
  } catch {
    // ignore
  }
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
