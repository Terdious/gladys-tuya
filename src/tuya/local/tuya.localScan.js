// Ported from server/services/tuya/lib/tuya.localScan.js.
//
// Differences with the core service:
// - the core exposed the scan through a manual API/UI button; here the scan
//   runs as part of the discovery flow (onScanRequest), so the message
//   handling is factored into createScanCollector for reuse and testing;
// - buildLocalScanResponse (an API-response builder mixing stateManager
//   merges) is replaced by applyLocalScanResults, which enriches the
//   discovered raw Tuya devices with the LAN info (ip, protocol version,
//   product key, local_override).
//
// NOTE: the scan listens for the UDP broadcasts Tuya devices send on ports
// 6666/6667/7000 of the LAN. Inside the sandboxed integration container this
// traffic may be unreachable (isolated network namespace); the scan then
// simply finds no device and cloud mode keeps working.

import dgram from 'node:dgram';
import { UDP_KEY } from '@demirdeniz/tuyapi-newgen/lib/config.js';
import { MessageParser } from '@demirdeniz/tuyapi-newgen/lib/message-parser.js';
import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'tuya' });

const DEFAULT_PORTS = [6666, 6667, 7000];

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
 * @description Scan local network for Tuya devices (UDP broadcast).
 * @param {number|object} input - Scan duration in seconds or options.
 * @returns {Promise<object>} { devices: { deviceId: { ip, version, productKey } }, portErrors }.
 * @example
 * await localScan({ timeoutSeconds: 10 });
 */
export async function localScan(input = 10) {
  const options = typeof input === 'object' ? input || {} : { timeoutSeconds: input };
  const parsedTimeout = Number(options.timeoutSeconds);
  const timeoutSeconds = Number.isFinite(parsedTimeout)
    ? Math.min(Math.max(parsedTimeout, 1), 30)
    : 10;
  const portErrors = {};
  const sockets = [];
  const { devices, onMessage } = createScanCollector();

  logger.info(
    `[Tuya][localScan] Starting udp scan for ${timeoutSeconds}s on ports ${DEFAULT_PORTS.join(', ')}`,
  );

  DEFAULT_PORTS.forEach((port) => {
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    socket.on('message', onMessage);
    socket.on('error', (err) => {
      portErrors[port] = err && err.message ? err.message : 'unknown';
      logger.info(`[Tuya][localScan] UDP socket error on port ${port}: ${err.message}`);
    });
    socket.on('listening', () => {
      try {
        const address = socket.address();
        logger.info(`[Tuya][localScan] Listening on ${address.address}:${address.port}`);
      } catch {
        logger.info(`[Tuya][localScan] Listening on port ${port}`);
      }
    });
    socket.bind({ port, address: '0.0.0.0', exclusive: false });
    sockets.push(socket);
  });

  await new Promise((resolve) => {
    setTimeout(resolve, timeoutSeconds * 1000);
  });

  sockets.forEach((socket) => {
    try {
      socket.close();
    } catch {
      // ignore
    }
  });

  logger.info(`[Tuya][localScan] Scan complete. Found ${Object.keys(devices).length} device(s).`);
  return { devices, portErrors };
}

/**
 * @description Enrich the raw Tuya devices discovered through the cloud with
 * the LAN info found by the UDP scan (ip, protocol version, product key).
 * Devices seen on the LAN are flagged local_override so their conversion
 * stores the local params and the faster poll frequency.
 * @param {Array} tuyaDevices - Raw Tuya devices (cloud discovery).
 * @param {object} localDevicesById - UDP scan result (deviceId -> info).
 * @returns {Array} Enriched raw Tuya devices.
 * @example
 * applyLocalScanResults(tuyaDevices, scan.devices);
 */
export function applyLocalScanResults(tuyaDevices, localDevicesById) {
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
      local_override: true,
    };
  });
}
