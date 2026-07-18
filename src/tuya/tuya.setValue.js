// Ported from server/services/tuya/lib/tuya.setValue.js (cloud path).
//
// The local (LAN) set path arrives with the local-mode PR.

import { createLogger } from '@gladysassistant/integration-sdk';

import { API } from './constants.js';
import { writeValues } from './device/tuya.deviceMapping.js';
import { getTuyaDeviceId, getFeatureCode } from './utils/tuya.externalId.js';

const logger = createLogger({ name: 'tuya' });

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
  const transformedValue = writeFn ? writeFn(value) : value;
  logger.debug(`Change value for devices ${topic}/${command} to value ${transformedValue}...`);

  if (!this.connector || typeof this.connector.request !== 'function') {
    logger.warn(
      `[Tuya][setValue][cloud] connector unavailable for device=${topic} (cloud disconnected)`,
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
}
