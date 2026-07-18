// Ported from server/services/tuya/lib/tuya.getStatus.js.
//
// The configuration and manual-disconnect flags come from the handler memory
// (config / manualDisconnect) instead of the Gladys variable store.

import { isConfigured } from '../config.js';
import { STATUS } from './constants.js';

/**
 * @description Get Tuya connection and configuration status.
 * @returns {Promise<object>} Status object.
 * @example
 * const status = await handler.getStatus();
 */
export async function getStatus() {
  const configured = Boolean(this.config && isConfigured(this.config));

  return {
    status: this.status || STATUS.NOT_INITIALIZED,
    connected: this.status === STATUS.CONNECTED,
    configured,
    error: this.lastError,
    manual_disconnect: this.manualDisconnectEnabled === true,
  };
}
