// Ported from server/services/tuya/lib/tuya.disconnect.js (the websocket
// status broadcast of the core is replaced by a log).

import { createLogger } from '@gladysassistant/integration-sdk';

import { STATUS } from './constants.js';

const logger = createLogger({ name: 'tuya' });

/**
 * @description Disconnects service and dependencies. Awaitable: callers that
 * reconnect right after (config change) must wait for the local sockets to be
 * really closed, or the fresh sessions race the old ones for the devices'
 * single local slot. Fire-and-forget callers can ignore the promise (it never
 * rejects).
 * @param {object} [options] - Disconnect options.
 * @param {boolean} [options.manual] - Whether this is a manual disconnect.
 * @returns {Promise} Promise of nothing.
 * @example
 * await handler.disconnect();
 */
export async function disconnect(options = {}) {
  const { manual = false } = options;
  logger.info(`Disconnecting from Tuya... (manual=${manual})`);
  this.stopReconnect();
  this.connector = null;
  this.status = STATUS.NOT_INITIALIZED;
  this.lastError = null;
  // Release every persistent local session (a Tuya device only accepts one
  // local connection: never leave sockets behind).
  if (typeof this.closeAllLocalSessions === 'function') {
    try {
      await this.closeAllLocalSessions();
    } catch {
      // never let teardown errors mask the disconnect
    }
  }
}
