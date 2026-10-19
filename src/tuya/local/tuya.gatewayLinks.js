// Zigbee (and other) sub-devices of a Tuya gateway (issue #78).
//
// A sub-device has no LAN identity of its own: the UDP scan only sees its
// gateway, and a local session opened with the sub-device's key is refused
// (HMAC mismatch, #70). Locally, it is reached through the gateway's session
// and addressed in it by its node id (tuyapi `cid`). At discovery, each
// sub-device the cloud ties to a gateway (`gateway_id` + `node_id`) gets the
// gateway's LAN identity — IP and protocol from the scan, local key — so the
// poll and the commands of the sub-device go through the gateway session.

/**
 * @description Whether a raw Tuya device is a gateway (Zigbee / BLE / mesh
 * hub): the `wg*` categories.
 * @param {object} raw - Raw Tuya device.
 * @returns {boolean} True for a gateway.
 * @example
 * isGateway({ category: 'wg2' });
 */
export const isGateway = (raw) => {
  const category = String(
    (raw && ((raw.specifications && raw.specifications.category) || raw.category)) || '',
  );
  return category.startsWith('wg');
};

/**
 * @description The gateway link of a raw sub-device, or null.
 * @param {object} raw - Raw Tuya device.
 * @returns {{ gatewayId: string, nodeId: string }|null} The link.
 * @example
 * getGatewayLink({ sub: true, gateway_id: 'gw1', node_id: 'a4c1...' });
 */
export const getGatewayLink = (raw) => {
  const gatewayId = raw && (raw.gateway_id || raw.parent_id);
  const nodeId = raw && raw.node_id;
  if (!gatewayId || !nodeId || gatewayId === raw.id) {
    return null;
  }
  return { gatewayId: String(gatewayId), nodeId: String(nodeId) };
};

/**
 * @description The DP id of each code, as the cloud declares it: `dp_id` of
 * the specification and of the shadow properties, `abilityId` of the thing
 * model. The LAN mapping of a sub-device whose type has none (a Zigbee sensor
 * behind a gateway answers on the same DP ids as the cloud).
 * @param {object} raw - Raw Tuya device (with its loaded details).
 * @returns {object} `{ code: dpId }`, empty when nothing is declared.
 * @example
 * extractDpIds({ properties: { properties: [{ code: 'switch_1', dp_id: 1 }] } });
 */
export const extractDpIds = (raw) => {
  const map = {};
  const add = (code, dpId) => {
    const id = Number(dpId);
    if (code && Number.isInteger(id) && id > 0 && map[code] === undefined) {
      map[code] = id;
    }
  };
  const specifications = (raw && raw.specifications) || {};
  [...(specifications.functions || []), ...(specifications.status || [])].forEach((entry) =>
    add(entry && entry.code, entry && entry.dp_id),
  );
  const properties = raw && raw.properties;
  const shadow = Array.isArray(properties)
    ? properties
    : (properties && Array.isArray(properties.properties) && properties.properties) || [];
  shadow.forEach((entry) => add(entry && entry.code, entry && entry.dp_id));
  const services = (raw && raw.thing_model && raw.thing_model.services) || [];
  services.forEach((service) =>
    ((service && service.properties) || []).forEach((entry) =>
      add(entry && entry.code, entry && entry.abilityId),
    ),
  );
  return map;
};

/**
 * @description Give each sub-device the LAN identity of its gateway (IP and
 * protocol from the scan or a detection, the gateway's local key) and its
 * node id. A sub-device whose gateway has no LAN identity yet keeps its link
 * (shown by the diagnostic) and stays on the cloud.
 * @param {Array} tuyaDevices - Raw Tuya devices (after the scan merge).
 * @param {boolean} [localMode] - Whether the user enabled local mode.
 * @returns {Array} The raw devices, sub-devices linked.
 * @example
 * tuyaDevices = applyGatewayLinks(tuyaDevices, config.localMode);
 */
export function applyGatewayLinks(tuyaDevices, localMode = false) {
  const devices = Array.isArray(tuyaDevices) ? tuyaDevices : [];
  const byId = new Map(devices.map((raw) => [raw && raw.id, raw]));
  return devices.map((raw) => {
    const link = getGatewayLink(raw);
    if (!link) {
      return raw;
    }
    const gateway = byId.get(link.gatewayId);
    const linked = {
      ...raw,
      gateway_id: link.gatewayId,
      node_id: link.nodeId,
      dp_ids: extractDpIds(raw),
    };
    if (!gateway || !gateway.ip || !gateway.protocol_version || !gateway.local_key) {
      return linked;
    }
    return {
      ...linked,
      ip: gateway.ip,
      protocol_version: gateway.protocol_version,
      gateway_local_key: gateway.local_key,
      local_override: localMode === true,
    };
  });
}

/**
 * @description An online sub-device of a gateway, to address when the
 * gateway itself is probed: a gateway has no data point of its own, so a
 * plain read of it never answers (#78).
 * @param {Array} tuyaDevices - Raw Tuya devices.
 * @param {string} gatewayId - The gateway's Tuya id.
 * @returns {object|null} A raw sub-device with a node id.
 * @example
 * const child = findProbeChild(tuya.discoveredDevices, 'gw1');
 */
export const findProbeChild = (tuyaDevices, gatewayId) => {
  const children = (tuyaDevices || []).filter((raw) => {
    const link = getGatewayLink(raw);
    return link && link.gatewayId === gatewayId;
  });
  // Mains-powered and online first: a battery sensor sleeps between reports.
  const score = (raw) => (raw.online === false ? 2 : 0) + (raw.category === 'cz' ? 0 : 1);
  return children.sort((a, b) => score(a) - score(b))[0] || null;
};
