// Resolve a Configuration-screen "device" action field to its raw discovered
// Tuya device. Used by every action that targets one device
// (`detect_protocol`, `device_diagnostic`): the value is either the Gladys
// external id picked in the device list (`source: "devices"`), or a Tuya id /
// display name typed for a device not created in Gladys.

import { DEVICE_EXTERNAL_ID_TYPE } from '../constants.js';

// `ext:<selector>:device:<tuyaDeviceId>` -> the Tuya device id.
const tuyaIdFromExternalId = (deviceRef) => {
  if (!deviceRef.startsWith('ext:')) {
    return null;
  }
  const parts = deviceRef.split(':');
  const typeIndex = parts.indexOf(DEVICE_EXTERNAL_ID_TYPE);
  return typeIndex >= 0 && parts[typeIndex + 1] ? parts[typeIndex + 1] : null;
};

/**
 * @description Resolve a device reference (Tuya id or display name) to its
 * raw discovered Tuya device, refreshing the cloud discovery cache first when
 * it is empty.
 * @param {object} tuya - The TuyaHandler instance.
 * @param {string} deviceRef - Gladys external id, Tuya device id, or the device
 * name as shown in Gladys.
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
  const wantedId = tuyaIdFromExternalId(deviceRef) || deviceRef;
  let rawDevice = tuya.discoveredDevices.find((d) => d && d.id === wantedId);
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
