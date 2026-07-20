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

/**
 * Rebuild the full device for a poll/setValue command. The core sends only
 * `{ external_id, selector, params }` over the WebSocket — NOT the features
 * nor the device_type. Pull those from the user devices cached by the SDK
 * (refreshed from GET /device on connect and on every device-* event), so
 * poll knows which features to read and setValue can resolve the local DPS.
 */
function mergeParams(base, override) {
  const byName = new Map();
  (Array.isArray(base) ? base : []).forEach((param) => {
    if (param && param.name) {
      byName.set(param.name, param);
    }
  });
  (Array.isArray(override) ? override : []).forEach((param) => {
    if (param && param.name) {
      byName.set(param.name, param);
    }
  });
  return [...byName.values()];
}

function resolveDevice(device) {
  const known = (gladys.devices || []).find((d) => d.external_id === device.external_id);
  if (!known) {
    return device;
  }
  return {
    ...known,
    ...device,
    // The core poll/setValue command carries only a minimal device ref: the
    // Tuya id resolves from the external_id, but the LOCAL params (ip /
    // local_key / protocol_version / local_override) live only on the stored
    // device. Use the cached (GET /device) params as the authoritative base so
    // a minimal command can never drop them, then let any command param win by
    // name. Without this, `{ ...known, ...device }` lets an empty command
    // params array erase the local config and every poll silently stays cloud.
    params: mergeParams(known.params, device.params),
    features: Array.isArray(known.features) ? known.features : [],
    device_type: known.device_type,
  };
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
    // The "Mode local (LAN)" toggle drives the discovery: ON = cloud discovery
    // enriched with a LAN UDP scan (so devices get their ip/protocol and can be
    // polled locally); OFF = cloud-only discovery (no scan). The scan is the
    // slow part, so skipping it when local mode is off keeps a cloud refresh fast.
    if (config.localMode === true) {
      try {
        const scan = await tuya.localScan({ timeoutSeconds: 10 });
        tuyaDevices = applyLocalScanResults(tuyaDevices, scan.devices, config.localMode);
        tuya.discoveredDevices = tuyaDevices;
      } catch (err) {
        logger.warn('Tuya local scan failed (cloud discovery still published)', err);
      }
    } else {
      tuya.discoveredDevices = tuyaDevices;
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
  await tuya.setValue(resolveDevice(device), feature, value);
});

// --- Polling: Gladys asks to refresh a device --------------------------------
gladys.onPoll(async (device) => {
  await tuya.poll(resolveDevice(device));
});

// --- Configuration updated by the user ---------------------------------------
gladys.onConfigUpdated(async (newConfig) => {
  logger.info('onConfigUpdated -> new configuration received');
  const previousConfig = config;
  const previousHash = buildConfigHash(config);
  config = normalizeConfig(newConfig);
  // Keep the handler config live so poll()'s local-vs-cloud decision follows
  // the toggle immediately, even when no reconnect is needed.
  tuya.config = config;

  const credentialsChanged = buildConfigHash(config) !== previousHash;
  const localModeChanged = Boolean(previousConfig.localMode) !== Boolean(config.localMode);

  if (credentialsChanged || tuya.status !== STATUS.CONNECTED) {
    // Cloud credentials changed (or we are not connected): full reconnect.
    tuya.disconnect();
    await connectTuya();
    tuya.startReconnect();
    await discoverAndPublish();
    return;
  }
  if (localModeChanged) {
    // Only the "Mode local (LAN)" toggle changed: no reconnect, just re-run a
    // background discovery so the LAN scan is (re)applied per the new
    // preference (ON = cloud + UDP scan, OFF = cloud only).
    await discoverAndPublish();
  }
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
