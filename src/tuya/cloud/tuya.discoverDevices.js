// Ported from server/services/tuya/lib/tuya.discoverDevices.js.
//
// Differences with the core service:
// - the websocket status broadcasts are replaced by logs;
// - the merge with the devices already created in Gladys (stateManager /
//   mergeDevices) is not needed: `publishDiscoveredDevices` upserts by
//   external_id on the core side;
// - the result is the list of raw Tuya devices (list entry + details); the
//   conversion to the Gladys device format is done by the caller.

import { createLogger } from '@gladysassistant/integration-sdk';

import { STATUS } from '../constants.js';

const logger = createLogger({ name: 'tuya' });

/**
 * @description Discover Tuya cloud devices.
 * @returns {Promise<Array>} List of discovered Tuya devices (raw, with details).
 * @example
 * await handler.discoverDevices();
 */
export async function discoverDevices() {
  logger.debug('Looking for Tuya devices...');
  if (this.status !== STATUS.CONNECTED) {
    throw new Error('Unable to discover Tuya devices until service is not well configured');
  }

  // Reset already discovered devices
  this.discoveredDevices = [];
  this.status = STATUS.DISCOVERING_DEVICES;

  let devices = [];
  try {
    devices = await this.loadDevices();
    logger.info(`${devices.length} Tuya devices found`);
  } catch (e) {
    logger.error('Unable to load Tuya devices', e);
  }

  this.discoveredDevices = await Promise.allSettled(
    devices.map((device) => this.loadDeviceDetails(device)),
  ).then((results) =>
    results.filter((result) => result.status === 'fulfilled').map((result) => result.value),
  );

  // Cloud discovery only knows the public IP of the device: keep it as
  // cloud_ip and reset the LAN-related fields (filled by the local scan).
  this.discoveredDevices = this.discoveredDevices.map((device) => {
    const cloudIp = device.cloud_ip || device.ip;
    return {
      ...device,
      cloud_ip: cloudIp,
      ip: null,
      protocol_version: null,
      local_override: false,
    };
  });

  this.status = STATUS.CONNECTED;

  return this.discoveredDevices;
}
