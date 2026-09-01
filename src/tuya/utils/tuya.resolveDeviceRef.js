// Resolve a Configuration-screen "device" action field (Tuya id or Gladys
// display name) to its raw discovered Tuya device. Shared by every action
// that lets the user target one device by typing its name or id
// (`detect_protocol`, `debug_device_status`).

/**
 * @description Resolve a device reference (Tuya id or display name) to its
 * raw discovered Tuya device, refreshing the cloud discovery cache first when
 * it is empty.
 * @param {object} tuya - The TuyaHandler instance.
 * @param {string} deviceRef - Tuya device id, or the device name as shown in Gladys.
 * @returns {Promise<object>} The matching raw Tuya device.
 * @example
 * const rawDevice = await resolveTuyaDeviceRef(tuya, 'Living room socket');
 */
export async function resolveTuyaDeviceRef(tuya, deviceRef) {
  // The local key only comes from the cloud discovery: refresh the cache when
  // needed (fast, cloud only — no LAN scan here).
  if (!Array.isArray(tuya.discoveredDevices) || tuya.discoveredDevices.length === 0) {
    tuya.discoveredDevices = await tuya.discoverDevices();
  }
  // Resolve by Tuya id first, then by display name (the name the user actually
  // sees on the device card — nobody knows the Tuya id by heart).
  let rawDevice = tuya.discoveredDevices.find((d) => d && d.id === deviceRef);
  if (!rawDevice) {
    const wanted = deviceRef.toLowerCase();
    const byName = tuya.discoveredDevices.filter(
      (d) => d && typeof d.name === 'string' && d.name.trim().toLowerCase() === wanted,
    );
    if (byName.length > 1) {
      const ids = byName.map((d) => d.id).join(', ');
      throw new Error(`Several devices are named "${deviceRef}" — use the Tuya id (${ids})`);
    }
    [rawDevice] = byName;
  }
  if (!rawDevice) {
    throw new Error(`Device "${deviceRef}" not found in the Tuya cloud project (name or id)`);
  }
  return rawDevice;
}
