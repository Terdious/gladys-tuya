// -----------------------------------------------------------------------------
// Entry point of the Gladys external integration.
//
// Role of this file: wire the SDK to the Tuya handler (src/tuya/). It holds
// NO hardware logic: all the Tuya "work" lives in the handler modules. This
// file only:
//   1. instantiates the SDK (connection, auth, reconnection: handled for you);
//   2. registers the event handlers BEFORE connect();
//   3. connects to Gladys, then to the Tuya cloud, and publishes the
//      discovered devices.
//
// Environment variables provided by the Gladys supervisor to the container:
//   - GLADYS_HOST_API_URL         (host API URL)
//   - GLADYS_INTEGRATION_TOKEN    (integration-scoped JWT)
//   - GLADYS_INTEGRATION_SELECTOR (integration identifier)
// The SDK reads them automatically: `new GladysIntegration()` is enough.
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { normalizeConfig, isConfigured } from './src/config.js';
import { TuyaHandler } from './src/tuya/handler.js';
import { STATUS } from './src/tuya/constants.js';
import { buildConfigHash } from './src/tuya/utils/tuya.config.js';
import { convertDevice } from './src/tuya/device/tuya.convertDevice.js';
import { applyLocalScanResults } from './src/tuya/local/tuya.localScan.js';

const gladys = new GladysIntegration();
const tuya = new TuyaHandler(gladys);

// Current configuration (hot-reloaded via onConfigUpdated).
let config = normalizeConfig();

/** Convert the discovered raw Tuya devices to Gladys discovery payloads. */
function buildDiscoveredDevices(tuyaDevices) {
  return tuyaDevices.map((tuyaDevice) => convertDevice(gladys, tuyaDevice));
}

/** Connect the handler to the Tuya cloud with the current configuration. */
async function connectTuya() {
  if (!isConfigured(config)) {
    logger.warn('Tuya is not configured yet: fill in the integration settings in Gladys');
    return;
  }
  tuya.config = config;
  await tuya.connect(config);
}

// In-flight discovery run: connection events and scan requests can overlap,
// and the core allows a single mediated network scan at a time per
// integration (409 EXTERNAL_INTEGRATION_SCAN_ALREADY_RUNNING) — concurrent
// callers just await the run already in progress.
let discoveryInFlight = null;

/**
 * Run a cloud discovery, enrich it with a LAN scan, and publish the result
 * to Gladys. The LAN scan goes through the mediated network discovery of the
 * core (`gladys.scanNetwork`, `network_discovery` manifest field) because a
 * bridge container never receives the LAN UDP broadcasts. Best-effort: if
 * the scan is unavailable or fails, the devices simply stay in cloud mode.
 */
function discoverAndPublish() {
  if (discoveryInFlight) {
    return discoveryInFlight;
  }
  discoveryInFlight = (async () => {
    if (tuya.status !== STATUS.CONNECTED) {
      logger.warn(`Tuya discovery skipped (status=${tuya.status})`);
      return;
    }
    let tuyaDevices = await tuya.discoverDevices();
    try {
      const scan = await tuya.localScan({ timeoutSeconds: 10 });
      tuyaDevices = applyLocalScanResults(tuyaDevices, scan.devices);
      tuya.discoveredDevices = tuyaDevices;
    } catch (err) {
      logger.warn('Tuya local scan failed (cloud discovery still published)', err);
    }
    await gladys.publishDiscoveredDevices(buildDiscoveredDevices(tuyaDevices));
  })().finally(() => {
    discoveryInFlight = null;
  });
  return discoveryInFlight;
}

// --- Discovery: Gladys asks for the list of devices --------------------------
gladys.onScanRequest(async () => {
  logger.info('onScanRequest -> discovering Tuya devices');
  await discoverAndPublish();
});

// --- Command: the user acts on a controllable feature ------------------------
gladys.onSetValue(async (device, feature, value) => {
  logger.info(`onSetValue <- ${feature.external_id} = ${value}`);
  await tuya.setValue(device, feature, value);
});

// --- Polling: Gladys asks to refresh a device --------------------------------
gladys.onPoll(async (device) => {
  await tuya.poll(device);
});

// --- Configuration updated by the user ---------------------------------------
gladys.onConfigUpdated(async (newConfig) => {
  logger.info('onConfigUpdated -> new configuration received');
  const previousHash = buildConfigHash(config);
  config = normalizeConfig(newConfig);
  if (buildConfigHash(config) === previousHash && tuya.status === STATUS.CONNECTED) {
    return;
  }
  tuya.disconnect();
  await connectTuya();
  tuya.startReconnect();
  await discoverAndPublish();
});

// --- Connection lifecycle ----------------------------------------------------
gladys.on('connected', async () => {
  logger.info('WebSocket connected to Gladys');
  try {
    // 1) Fetch the config filled in by the user.
    config = normalizeConfig(await gladys.getConfig());

    // 2) Connect to the Tuya cloud and publish the devices.
    await connectTuya();
    tuya.startReconnect();
    await discoverAndPublish();
  } catch (err) {
    logger.error('Post-connection initialization failed', err);
  }
});

gladys.on('disconnected', () => {
  logger.warn('WebSocket disconnected - the SDK will try to reconnect');
});

// --- Graceful shutdown -------------------------------------------------------
// The SDK disconnects cleanly and exits with code 0 when the supervisor stops
// the container (SIGTERM/SIGINT).
gladys.handleShutdown((signal) => {
  logger.info(`Received ${signal} -> graceful shutdown`);
  tuya.disconnect();
});

// --- Startup -----------------------------------------------------------------
logger.info('Starting the Tuya integration...');
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
