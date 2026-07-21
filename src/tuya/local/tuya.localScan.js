// Ported from server/services/tuya/lib/tuya.localScan.js, adapted to the
// MEDIATED network discovery of external integrations.
//
// A bridge container never receives the UDP broadcasts Tuya devices send on
// the LAN (ports 6666/6667/7000): only the core, which runs on the host
// network, sees them. The scan therefore goes through the core: the manifest
// declares the capture (`network_discovery` field), `gladys.scanNetwork`
// asks the core to listen during the scan window, and the RAW captured
// datagrams come back base64-encoded — "the core captures, the integration
// interprets". The parsing below (createScanCollector) is exactly the
// message handling of the core Tuya service, fed with the relayed payloads.
//
// Reaching the devices afterwards (poll/set) is plain unicast, which crosses
// the bridge NAT — no mediation needed (see tuya.localPoll.js).

import { UDP_KEY } from '@demirdeniz/tuyapi-newgen/lib/config.js';
import { MessageParser } from '@demirdeniz/tuyapi-newgen/lib/message-parser.js';
import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'tuya' });

const DEFAULT_TIMEOUT_SECONDS = 10;
const MIN_TIMEOUT_SECONDS = 1;
const MAX_TIMEOUT_SECONDS = 30;

/**
 * @description Create a collector that parses Tuya UDP broadcast packets and
 * accumulates the discovered devices.
 * @returns {object} { devices, onMessage }.
 * @example
 * const { devices, onMessage } = createScanCollector();
 */
export function createScanCollector() {
  const devices = {};
  const parsers = [
    new MessageParser({ key: UDP_KEY, version: 3.1 }),
    new MessageParser({ key: UDP_KEY, version: 3.4 }),
    new MessageParser({ key: UDP_KEY, version: 3.5 }),
  ];

  const onMessage = (message, rinfo) => {
    const byteLen = message ? message.length : 0;
    const remote = rinfo ? `${rinfo.address}:${rinfo.port}` : 'unknown';
    logger.debug(`[Tuya][localScan] Packet received from ${remote} len=${byteLen}`);
    let parsed = null;
    let lastError = null;
    for (let i = 0; i < parsers.length; i += 1) {
      try {
        parsed = parsers[i].parse(message);
        break;
      } catch (e) {
        lastError = e;
      }
    }
    if (!parsed) {
      logger.info(
        `[Tuya][localScan] Unable to parse payload from ${remote} (len=${byteLen}): ${
          lastError ? lastError.message : 'unknown'
        }`,
      );
      return;
    }
    const payload = parsed && parsed[0] && parsed[0].payload;

    if (!payload || typeof payload !== 'object') {
      logger.info(
        `[Tuya][localScan] Ignoring payload from ${remote} (len=${byteLen}): invalid payload`,
      );
      return;
    }

    const { gwId, devId, id, ip, version, productKey } = payload;
    const resolvedIp = ip || (rinfo && rinfo.address);
    const deviceId = gwId || devId || id;

    if (!deviceId) {
      logger.info(
        `[Tuya][localScan] Ignoring payload from ${remote} (len=${byteLen}): missing deviceId`,
      );
      return;
    }

    const isNew = !devices[deviceId];
    devices[deviceId] = {
      ip: resolvedIp,
      version,
      productKey,
    };
    if (isNew) {
      logger.info(
        `[Tuya][localScan] Found device ${deviceId} ip=${ip || 'unknown'} version=${version || 'unknown'}`,
      );
    }
  };

  return { devices, onMessage };
}

/**
 * @description Scan the local network for Tuya devices through the mediated
 * network discovery of the core (`gladys.scanNetwork`, `udp-broadcast`
 * capture declared in the manifest).
 * @param {number|object} input - Scan duration in seconds or options.
 * @returns {Promise<object>} { devices: { deviceId: { ip, version, productKey } }, unsupported? }.
 * @example
 * await handler.localScan({ timeoutSeconds: 10 });
 */
export async function localScan(input = DEFAULT_TIMEOUT_SECONDS) {
  const options = typeof input === 'object' ? input || {} : { timeoutSeconds: input };
  const parsedTimeout = Number(options.timeoutSeconds);
  // The host API requires an INTEGER between 1 and 30 seconds.
  const timeoutSeconds = Number.isFinite(parsedTimeout)
    ? Math.min(Math.max(Math.round(parsedTimeout), MIN_TIMEOUT_SECONDS), MAX_TIMEOUT_SECONDS)
    : DEFAULT_TIMEOUT_SECONDS;
  const { devices, onMessage } = createScanCollector();

  if (!this.gladys || typeof this.gladys.scanNetwork !== 'function') {
    // SDK (or Gladys) without mediated network discovery: LAN discovery is
    // simply unavailable — devices stay in cloud mode.
    logger.warn(
      '[Tuya][localScan] Mediated network scan unavailable (SDK without scanNetwork); skipping LAN discovery',
    );
    return { devices, unsupported: true };
  }

  logger.info(`[Tuya][localScan] Starting mediated udp-broadcast scan for ${timeoutSeconds}s`);
  const results = await this.gladys.scanNetwork('udp-broadcast', { timeoutSeconds });

  (Array.isArray(results) ? results : []).forEach((result) => {
    if (!result || typeof result.payload_base64 !== 'string') {
      return;
    }
    onMessage(Buffer.from(result.payload_base64, 'base64'), {
      address: result.source_ip,
      port: result.source_port,
    });
  });

  logger.info(`[Tuya][localScan] Scan complete. Found ${Object.keys(devices).length} device(s).`);
  return { devices };
}

/**
 * @description Enrich the raw Tuya devices discovered through the cloud with
 * the LAN info found by the UDP scan (ip, protocol version, product key).
 * Devices seen on the LAN are flagged local_override so their conversion
 * stores the local params and the faster poll frequency.
 * The LAN info (ip, protocol version, product key) is always stored so a
 * device CAN be reached locally, but `local_override` (poll/control the
 * device over the LAN instead of the cloud) is only enabled when the user
 * opted into local mode through the configuration. This mirrors the core
 * service, where the UDP scan filled the LAN info and `local_override` was a
 * separate, explicit per-device choice (default: cloud) — here it is a single
 * global toggle since the external configuration UI has no per-device switch.
 * @param {Array} tuyaDevices - Raw Tuya devices (cloud discovery).
 * @param {object} localDevicesById - UDP scan result (deviceId -> info).
 * @param {boolean} [localMode] - Whether the user enabled local mode.
 * @returns {Array} Enriched raw Tuya devices.
 * @example
 * applyLocalScanResults(tuyaDevices, scan.devices, config.localMode);
 */
export function applyLocalScanResults(tuyaDevices, localDevicesById, localMode = false) {
  const localById = localDevicesById || {};
  return (tuyaDevices || []).map((device) => {
    const localInfo = localById[device.id];
    if (!localInfo) {
      return device;
    }
    return {
      ...device,
      ip: localInfo.ip || device.ip,
      protocol_version:
        localInfo.version !== undefined && localInfo.version !== null
          ? localInfo.version
          : device.protocol_version,
      product_key:
        localInfo.productKey !== undefined && localInfo.productKey !== null
          ? localInfo.productKey
          : device.product_key,
      // Only opt a device into local polling/control when the user asked for
      // it: LAN unicast is not guaranteed from the sandboxed bridge network,
      // and a device already held by another local client (e.g. Home
      // Assistant) refuses the connection.
      local_override: localMode === true,
    };
  });
}
