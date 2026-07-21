// Ported from server/services/tuya/lib/tuya.setValue.js.
//
// The local (LAN) path is tried first when the device opted in through
// LOCAL_OVERRIDE and its local parameters are complete; the cloud command is
// the fallback, as in the core service.

import { createLogger } from '@gladysassistant/integration-sdk';

import { API, DEVICE_PARAM_NAME } from './constants.js';
import { writeValues } from './device/tuya.deviceMapping.js';
import { getTuyaDeviceId, getFeatureCode } from './utils/tuya.externalId.js';
import { getParamValue } from './utils/tuya.deviceParams.js';
import { getLocalDpsFromCode } from './device/tuya.localMapping.js';
import { localApiClasses } from './local/tuya.localPoll.js';
import { isLocalInCooldown } from './local/tuya.localCircuit.js';
import { formatSocketError } from './local/tuya.socketError.js';
import { getFeatureWithFallbackScale, resolveFeatureMappingEntry } from './tuya.poll.js';

const logger = createLogger({ name: 'tuya' });

const FEEDBACK_POLL_DELAY_MS = 1000;

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
  const localModeEnabled = Boolean(this.config && this.config.localMode === true);
  const localParked = this.localCircuit && isLocalInCooldown(this.localCircuit, topic, Date.now());
  const hasLocalConfig = Boolean(
    ipAddress && localKey && protocolVersion && localModeEnabled && !localParked,
  );

  const localDps = getLocalDpsFromCode(command, device);

  // A Tuya device accepts a SINGLE local session. When our persistent session
  // (issue #9) holds it, the command MUST go through that session — a parallel
  // one-shot connect would fight our own socket.
  if (hasLocalConfig && localDps !== null && typeof this.localSessionSet === 'function') {
    const session = this.localSessions && this.localSessions.get(topic);
    if (session && session.connected) {
      try {
        const done = await this.localSessionSet(topic, localDps, transformedValue);
        if (done) {
          // No feedback poll here: the persistent session pushes the DPS
          // change (~1s) on its own.
          return;
        }
      } catch {
        // Session set failed (socket dropped mid-command): fall through to the
        // cloud below — do NOT open a competing one-shot local connection.
        if (this.connector && typeof this.connector.request === 'function') {
          const response = await this.connector.request({
            method: 'POST',
            path: `${API.VERSION_1_0}/devices/${topic}/commands`,
            body: { commands: [{ code: command, value: transformedValue }] },
          });
          logger.debug(`[Tuya][setValue] ${JSON.stringify(response)}`);
          scheduleFeedbackPoll(this, device, 'cloud fallback command');
        } else {
          logger.warn(
            `[Tuya][setValue] session set failed for device=${topic} and no cloud fallback is available`,
          );
        }
        return;
      }
    }
  }

  if (hasLocalConfig && localDps !== null) {
    const isProtocol34 = protocolVersion === '3.4';
    const isProtocol35 = protocolVersion === '3.5';
    const isNewGenProtocol = isProtocol34 || isProtocol35;
    const apiClasses = this.localApiClasses || localApiClasses;
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
        await tuyaLocal.connect();
        await tuyaLocal.set({ dps: localDps, set: transformedValue });
        logger.debug(
          `[Tuya][setValue][local] device=${topic} dps=${localDps} value=${transformedValue}`,
        );
        return true;
      } catch (e) {
        logger.warn(`[Tuya][setValue][local] failed, fallback to cloud`, e);
        return false;
      } finally {
        // Always close the socket — even if connect() failed — so the device
        // does not refuse subsequent local connections (cascading ECONNRESET).
        try {
          await tuyaLocal.disconnect();
        } catch (disconnectError) {
          logger.warn('[Tuya][setValue][local] disconnect failed', disconnectError);
        }
      }
    };

    const localSuccess = await runLocalSet();
    if (localSuccess) {
      scheduleFeedbackPoll(this, device, 'local command');
      return;
    }
  }

  if (!this.connector || typeof this.connector.request !== 'function') {
    logger.warn(
      `[Tuya][setValue][cloud] connector unavailable for device=${topic} (cloud disconnected); local set did not succeed and no fallback is possible`,
    );
    return;
  }

  const response = await this.connector.request({
    method: 'POST',
    path: `${API.VERSION_1_0}/devices/${topic}/commands`,
    body: {
      commands: [
        {
          code: command,
          value: transformedValue,
        },
      ],
    },
  });
  logger.debug(`[Tuya][setValue] ${JSON.stringify(response)}`);
  scheduleFeedbackPoll(this, device, 'cloud command');
}
