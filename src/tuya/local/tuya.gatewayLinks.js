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
 *
 * The gateway is often never created in Gladys (it has no feature) and the
 * UDP scan may not see it (#78: no broadcast reaches the container): its LAN
 * identity then only survives on its created sub-devices, whose stored IP /
 * protocol `enrichFromCreatedDevices` put back on them. It is recovered from
 * them, so a later discovery never strips the sub-devices of their local mode
 * — and their key is ALWAYS the gateway's: their own is refused on the LAN.
 * @param {Array} tuyaDevices - Raw Tuya devices (after the scan merge and
 * the created-devices enrichment).
 * @param {boolean} [localMode] - Whether the user enabled local mode.
 * @returns {Array} The raw devices, gateways and sub-devices linked.
 * @example
 * tuyaDevices = applyGatewayLinks(tuyaDevices, config.localMode);
 */
export function applyGatewayLinks(tuyaDevices, localMode = false) {
  const devices = Array.isArray(tuyaDevices) ? tuyaDevices : [];
  const byId = new Map(devices.map((raw) => [raw && raw.id, raw]));

  // The LAN identity of each gateway: its own, else one a sub-device kept.
  const lanByGateway = new Map();
  devices.forEach((raw) => {
    const link = getGatewayLink(raw);
    if (!link || lanByGateway.has(link.gatewayId)) {
      return;
    }
    const gateway = byId.get(link.gatewayId);
    if (gateway && gateway.ip && gateway.protocol_version) {
      lanByGateway.set(link.gatewayId, { ip: gateway.ip, version: gateway.protocol_version });
    } else if (raw.ip && raw.protocol_version) {
      lanByGateway.set(link.gatewayId, { ip: raw.ip, version: raw.protocol_version });
    }
  });

  return devices.map((raw) => {
    const link = getGatewayLink(raw);
    if (!link) {
      const lan = raw && lanByGateway.get(raw.id);
      // A gateway that got its LAN identity back from its sub-devices.
      return lan && !(raw.ip && raw.protocol_version)
        ? { ...raw, ip: lan.ip, protocol_version: lan.version }
        : raw;
    }
    const gateway = byId.get(link.gatewayId);
    const lan = lanByGateway.get(link.gatewayId);
    const linked = {
      ...raw,
      gateway_id: link.gatewayId,
      node_id: link.nodeId,
      dp_ids: extractDpIds(raw),
      // Never the sub-device's own key on the LAN, even without an IP yet.
      ...(gateway && gateway.local_key ? { gateway_local_key: gateway.local_key } : {}),
    };
    if (!lan || !linked.gateway_local_key) {
      return linked;
    }
    return {
      ...linked,
      ip: lan.ip,
      protocol_version: lan.version,
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
