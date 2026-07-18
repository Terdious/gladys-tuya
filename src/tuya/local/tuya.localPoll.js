// Ported from server/services/tuya/lib/tuya.localPoll.js (localPoll function).
//
// The updateDiscoveredDeviceAfterLocalPoll helper of the core (which reacted
// to the manual "local poll" button of the custom setup UI) is not ported:
// the external integration enriches its discovered devices from the UDP scan
// instead (see tuya.localScan.js).

import TuyAPI from 'tuyapi';
import TuyAPINewGen from '@demirdeniz/tuyapi-newgen';
import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'tuya' });

// Injection point for tests (stubbed local APIs).
export const localApiClasses = {
  TuyAPI,
  TuyAPINewGen,
};

/**
 * @description Poll a Tuya device locally to retrieve DPS map.
 * @param {object} payload - Local connection info.
 * @returns {Promise<object>} DPS map.
 * @example
 * await localPoll({ deviceId: 'id', ip: '1.1.1.1', localKey: 'key', protocolVersion: '3.3' });
 */
export async function localPoll(payload) {
  const {
    deviceId,
    ip,
    localKey,
    protocolVersion,
    timeoutMs = 3000,
    fastScan = false,
    logDps = true,
    apiClasses = localApiClasses,
  } = payload || {};
  const isProtocol34 = protocolVersion === '3.4';
  const isProtocol35 = protocolVersion === '3.5';
  const isNewGenProtocol = isProtocol34 || isProtocol35;
  const parsedTimeout = Number(timeoutMs);
  const sanitizedTimeout = Number.isFinite(parsedTimeout)
    ? Math.min(Math.max(parsedTimeout, 500), 30000)
    : 3000;
  const effectiveTimeout =
    isProtocol35 && !fastScan ? Math.max(sanitizedTimeout, 5000) : sanitizedTimeout;
  const TuyaLocalApi = isNewGenProtocol ? apiClasses.TuyAPINewGen : apiClasses.TuyAPI;

  if (!deviceId || !ip || !localKey || !protocolVersion) {
    throw new Error('Missing local connection parameters');
  }

  const tuyaOptions = {
    id: deviceId,
    key: localKey,
    ip,
    version: protocolVersion,
    issueGetOnConnect: false,
    issueRefreshOnConnect: false,
    issueRefreshOnPing: false,
  };
  if (isProtocol35) {
    // Protocol 3.5 has a heavier handshake than 3.1/3.3/3.4: enforce a 5s socket
    // floor and disable keepAlive so the socket closes promptly after the poll.
    tuyaOptions.keepAlive = false;
    tuyaOptions.socketTimeout = Math.max(effectiveTimeout, 5000);
  }
  const tuyaLocal = new TuyaLocalApi(tuyaOptions);
  let lastError = null;
  const onError = (err) => {
    lastError = err;
    logger.info(`[Tuya][localPoll] socket error for device=${deviceId}: ${err.message}`);
  };
  tuyaLocal.on('error', onError);

  const runGet = async (options) => {
    let errorListener;
    let timeoutId;
    let resolved = false;
    const cleanup = async () => {
      if (resolved) {
        return;
      }
      resolved = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      if (errorListener) {
        tuyaLocal.removeListener('error', errorListener);
      }
      try {
        await tuyaLocal.disconnect();
      } catch {
        // ignore
      }
    };
    try {
      const operation = (async () => {
        await tuyaLocal.connect();
        const data = await tuyaLocal.get(options);
        return data;
      })();
      const data = await Promise.race([
        operation,
        new Promise((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error('Local poll timeout')), effectiveTimeout);
        }),
        new Promise((_, reject) => {
          errorListener = (err) => {
            reject(new Error(`Local poll socket error: ${err.message}`));
          };
          tuyaLocal.once('error', errorListener);
        }),
      ]);
      await cleanup();
      return data;
    } catch (e) {
      await cleanup();
      throw e;
    }
  };

  try {
    // Protocol 3.5 sometimes rejects a bare `schema:true` get on first contact.
    // Fall back to probing DPS 1 (the standard switch DPS for Tuya devices) and
    // finally an empty get as last resort. Other protocols only need the schema.
    const attempts =
      protocolVersion === '3.5'
        ? [{ schema: true }, { schema: true, dps: [1] }, {}]
        : [{ schema: true }];
    const tryAttempt = async (index) => {
      try {
        return await runGet(attempts[index]);
      } catch (e) {
        if (index >= attempts.length - 1) {
          throw e;
        }
        return tryAttempt(index + 1);
      }
    };
    const data = await tryAttempt(0);
    if (!data || typeof data !== 'object' || !data.dps) {
      const errorMessage =
        typeof data === 'string'
          ? `Invalid local poll response: ${data}`
          : 'Invalid local poll response';
      throw new Error(errorMessage);
    }
    if (logDps) {
      logger.debug(`[Tuya][localPoll] device=${deviceId} dps=${JSON.stringify(data)}`);
    }
    return data;
  } catch (e) {
    if (lastError && (!e || e.message !== lastError.message)) {
      logger.info(
        `[Tuya][localPoll] last socket error for device=${deviceId}: ${lastError.message}`,
      );
    }
    logger.warn(`[Tuya][localPoll] failed for device=${deviceId}`, e);
    // Close the socket on failure: leaving it half-open made the device refuse
    // subsequent local connections (cascading ECONNRESET observed in runtime).
    // Keep the `'error'` listener registered until the TuyaDevice instance is
    // garbage-collected — removing it before late socket events arrive caused
    // those events to bubble up as uncaughtException.
    try {
      await tuyaLocal.disconnect();
    } catch {
      // ignore
    }
    throw e;
  }
}
