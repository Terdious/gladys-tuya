// -----------------------------------------------------------------------------
// Device registry.
//
// One file per Tuya device type will live in this folder (smart-socket,
// smart-meter...). The registry is empty for now: the demo devices of the
// template have been removed, and the Tuya device types are added by the
// next pull requests.
// -----------------------------------------------------------------------------

export const DEVICE_BLUEPRINTS = [];

/**
 * Build the discovery payload for Gladys (all devices).
 */
export function buildDiscoveredDevices(gladys, config) {
  return DEVICE_BLUEPRINTS.map((bp) => bp.buildDevice(gladys, config));
}

/**
 * Find the blueprint that owns a given device, from its external_id
 * (used to route onPoll / onSetValue to the right device).
 */
export function findBlueprintByDevice(gladys, device) {
  return DEVICE_BLUEPRINTS.find((bp) => bp.deviceExternalId(gladys) === device.external_id);
}
