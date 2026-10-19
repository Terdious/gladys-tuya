// Where a device is reached on the LAN (issue #78).
//
// A Wi-Fi device owns its local session: its own id, key, IP and protocol. A
// Zigbee sub-device has none: it is reached through its gateway's session
// (the gateway's id, key, IP and protocol, stored on the sub-device at
// discovery) and addressed in it by its node id, the tuyapi `cid`.

import { DEVICE_PARAM_NAME } from '../constants.js';
import { getParamValue } from './tuya.deviceParams.js';
import { getTuyaDeviceId } from './tuya.externalId.js';

/**
 * @description The LAN transport of a Gladys device.
 * @param {object} device - The Gladys device (params).
 * @returns {{ sessionId: string, cid: string|null, ip: string|undefined, localKey: string|undefined, protocolVersion: string|undefined }}
 * The local session to use (`sessionId`: the device's own id, or its
 * gateway's) and the node id to address in it (`cid`, null for a Wi-Fi device).
 * @example
 * const { sessionId, cid } = getLocalTransport(device);
 */
export const getLocalTransport = (device) => {
  const params = (device && device.params) || [];
  const gatewayId = getParamValue(params, DEVICE_PARAM_NAME.GATEWAY_ID);
  const nodeId = getParamValue(params, DEVICE_PARAM_NAME.NODE_ID);
  const protocolVersionRaw = getParamValue(params, DEVICE_PARAM_NAME.PROTOCOL_VERSION);
  const isSubDevice = Boolean(gatewayId && nodeId);
  return {
    sessionId: isSubDevice ? String(gatewayId) : getTuyaDeviceId(device),
    cid: isSubDevice ? String(nodeId) : null,
    ip: getParamValue(params, DEVICE_PARAM_NAME.IP_ADDRESS),
    localKey: getParamValue(params, DEVICE_PARAM_NAME.LOCAL_KEY),
    protocolVersion:
      protocolVersionRaw !== null && protocolVersionRaw !== undefined
        ? String(protocolVersionRaw).trim()
        : undefined,
  };
};
