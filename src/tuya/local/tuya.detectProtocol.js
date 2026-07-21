// Manual-IP protocol detection, behind the `detect_protocol` manifest action.
//
// For a device the UDP scan did not find (different subnet, broadcast not
// forwarded, device asleep during the scan window), the user types its IP and
// the integration probes the local protocol versions one by one until the
// device answers with a DPS map. Roughly what the core custom UI did with the
// "Lecture locale des DP" button, without a custom UI.

import { createLogger } from '@gladysassistant/integration-sdk';

import { recordLocalSuccess } from './tuya.localCircuit.js';

const logger = createLogger({ name: 'tuya' });

// Most common first: 3.3 covers the vast majority of devices, then the
// new-gen protocols, then the legacy 3.1.
export const PROTOCOL_CANDIDATES = ['3.3', '3.4', '3.5', '3.1'];

// Per-attempt timeout. The action timeout (manifest `timeout_seconds`) bounds
// the whole run: 4 candidates x 5s stays well under 60s.
const ATTEMPT_TIMEOUT_MS = 5000;

/**
 * @description Probe the local protocol versions of a Tuya device at a given
 * IP until one answers with a DPS map.
 * @param {object} payload - Probe parameters.
 * @param {string} payload.deviceId - Tuya device id.
 * @param {string} payload.ip - Device LAN IP (typed by the user).
 * @param {string} payload.localKey - Device local key (from the cloud discovery).
 * @returns {Promise<{version: string, dps: object}>} First protocol that answered.
 * @example
 * const { version } = await handler.detectProtocol({ deviceId, ip, localKey });
 */
export async function detectProtocol({ deviceId, ip, localKey }) {
  if (!deviceId || !ip || !localKey) {
    throw new Error('detectProtocol requires deviceId, ip and localKey');
  }
  const failures = [];
  for (const version of PROTOCOL_CANDIDATES) {
    try {
      logger.info(`[Tuya][detectProtocol] device=${deviceId} trying ${version} at ${ip}`);
      // Sequential on purpose: Tuya devices accept a single local session, so
      // parallel probes would defeat each other.
      const result = await this.localPoll({
        deviceId,
        ip,
        localKey,
        protocolVersion: version,
        timeoutMs: ATTEMPT_TIMEOUT_MS,
        fastScan: true,
        logDps: false,
      });
      if (result && result.dps && typeof result.dps === 'object') {
        logger.info(`[Tuya][detectProtocol] device=${deviceId} answered with protocol ${version}`);
        // The device just proved locally reachable: clear any cooldown.
        recordLocalSuccess(this.localCircuit, deviceId);
        return { version, dps: result.dps };
      }
      failures.push(`${version}: empty DPS`);
    } catch (e) {
      failures.push(`${version}: ${e.message}`);
    }
  }
  throw new Error(`No local protocol answered at ${ip} (${failures.join('; ')})`);
}
