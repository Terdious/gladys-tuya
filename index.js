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
import { STATUS, DEVICE_EXTERNAL_ID_TYPE } from './src/tuya/constants.js';
import { buildConfigHash } from './src/tuya/utils/tuya.config.js';

const gladys = new GladysIntegration();
const tuya = new TuyaHandler(gladys);

// Current configuration (hot-reloaded via onConfigUpdated).
let config = normalizeConfig();

/**
 * Convert the discovered raw Tuya devices to minimal Gladys discovery
 * payloads. The full conversion (features, params...) is ported in the next
 * pull request; this already gives every device its final external_id.
 */
function buildDiscoveredDevices(tuyaDevices) {
  return tuyaDevices.map((tuyaDevice) => {
    const ids = gladys.externalIds(DEVICE_EXTERNAL_ID_TYPE, tuyaDevice.id);
    return {
      name: tuyaDevice.name || `Tuya ${tuyaDevice.id}`,
      external_id: ids.device,
      features: [],
    };
  });
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

/** Run a cloud discovery and publish the result to Gladys. */
async function discoverAndPublish() {
  if (tuya.status !== STATUS.CONNECTED) {
    logger.warn(`Tuya discovery skipped (status=${tuya.status})`);
    return;
  }
  const tuyaDevices = await tuya.discoverDevices();
  await gladys.publishDiscoveredDevices(buildDiscoveredDevices(tuyaDevices));
}

// --- Discovery: Gladys asks for the list of devices --------------------------
gladys.onScanRequest(async () => {
  logger.info('onScanRequest -> discovering Tuya devices');
  await discoverAndPublish();
});

// --- Configuration updated by the user ---------------------------------------
gladys.onConfigUpdated(async (newConfig) => {
  logger.info('onConfigUpdated -> new configuration received');
  const previousHash = buildConfigHash(config);
  config = normalizeConfig(newConfig);
  if (buildConfigHash(config) === previousHash && tuya.status === STATUS.CONNECTED) {
    return;
  }
  await connectTuya();
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
});

// --- Startup -----------------------------------------------------------------
logger.info('Starting the Tuya integration...');
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
