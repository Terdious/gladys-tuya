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
import { STATUS, DEVICE_PARAM_NAME } from './src/tuya/constants.js';
import { buildConfigHash } from './src/tuya/utils/tuya.config.js';
import { convertDevice } from './src/tuya/device/tuya.convertDevice.js';
import { applyLocalScanResults } from './src/tuya/local/tuya.localScan.js';
import { enrichFromCreatedDevices } from './src/tuya/device/tuya.enrichDiscovery.js';
import { getLastCameraImage } from './src/tuya/media/tuya.media.js';
import {
  coreSupportsFirstClassFeatureTypes,
  coreSupportsTextSelect,
} from './src/tuya/utils/tuya.coreVersion.js';
import { resolveTuyaDeviceRef } from './src/tuya/utils/tuya.resolveDeviceRef.js';
import { getParamValue } from './src/tuya/utils/tuya.deviceParams.js';
import { describeDpsSnapshot } from './src/tuya/tuya.poll.js';
import { tryDecodeBase64Json, truncateForDisplay } from './src/tuya/utils/tuya.decodeDps.js';

const gladys = new GladysIntegration();
const tuya = new TuyaHandler(gladys);

// Current configuration (hot-reloaded via onConfigUpdated).
let config = normalizeConfig();

// Whether the running Gladys core (>= 4.84.2) accepts the first-class DOORBELL
// category and the AC fan-speed / swing feature types. Default false (safe): on
// an older core those types would make the discovery validator reject the WHOLE
// Tuya device list. Refreshed from gladys.getStatus() before each publish, so a
// core upgrade is picked up on the next scan.
let coreSupportsFirstClassTypes = false;

// Whether the running Gladys core (>= 4.86.0) accepts the TEXT/SELECT dynamic
// select feature type (e.g. the Honiture Q6 Pro's suction power / water level).
// Same safe-default/refresh rationale as coreSupportsFirstClassTypes above.
let coreSupportsTextSelectFlag = false;

/**
 * Refresh the core-capability flags from the running Gladys version. Best-effort:
 * on any failure we keep the safe defaults (downgraded features), never breaking
 * discovery on a core that cannot report its version.
 */
async function refreshCoreCapabilities() {
  try {
    const status = await gladys.getStatus();
    const version = status && status.gladys_version;
    coreSupportsFirstClassTypes = coreSupportsFirstClassFeatureTypes(version);
    coreSupportsTextSelectFlag = coreSupportsTextSelect(version);
    logger.debug(
      `Gladys core version ${version || 'unknown'} -> first-class doorbell/AC types ${
        coreSupportsFirstClassTypes ? 'enabled' : 'disabled (downgraded)'
      }, text/select ${coreSupportsTextSelectFlag ? 'enabled' : 'disabled (skipped)'}`,
    );
  } catch (e) {
    coreSupportsFirstClassTypes = false;
    coreSupportsTextSelectFlag = false;
    logger.warn(`Unable to read the Gladys core version (using downgraded features): ${e.message}`);
  }
}

/** Convert the discovered raw Tuya devices to Gladys discovery payloads. */
function buildDiscoveredDevices(tuyaDevices) {
  return tuyaDevices.map((tuyaDevice) =>
    convertDevice(gladys, tuyaDevice, {
      coreSupportsFirstClassTypes,
      coreSupportsTextSelect: coreSupportsTextSelectFlag,
    }),
  );
}

/** Refresh the core capabilities, then publish the discovered devices. */
async function publishDiscoveredDevices(tuyaDevices) {
  await refreshCoreCapabilities();
  await gladys.publishDiscoveredDevices(buildDiscoveredDevices(tuyaDevices));
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

/**
 * Publish the application-level connection status (SDK contract C.3): the
 * Configuration screen shows whether the integration is really talking to the
 * Tuya cloud, with the failure reason when it is not. Fire-and-forget.
 */
function reportConnectionStatus(connected, message) {
  gladys.setConnectionStatus(connected, message).catch(() => {});
}

/** Connect the handler to the Tuya cloud with the current configuration. */
async function connectTuya() {
  if (!isConfigured(config)) {
    logger.warn('Tuya is not configured yet: fill in the integration settings in Gladys');
    reportConnectionStatus(false, {
      en: 'Not configured yet: fill in the Tuya cloud credentials.',
      fr: 'Pas encore configuré : renseignez les identifiants du cloud Tuya.',
    });
    return;
  }
  tuya.config = config;
  // tuya.connect() never throws: it stores the failure in status/lastError
  // (core parity) — report the REAL outcome, not the absence of an exception.
  await tuya.connect(config);
  if (tuya.status === STATUS.CONNECTED) {
    reportConnectionStatus(true);
    // Start the real-time cloud events listener (issue #10): a no-op unless
    // the user enabled the toggle.
    await tuya.startPulsar();
  } else {
    // A mapped error carries a readable, actionable multi-language reason
    // (e.g. the expired IoT Core trial); otherwise fall back to the raw message.
    const reason = tuya.lastErrorMessage || {
      en: tuya.lastError || 'unknown error',
      fr: tuya.lastError || 'erreur inconnue',
    };
    reportConnectionStatus(false, {
      en: `Tuya cloud connection failed: ${reason.en}`,
      fr: `Connexion au cloud Tuya échouée : ${reason.fr}`,
    });
  }
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
      } catch (err) {
        logger.warn('Tuya local scan failed (cloud discovery still published)', err);
      }
    }
    // Never publish LESS than Gladys already knows: a device the scan missed
    // this time keeps the LAN info stored on its created device, so an
    // "Update" from the Discovery screen cannot wipe a manually-detected IP.
    tuyaDevices = enrichFromCreatedDevices(tuyaDevices, gladys.devices, config.localMode);
    tuya.discoveredDevices = tuyaDevices;
    await publishDiscoveredDevices(tuyaDevices);
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

// --- Action: manual-IP protocol detection ------------------------------------
// For a device the UDP scan did not find, the user types its Tuya id + IP in
// the Configuration screen (manifest `actions`): the integration probes the
// local protocol versions, and on success persists ip/protocol on the device
// through the re-publish params upsert of the core. The resolved message is
// shown under the action button.
gladys.onAction('detect_protocol', async (fields) => {
  const deviceRef = String((fields && fields.device) || (fields && fields.device_id) || '').trim();
  const ip = String((fields && fields.ip) || '').trim();
  if (!deviceRef || !ip) {
    throw new Error('device and ip are required');
  }
  // A discovery in flight would race this action (it rebuilds the shared
  // discovered list): join it first — it also proves the cloud is healthy.
  if (discoveryInFlight) {
    await discoveryInFlight;
  }
  if (tuya.status !== STATUS.CONNECTED) {
    throw new Error('Tuya cloud is not connected yet');
  }
  logger.info(`onAction detect_protocol <- device=${deviceRef} ip=${ip}`);

  const rawDevice = await resolveTuyaDeviceRef(tuya, deviceRef);
  const deviceId = rawDevice.id;
  if (!rawDevice.local_key) {
    throw new Error(`Device ${deviceId} has no local key (cloud project permissions?)`);
  }

  const { version } = await tuya.detectProtocol({ deviceId, ip, localKey: rawDevice.local_key });

  // Persist: enrich the cached raw device and re-publish the discovered list —
  // the core upserts the params (ip/protocol) of the already-created device
  // without touching its name or features.
  rawDevice.ip = ip;
  rawDevice.protocol_version = version;
  rawDevice.local_override = config.localMode === true;
  tuya.discoveredDevices = enrichFromCreatedDevices(
    tuya.discoveredDevices,
    gladys.devices,
    config.localMode,
  );
  await publishDiscoveredDevices(tuya.discoveredDevices);

  return {
    en: `Protocol ${version} detected at ${ip} — device updated, local mode ready.`,
    fr: `Protocole ${version} détecté sur ${ip} — appareil mis à jour, mode local prêt.`,
  };
});

// --- Action: debug dump of cloud codes + local DPS for one device -----------
// Bootstrapping a new device type (or filling in the DPS an existing one is
// still missing) needs two things that are otherwise buried in debug logs:
// the Tuya cloud function/status codes (already fetched by
// loadDeviceDetails during discovery) and a fresh raw local DPS read,
// annotated with the Gladys code each DPS already resolves to (or UNMAPPED).
// This surfaces both in one click, directly under the button, instead of
// requiring `docker logs`.
gladys.onAction('debug_device_status', async (fields) => {
  const deviceRef = String((fields && fields.device) || (fields && fields.device_id) || '').trim();
  if (!deviceRef) {
    throw new Error('device is required');
  }
  if (discoveryInFlight) {
    await discoveryInFlight;
  }
  if (tuya.status !== STATUS.CONNECTED) {
    throw new Error('Tuya cloud is not connected yet');
  }
  logger.info(`onAction debug_device_status <- device=${deviceRef}`);

  const rawDevice = await resolveTuyaDeviceRef(tuya, deviceRef);
  // Pull the code list from every source loadDeviceDetails collected, not just
  // specifications.functions/status: a custom/rebranded product's official
  // specification often only documents a handful of "headline" codes (e.g. a
  // vacuum's power/mode/seek), while its properties (shadow) or thing model
  // cover the rest of the DPS. Each entry carries a dp_id when the API
  // returns one (the field name varies: dp_id, dpId, abilityId), which is the
  // direct code<->DPS link we actually need — the DPS numbers alone (Local
  // DPS below) don't say which code they answer to.
  const specifications = rawDevice.specifications || {};
  const functions = Array.isArray(specifications.functions) ? specifications.functions : [];
  const status = Array.isArray(specifications.status) ? specifications.status : [];
  const propsPayload = rawDevice.properties;
  const properties = Array.isArray(propsPayload)
    ? propsPayload
    : Array.isArray(propsPayload && propsPayload.properties)
      ? propsPayload.properties
      : [];
  const thingModelServices = Array.isArray(rawDevice.thing_model && rawDevice.thing_model.services)
    ? rawDevice.thing_model.services
    : [];
  const thingModelProperties = thingModelServices.flatMap((service) =>
    Array.isArray(service && service.properties) ? service.properties : [],
  );

  const cloudEntriesByCode = new Map();
  [...functions, ...status, ...properties, ...thingModelProperties].forEach((entry) => {
    if (!entry || !entry.code) {
      return;
    }
    const existing = cloudEntriesByCode.get(entry.code) || {};
    const dpId = [existing.dpId, entry.dp_id, entry.dpId, entry.abilityId].find(
      (value) => value !== undefined && value !== null,
    );
    // type/values (a JSON string, e.g. '{"unit":"h","min":0,"max":300}') tell
    // us whether a counter-looking code (side_brush_time...) is actually a
    // 0-100 percent already, or a raw elapsed/remaining time needing a
    // known full-life value to turn into a percent — see the debug action's
    // "Consumable specs" line below.
    cloudEntriesByCode.set(entry.code, {
      code: entry.code,
      dpId: dpId ?? null,
      type: existing.type ?? entry.type,
      values: existing.values ?? entry.values,
    });
  });
  const cloudCodes = [...cloudEntriesByCode.values()].map((entry) =>
    entry.dpId !== null ? `${entry.code}(dp${entry.dpId})` : entry.code,
  );

  const lines = [
    `Tuya id: ${rawDevice.id}`,
    `Cloud codes: ${
      cloudCodes.length > 0 ? cloudCodes.join(', ') : 'none returned by the cloud specification'
    }`,
  ];

  // Targeted spec dump for consumable/wear-part codes: is the value already
  // a 0-100 percent, or a raw counter that needs a known full-life reference
  // to convert? (see MAINTENANCE.LIFE_REMAINING in tuya.deviceMapping.js).
  const CONSUMABLE_CODES = [
    'side_brush_time',
    'main_brush_time',
    'filter_time',
    'dust_collection_num',
  ];
  const consumableSpecs = CONSUMABLE_CODES.filter((code) => cloudEntriesByCode.has(code)).map(
    (code) => {
      const entry = cloudEntriesByCode.get(code);
      return `${code}: type=${entry.type || 'unknown'} values=${entry.values || '{}'}`;
    },
  );
  if (consumableSpecs.length > 0) {
    lines.push(`Consumable specs: ${consumableSpecs.join(' | ')}`);
  }

  // Same idea for codes whose meaning depends on cloud-side metadata this
  // debug action doesn't otherwise print: an Enum's `range` (every possible
  // robot_state string) or a Bitmap's `label` array (what each bit of
  // robot_fault means) live only in this type/values JSON.
  const EXTRA_SPEC_CODES = ['robot_state', 'robot_fault'];
  const extraSpecs = EXTRA_SPEC_CODES.filter((code) => cloudEntriesByCode.has(code)).map((code) => {
    const entry = cloudEntriesByCode.get(code);
    return `${code}: type=${entry.type || 'unknown'} values=${entry.values || '{}'}`;
  });
  if (extraSpecs.length > 0) {
    lines.push(`Extra specs: ${extraSpecs.join(' | ')}`);
  }

  const hasLocalConfig = Boolean(rawDevice.ip && rawDevice.local_key && rawDevice.protocol_version);
  if (hasLocalConfig) {
    try {
      const { dps } = await tuya.localRead({
        deviceId: rawDevice.id,
        ip: rawDevice.ip,
        localKey: rawDevice.local_key,
        protocolVersion: rawDevice.protocol_version,
      });
      // The Gladys device (if it already exists) gives the DPS-to-code
      // annotation; a not-yet-created device just shows everything UNMAPPED.
      const gladysDevice = (gladys.devices || []).find(
        (d) => getParamValue(d && d.params, DEVICE_PARAM_NAME.DEVICE_ID) === rawDevice.id,
      ) || { features: [] };
      const described = describeDpsSnapshot(gladysDevice, dps);
      lines.push(`Local DPS: ${described.length > 0 ? described.join(' | ') : 'empty read'}`);

      // The plain snapshot above truncates long strings (base64 blobs on
      // map/path DPS read as noise otherwise); decode+expand those here so a
      // structured field (e.g. a room id) is actually visible.
      const decoded = Object.entries(dps)
        .map(([key, value]) => [key, tryDecodeBase64Json(value)])
        .filter(([, parsed]) => parsed !== null)
        .map(([key, parsed]) => `${key}: ${JSON.stringify(truncateForDisplay(parsed))}`);
      if (decoded.length > 0) {
        lines.push(`Decoded DPS (base64 JSON): ${decoded.join(' | ')}`);
      }
    } catch (e) {
      lines.push(`Local DPS: read failed (${e.message})`);
    }
  } else {
    lines.push('Local DPS: no IP/local key/protocol yet — run "Detect local protocol" first.');
  }

  const report = lines.join('\n');
  logger.info(`[Tuya][debug_device_status]\n${report}`);
  return { en: report, fr: report };
});

// --- Device lifecycle: release per-device state ------------------------------
// Without this, deleting a locally-polled device leaks its persistent LAN
// session forever (socket open, single local slot occupied) plus the
// per-device caches. On update, the next poll recreates what it needs.
gladys.onDeviceDeleted(async (device) => {
  logger.info(`onDeviceDeleted <- ${device && device.external_id}`);
  await tuya.cleanupDevice(device);
});

// A freshly created device gets its first states immediately instead of
// waiting for the first scheduled poll cycle. The first attempt can race the
// LAN session handshake (and some devices are cloud-blind), so a second poll
// runs a few seconds later to catch the states the first one missed.
gladys.onDeviceCreated(async (device) => {
  logger.info(`onDeviceCreated <- ${device && device.external_id}`);
  const pollOnce = async (label) => {
    try {
      await tuya.poll(resolveDevice(device));
    } catch (err) {
      logger.warn(`${label} poll of freshly created device failed`, err);
    }
  };
  const retry = setTimeout(() => {
    pollOnce('Second');
  }, 7000);
  if (typeof retry.unref === 'function') {
    retry.unref();
  }
  await pollOnce('First');
});

// --- Action: manual cloud disconnect ------------------------------------------
// Same as the "Déconnecter" button of the core Tuya integration: stop talking
// to the Tuya cloud (and release the LAN sessions) until the user saves the
// configuration again.
gladys.onAction('disconnect', async () => {
  logger.info('onAction disconnect <- manual cloud disconnect requested');
  await tuya.manualDisconnect();
  reportConnectionStatus(false, {
    en: 'Disconnected manually. Save the configuration to reconnect.',
    fr: 'Déconnecté manuellement. Enregistrez la configuration pour vous reconnecter.',
  });
  return {
    en: 'Disconnected from the Tuya cloud. Save the configuration to reconnect.',
    fr: 'Déconnecté du cloud Tuya. Enregistrez la configuration pour vous reconnecter.',
  };
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

// --- Live view: Gladys asks for a fresh camera image -------------------------
// Tuya exposes no on-demand snapshot: re-serve the last event snapshot
// (doorbell ring / motion) the media handler stored for this device.
gladys.onGetImage(async (device) => {
  const image = getLastCameraImage(tuya, device.external_id);
  if (!image) {
    throw new Error('No Tuya snapshot available yet (it updates on a ring or a motion event)');
  }
  return image;
});

// --- Configuration updated by the user ---------------------------------------
// Config updates are serialized: the SDK dispatches WebSocket messages
// concurrently, and two overlapping saves would run two overlapping
// reconnects (competing connectors, duplicated discoveries).
let configUpdateChain = Promise.resolve();
gladys.onConfigUpdated((newConfig) => {
  configUpdateChain = configUpdateChain.then(async () => {
    logger.info('onConfigUpdated -> new configuration received');
    const previousConfig = config;
    const previousHash = buildConfigHash(config);
    config = normalizeConfig(newConfig);
    // Keep the handler config live so poll()'s local-vs-cloud decision follows
    // the toggle immediately, even when no reconnect is needed.
    tuya.config = config;

    const credentialsChanged = buildConfigHash(config) !== previousHash;
    const localModeChanged = Boolean(previousConfig.localMode) !== Boolean(config.localMode);
    const pulsarChanged = Boolean(previousConfig.pulsarEnabled) !== Boolean(config.pulsarEnabled);
    // A discovery in flight means the cloud connection is healthy: saving an
    // unchanged config during it must not tear everything down.
    const effectivelyConnected =
      tuya.status === STATUS.CONNECTED || tuya.status === STATUS.DISCOVERING_DEVICES;

    if (credentialsChanged || !effectivelyConnected) {
      // Cloud credentials changed (or we are not connected): full reconnect.
      // Await the teardown so the fresh sessions cannot race the old sockets
      // for the devices' single local slot.
      await tuya.disconnect();
      await connectTuya();
      tuya.startReconnect();
      await discoverAndPublish();
      return;
    }
    if (pulsarChanged) {
      // The "Real-time cloud events" toggle changed: (re)start or stop the
      // Pulsar listener without touching the cloud/local connection.
      if (config.pulsarEnabled === true) {
        await tuya.startPulsar();
      } else {
        tuya.stopPulsar();
      }
    }
    if (localModeChanged) {
      if (config.localMode !== true) {
        // Local preference turned off: release every persistent local session
        // (the polls switch to the cloud on their own).
        await tuya.closeAllLocalSessions();
      }
      // Only the "Prefer local" toggle changed: no reconnect, just re-run a
      // background discovery so the LAN scan is (re)applied per the new
      // preference (ON = cloud + UDP scan, OFF = cloud only).
      await discoverAndPublish();
    }
  });
  return configUpdateChain;
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

// --- Last-resort error containment -------------------------------------------
// In the external-integration model an unhandled error kills the whole
// container (there is no core supervisor to catch it): log and keep running.
// Anything reaching these guards is a bug to fix upstream of them.
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection (bug: should be caught upstream)', reason);
});
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception (bug: should be caught upstream)', err);
});

// --- Startup -----------------------------------------------------------------
logger.info('Starting the Tuya integration...');
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
