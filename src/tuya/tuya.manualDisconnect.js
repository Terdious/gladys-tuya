// Ported from server/services/tuya/lib/tuya.manualDisconnect.js. The
// MANUAL_DISCONNECT variable of the core is an in-memory flag here.

/**
 * @description Manually disconnect from Tuya cloud and disable auto-reconnect.
 * @example
 * await handler.manualDisconnect();
 */
export async function manualDisconnect() {
  this.manualDisconnectEnabled = true;
  await this.disconnect({ manual: true });
}
