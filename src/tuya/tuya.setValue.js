// Ported from server/services/tuya/lib/tuya.setValue.js.
//
// The local (LAN) path is tried first when the device opted in through
// LOCAL_OVERRIDE and its local parameters are complete; the cloud command is
// the fallback, as in the core service.

import {
  createLogger,
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
} from '@gladysassistant/integration-sdk';

import { API, DEVICE_PARAM_NAME } from './constants.js';
import {
  CAMERA_MOVE,
  TUYA_PTZ_DIRECTION_BY_MOVE,
  writeValues,
} from './device/tuya.deviceMapping.js';
import { getTuyaDeviceId, getFeatureCode } from './utils/tuya.externalId.js';
import { getParamValue } from './utils/tuya.deviceParams.js';
import { getLocalDpsFromCode } from './device/tuya.localMapping.js';
import { localApiClasses } from './local/tuya.localPoll.js';
import { isLocalInCooldown } from './local/tuya.localCircuit.js';
import { formatSocketError } from './local/tuya.socketError.js';
import { withTimeout, forceCloseApi } from './local/tuya.localSession.js';
import { getFeatureWithFallbackScale, resolveFeatureMappingEntry } from './tuya.poll.js';

const logger = createLogger({ name: 'tuya' });

const FEEDBACK_POLL_DELAY_MS = 1000;

// PTZ watchdog (camera-ptz-control spec, "Safety rule"): a Tuya `ptz_control`
// keeps turning until `ptz_stop`. Every move is bounded: if no stop arrives
// (lost release, a lone value sent by a scene), the camera is stopped after
// this delay — short on purpose, so a lone value behaves like a step.
const PTZ_WATCHDOG_MS = 2000;

// After a successful command, re-read the device shortly after so Gladys
// shows the confirmed state (has_feedback), as the core PR8 does. The poll is
// fire-and-forget: a command must not block on it, and the timer is unref'd
// so it never keeps the process alive.
const scheduleFeedbackPoll = (self, device, reason) => {
  if (!self || typeof self.poll !== 'function' || !device || !device.external_id) {
    return;
  }
  const delayMs = Number.isFinite(self.feedbackPollDelayMs)
    ? self.feedbackPollDelayMs
    : FEEDBACK_POLL_DELAY_MS;
  const timer = setTimeout(() => {
    self.poll(device).catch((e) => {
      logger.debug(`[Tuya][setValue] feedback poll failed after ${reason}`, e);
    });
  }, delayMs);
  if (typeof timer.unref === 'function') {
    timer.unref();
  }
};

/**
 * @description Send the new device value over device protocol.
 * @param {object} device - Updated Gladys device.
 * @param {object} deviceFeature - Updated Gladys device feature.
 * @param {string|number} value - The new device feature value.
 * @example
 * await handler.setValue(device, deviceFeature, 0);
 */
export async function setValue(device, deviceFeature, value) {
  const externalId = deviceFeature.external_id;
  const topic = getTuyaDeviceId(device);
  const command = getFeatureCode(deviceFeature);

  if (!command || command.trim().length === 0) {
    throw new Error(`Tuya device external_id is invalid: "${externalId}" have no command`);
  }

  if (
    deviceFeature.category === DEVICE_FEATURE_CATEGORIES.CAMERA &&
    deviceFeature.type === DEVICE_FEATURE_TYPES.CAMERA.MOVE
  ) {
    await movePtz(this, device, topic, value);
    return;
  }

  const writeCategory = writeValues[deviceFeature.category];
  const writeFn = writeCategory ? writeCategory[deviceFeature.type] : null;
  // The feature is passed along for scale-aware transforms (e.g. an AC target
  // temperature with scale 1 stores 20.0 degrees as 200). Gladys does not
  // persist the scale, so restore it from the device-type mapping first. The
  // mapping entry gives the writer per-variant metadata (e.g. the tuyaEnum
  // pilot-wire vocabulary).
  const featureWithScale = getFeatureWithFallbackScale(device, deviceFeature, command);
  const mappingEntry = resolveFeatureMappingEntry(device, command);
  const transformedValue = writeFn ? writeFn(value, featureWithScale, mappingEntry) : value;
  if (writeFn && transformedValue === undefined) {
    // e.g. a pilot-wire mode the device vocabulary does not support (OFF on a
    // device whose on/off is a separate switch DPS): reject instead of
    // sending garbage to the device.
    throw new Error(
      `Tuya: value "${value}" is not supported for command "${command}" on device "${topic}"`,
    );
  }
  logger.debug(`Change value for devices ${topic}/${command} to value ${transformedValue}...`);

  await sendCommand(this, device, topic, command, transformedValue);
}

/**
 * @description Send one command (Tuya code + device value) over the LAN when
 * the device is locally reachable, the cloud otherwise.
 * @param {object} self - The Tuya handler.
 * @param {object} device - The Gladys device.
 * @param {string} topic - The Tuya device id.
 * @param {string} command - The Tuya code.
 * @param {*} value - The value, already in the device vocabulary.
 * @param {object} [options] - Options.
 * @param {boolean} [options.feedback] - Poll the device right after, to
 * publish the resulting state (off for command-only codes like PTZ).
 * @returns {Promise<void>} Resolves once sent.
 * @example
 * await sendCommand(handler, device, 'dev1', 'switch_1', true);
 */
async function sendCommand(self, device, topic, command, value, { feedback = true } = {}) {
  const params = device.params || [];
  const ipAddress = getParamValue(params, DEVICE_PARAM_NAME.IP_ADDRESS);
  const localKey = getParamValue(params, DEVICE_PARAM_NAME.LOCAL_KEY);
  const protocolVersionRaw = getParamValue(params, DEVICE_PARAM_NAME.PROTOCOL_VERSION);
  const protocolVersion =
    protocolVersionRaw !== null && protocolVersionRaw !== undefined
      ? String(protocolVersionRaw).trim()
      : undefined;
  // Follow the same live "Mode local (LAN)" toggle as poll(): command a device
  // over the LAN only when the toggle is on AND the device is locally reachable.
  // Also honour the poll circuit breaker: if local polling parked this device
  // (repeated timeouts), send the command straight over the cloud instead of
  // hanging on a doomed 3s local connect.
  const localModeEnabled = Boolean(self.config && self.config.localMode === true);
  const localParked = self.localCircuit && isLocalInCooldown(self.localCircuit, topic, Date.now());
  const hasLocalConfig = Boolean(
    ipAddress && localKey && protocolVersion && localModeEnabled && !localParked,
  );

  const localDps = getLocalDpsFromCode(command, device);

  // A Tuya device accepts a SINGLE local session. When our persistent session
  // (issue #9) exists — live OR mid-reconnect — the command MUST go through
  // it: a parallel one-shot connect would fight our own socket. On any
  // session failure the command falls through to the shared cloud block.
  const hasSession = Boolean(
    self.localSessions &&
    self.localSessions.has(topic) &&
    typeof self.localSessionSet === 'function',
  );
  if (hasLocalConfig && localDps !== null && hasSession) {
    try {
      if (typeof self.ensureLocalSession === 'function') {
        // (Re)join the session first: a session that is reconnecting must not
        // be raced with a competing connect (single local slot).
        await self.ensureLocalSession({
          deviceId: topic,
          ip: ipAddress,
          localKey,
          protocolVersion,
        });
      }
      const done = await self.localSessionSet(topic, localDps, value);
      if (done) {
        // No feedback poll here: the persistent session pushes the DPS
        // change (~1s) on its own.
        return;
      }
    } catch (e) {
      logger.info(
        `[Tuya][setValue] session command failed for device=${topic} (${e.message}); falling back to cloud`,
      );
    }
  } else if (hasLocalConfig && localDps !== null) {
    const isProtocol34 = protocolVersion === '3.4';
    const isProtocol35 = protocolVersion === '3.5';
    const isNewGenProtocol = isProtocol34 || isProtocol35;
    const apiClasses = self.localApiClasses || localApiClasses;
    const TuyaLocalApi = isNewGenProtocol ? apiClasses.TuyAPINewGen : apiClasses.TuyAPI;
    const tuyaOptions = {
      id: topic,
      key: localKey,
      ip: ipAddress,
      version: protocolVersion,
      issueGetOnConnect: false,
      issueRefreshOnConnect: false,
      issueRefreshOnPing: false,
    };
    if (isProtocol35) {
      tuyaOptions.keepAlive = false;
    }
    const runLocalSet = async () => {
      const tuyaLocal = new TuyaLocalApi(tuyaOptions);
      // Absorb async socket errors so they do not bubble up as uncaughtException
      // when the device drops the connection mid-command. The stub-friendly
      // guard keeps tests working when their TuyAPI stub does not implement on().
      if (typeof tuyaLocal.on === 'function') {
        tuyaLocal.on('error', (err) => {
          logger.info(
            `[Tuya][setValue][local] socket error for device=${topic}: ${formatSocketError(err, ipAddress)}`,
          );
        });
      }
      try {
        // Bound both steps: a stalled handshake (device slot held by another
        // controller) must fall back to the cloud, not hang the command.
        await withTimeout(tuyaLocal.connect(), 5000, 'Local set connect timeout');
        await withTimeout(tuyaLocal.set({ dps: localDps, set: value }), 3000, 'Local set timeout');
        logger.debug(`[Tuya][setValue][local] device=${topic} dps=${localDps} value=${value}`);
        return true;
      } catch (e) {
        logger.warn(`[Tuya][setValue][local] failed, fallback to cloud`, e);
        return false;
      } finally {
        // Always close the socket for real — even when connect() stalled (a
        // plain disconnect() no-ops while a connect is pending) — so the
        // device does not refuse subsequent local connections.
        await forceCloseApi(tuyaLocal);
      }
    };

    const localSuccess = await runLocalSet();
    if (localSuccess) {
      if (feedback) {
        scheduleFeedbackPoll(self, device, 'local command');
      }
      return;
    }
  }

  if (!self.connector || typeof self.connector.request !== 'function') {
    logger.warn(
      `[Tuya][setValue][cloud] connector unavailable for device=${topic} (cloud disconnected); local set did not succeed and no fallback is possible`,
    );
    return;
  }

  const response = await self.connector.request({
    method: 'POST',
    path: `${API.VERSION_1_0}/devices/${topic}/commands`,
    body: {
      commands: [
        {
          code: command,
          value: value,
        },
      ],
    },
  });
  logger.debug(`[Tuya][setValue] ${JSON.stringify(response)}`);
  if (feedback) {
    scheduleFeedbackPoll(self, device, 'cloud command');
  }
}

/**
 * @description Move a Tuya PTZ camera (issue #26): `camera.move` value 1-4 ->
 * `ptz_control` direction, bounded by the watchdog; 0 -> `ptz_stop`. A new
 * move replaces the running one (and its watchdog).
 * @param {object} self - The Tuya handler.
 * @param {object} device - The Gladys device.
 * @param {string} topic - The Tuya device id.
 * @param {number|string} value - The CAMERA_MOVE value.
 * @returns {Promise<void>} Resolves once the command is sent.
 * @example
 * await movePtz(handler, device, 'cam1', CAMERA_MOVE.PAN_LEFT);
 */
async function movePtz(self, device, topic, value) {
  const move = parseInt(value, 10);
  if (!self.ptzWatchdogs) {
    self.ptzWatchdogs = new Map();
  }
  clearTimeout(self.ptzWatchdogs.get(topic));
  self.ptzWatchdogs.delete(topic);

  if (move === CAMERA_MOVE.STOP) {
    await sendCommand(self, device, topic, 'ptz_stop', true, { feedback: false });
    return;
  }
  const direction = TUYA_PTZ_DIRECTION_BY_MOVE[move];
  if (direction === undefined) {
    throw new Error(`Tuya: camera move "${value}" is not supported on device "${topic}"`);
  }
  await sendCommand(self, device, topic, 'ptz_control', direction, { feedback: false });
  const watchdogMs = Number.isFinite(self.ptzWatchdogMs) ? self.ptzWatchdogMs : PTZ_WATCHDOG_MS;
  const timer = setTimeout(() => {
    self.ptzWatchdogs.delete(topic);
    sendCommand(self, device, topic, 'ptz_stop', true, { feedback: false }).catch((e) => {
      logger.warn(`[Tuya][ptz] watchdog stop failed for device=${topic}`, e);
    });
  }, watchdogMs);
  if (typeof timer.unref === 'function') {
    timer.unref();
  }
  self.ptzWatchdogs.set(topic, timer);
}
