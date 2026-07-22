// Per-device state cleanup when a device is deleted (or renamed/updated) in
// Gladys. Without it, a deleted local device leaks its persistent session
// forever: the socket stays open (occupying the device's SINGLE local slot,
// blocking any other LAN controller), and the per-device maps keep their
// entries until the container restarts.

import { createLogger } from '@gladysassistant/integration-sdk';

import { DEVICE_PARAM_NAME } from './constants.js';
import { getParamValue } from './utils/tuya.deviceParams.js';
import { getTuyaDeviceId } from './utils/tuya.externalId.js';

const logger = createLogger({ name: 'tuya' });

/**
 * @description Release everything the handler holds for a device: persistent
 * local session, circuit-breaker state, transport badge cache and feature
 * state cache.
 * @param {object} device - The Gladys device (as sent by the device-deleted
 * event: external_id + params at minimum).
 * @returns {Promise} Promise of nothing.
 * @example
 * await handler.cleanupDevice(device);
 */
export async function cleanupDevice(device) {
  if (!device) {
    return;
  }
  const deviceId =
    getParamValue(device.params, DEVICE_PARAM_NAME.DEVICE_ID) || getTuyaDeviceId(device);
  const externalId = device.external_id;

  if (deviceId && typeof this.closeLocalSession === 'function') {
    await this.closeLocalSession(deviceId);
  }
  if (deviceId && this.localCircuit) {
    this.localCircuit.delete(deviceId);
  }
  if (externalId && this.lastTransports) {
    this.lastTransports.delete(externalId);
  }
  if (externalId && this.featureStates) {
    const prefix = `${externalId}:`;
    [...this.featureStates.keys()]
      .filter((key) => typeof key === 'string' && key.startsWith(prefix))
      .forEach((key) => this.featureStates.delete(key));
  }
  logger.info(`[Tuya][cleanup] released per-device state for ${deviceId || externalId}`);
}
