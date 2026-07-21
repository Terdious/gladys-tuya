// A discovery must never publish LESS than Gladys already knows.
//
// The LAN info of a device can come from a past UDP scan or from a manual
// protocol detection — and the CURRENT scan may miss that device (asleep,
// different subnet, broadcast lost). Publishing the fresh discovery as-is
// would then wipe the stored IP_ADDRESS / PROTOCOL_VERSION params when the
// user hits "Update" on the Discovery screen, silently demoting the device
// back to cloud. Before publishing, carry the LAN info stored on the created
// devices into any raw device the discovery left without it.

import { DEVICE_PARAM_NAME } from '../constants.js';
import { getParamValue } from '../utils/tuya.deviceParams.js';

/**
 * @description Fill the missing LAN fields of freshly discovered raw devices
 * from the params of the devices already created in Gladys.
 * @param {Array} tuyaDevices - Raw Tuya devices about to be published.
 * @param {Array} createdDevices - Gladys devices (gladys.devices cache).
 * @param {boolean} localMode - Current "prefer local" preference.
 * @returns {Array} Enriched raw devices.
 * @example
 * const enriched = enrichFromCreatedDevices(tuyaDevices, gladys.devices, config.localMode);
 */
export function enrichFromCreatedDevices(tuyaDevices, createdDevices, localMode = false) {
  const created = Array.isArray(createdDevices) ? createdDevices : [];
  return (tuyaDevices || []).map((raw) => {
    // The scan already provided the full LAN info: nothing to preserve.
    if (!raw || (raw.ip && raw.protocol_version)) {
      return raw;
    }
    const existing = created.find(
      (device) => getParamValue(device && device.params, DEVICE_PARAM_NAME.DEVICE_ID) === raw.id,
    );
    if (!existing) {
      return raw;
    }
    const ip = raw.ip || getParamValue(existing.params, DEVICE_PARAM_NAME.IP_ADDRESS);
    const protocolVersion =
      raw.protocol_version || getParamValue(existing.params, DEVICE_PARAM_NAME.PROTOCOL_VERSION);
    if (!ip && !protocolVersion) {
      return raw;
    }
    return {
      ...raw,
      ip: ip || raw.ip,
      protocol_version: protocolVersion || raw.protocol_version,
      // A device with a complete LAN identity follows the live preference,
      // exactly like a device found by the scan.
      local_override: localMode === true && Boolean(ip && protocolVersion),
    };
  });
}
