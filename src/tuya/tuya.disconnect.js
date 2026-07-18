// Ported from server/services/tuya/lib/tuya.disconnect.js (the websocket
// status broadcast of the core is replaced by a log).

import { createLogger } from '@gladysassistant/integration-sdk';

import { STATUS } from './constants.js';

const logger = createLogger({ name: 'tuya' });

/**
 * @description Disconnects service and dependencies.
 * @param {object} [options] - Disconnect options.
 * @param {boolean} [options.manual] - Whether this is a manual disconnect.
 * @example
 * handler.disconnect();
 */
export function disconnect(options = {}) {
  const { manual = false } = options;
  logger.info(`Disconnecting from Tuya... (manual=${manual})`);
  this.stopReconnect();
  this.connector = null;
  this.status = STATUS.NOT_INITIALIZED;
  this.lastError = null;
}
