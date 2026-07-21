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
  // Release every persistent local session (a Tuya device only accepts one
  // local connection: never leave sockets behind).
  if (typeof this.closeAllLocalSessions === 'function') {
    this.closeAllLocalSessions().catch(() => {});
  }
  this.connector = null;
  this.status = STATUS.NOT_INITIALIZED;
  this.lastError = null;
}
