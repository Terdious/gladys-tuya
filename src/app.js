// -----------------------------------------------------------------------------
// The integration wiring: every SDK handler (discovery, actions, commands,
// polls, configuration, connection lifecycle, shutdown) bound to the Tuya
// handler. index.js only builds the SDK client and the handler, calls
// createTuyaIntegration() and connects; tests pass the SDK's fake Gladys
// (`@gladysassistant/integration-sdk/testing`) and a stub handler instead.
// -----------------------------------------------------------------------------

import { logger } from '@gladysassistant/integration-sdk';
import { normalizeConfig, isConfigured } from './config.js';
import { DEVICE_PARAM_NAME, STATUS } from './tuya/constants.js';
import { getParamValue } from './tuya/utils/tuya.deviceParams.js';
import { getFeatureCode, getTuyaDeviceId } from './tuya/utils/tuya.externalId.js';
import { getLocalDpsFromCode } from './tuya/device/tuya.localMapping.js';
import { buildConfigHash } from './tuya/utils/tuya.config.js';
import { convertDevice } from './tuya/device/tuya.convertDevice.js';
import { applyLocalScanResults } from './tuya/local/tuya.localScan.js';
import { enrichFromCreatedDevices } from './tuya/device/tuya.enrichDiscovery.js';
import { awaitCameraImage, getLastCameraImage } from './tuya/media/tuya.media.js';
import { isSnapshotRefreshDue, refreshCameraSnapshot } from './tuya/media/tuya.liveSnapshot.js';
import { buildDeviceDiagnostic } from './tuya/tuya.diagnostic.js';
import {
  coreSupportsFirstClassFeatureTypes,
  coreSupportsTextSelect,
} from './tuya/utils/tuya.coreVersion.js';
import { resolveTuyaDeviceRef } from './tuya/utils/tuya.resolveDeviceRef.js';
import { getDeviceType, DEVICE_TYPES } from './tuya/mappings/index.js';

// Longest wait for the Tuya teardown on shutdown.
const SHUTDOWN_TIMEOUT_MS = 5000;

// Background LAN re-scan (issue #7): how often a scan is retried while some
// created, LAN-capable device still has no local IP.
const LAN_RESCAN_INTERVAL_MS = 15 * 60 * 1000;

/**
 * @description Register every handler of the integration on the SDK client.
 * @param {object} gladys - The SDK client (GladysIntegration, or its test fake).
 * @param {object} tuya - The Tuya handler (TuyaHandler).
 * @param {object} [options] - Options.
 * @param {number} [options.shutdownTimeoutMs] - Longest wait for the Tuya
 * teardown on shutdown.
 * @param {number} [options.lanRescanIntervalMs] - Period of the background
 * LAN re-scan.
 * @returns {object} Internals exposed for the tests.
 * @example
 * createTuyaIntegration(new GladysIntegration(), new TuyaHandler(gladys));
 */

export function createTuyaIntegration(gladys, tuya, options = {}) {
  const { shutdownTimeoutMs = SHUTDOWN_TIMEOUT_MS, lanRescanIntervalMs = LAN_RESCAN_INTERVAL_MS } =
    options;
  // Current configuration (hot-reloaded via onConfigUpdated).
  let config = normalizeConfig();

  // Whether the running Gladys core (>= 4.84.2) accepts the first-class DOORBELL
  // category and the AC fan-speed / swing feature types. Default false (safe): on
  // an older core those types would make the discovery validator reject the WHOLE
  // Tuya device list. Refreshed from gladys.getStatus() before each publish, so a
  // core upgrade is picked up on the next scan.
  let coreSupportsFirstClassTypes = false;

  // Whether the running Gladys core (>= 4.86.1) accepts the TEXT/SELECT dynamic
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
      logger.warn(
        `Unable to read the Gladys core version (using downgraded features): ${e.message}`,
      );
    }
  }

  /** Convert the discovered raw Tuya devices to Gladys discovery payloads. */
  function buildDiscoveredDevices(tuyaDevices) {
    return tuyaDevices.map((tuyaDevice) =>
      convertDevice(gladys, tuyaDevice, {
        coreSupportsFirstClassTypes,
        coreSupportsTextSelect: coreSupportsTextSelectFlag,
        // Read live off `config` (not cached like the two core-capability flags
        // above): a plain user choice, not something to re-detect on connect.
        featureNamesLang: config.featureNames,
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
        de: 'Noch nicht konfiguriert: geben Sie die Zugangsdaten der Tuya-Cloud ein.',
        es: 'Aún no configurado: introduzca las credenciales de la nube Tuya.',
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
        de: tuya.lastError || 'unbekannter Fehler',
        es: tuya.lastError || 'error desconocido',
      };
      reportConnectionStatus(false, {
        en: `Tuya cloud connection failed: ${reason.en}`,
        fr: `Connexion au cloud Tuya échouée : ${reason.fr || reason.en}`,
        de: `Verbindung zur Tuya-Cloud fehlgeschlagen: ${reason.de || reason.en}`,
        es: `Error de conexión con la nube Tuya: ${reason.es || reason.en}`,
      });
    }
  }

  // In-flight discovery run: connection events and scan requests can overlap,
  // and the core allows a single mediated network scan at a time per
  // integration (409 EXTERNAL_INTEGRATION_SCAN_ALREADY_RUNNING) — concurrent
  // callers just await the run already in progress.
  let discoveryInFlight = null;

  // Everything that rebuilds the shared discovered list (`tuya.discoveredDevices`)
  // and republishes it runs one at a time: a discovery started while
  // detect_protocol is probing would otherwise replace the list between the
  // probe and the republish, and the persisted ip/protocol would be lost
  // (issue #21).
  let deviceListLock = Promise.resolve();
  function withDeviceListLock(fn) {
    const run = deviceListLock.then(fn);
    deviceListLock = run.catch(() => {});
    return run;
  }

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
    discoveryInFlight = withDeviceListLock(async () => {
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
    }).finally(() => {
      discoveryInFlight = null;
    });
    return discoveryInFlight;
  }

  // --- Background LAN re-scan (issue #7) ---------------------------------------
  // The UDP scan of a discovery misses devices that were asleep or silent at
  // that moment. While some created device that COULD run locally still has
  // no LAN info, a scan is retried in the background: a device found is merged
  // into the cached list and republished, so the core stores its ip/protocol
  // and the next poll goes local — no user action. The Tuya cloud only knows
  // the PUBLIC IP of a device, so the scan is the only way to learn the LAN one.

  // Created devices with no LAN info whose features have a local mapping
  // (battery devices with an empty LAN mapping never answer: not waited for).
  function createdDevicesMissingLan() {
    return (gladys.devices || []).filter((device) => {
      const params = (device && device.params) || [];
      if (
        getParamValue(params, DEVICE_PARAM_NAME.IP_ADDRESS) &&
        getParamValue(params, DEVICE_PARAM_NAME.PROTOCOL_VERSION)
      ) {
        return false;
      }
      return (device.features || []).some((feature) => {
        const code = getFeatureCode(feature);
        return code ? getLocalDpsFromCode(code, device) !== null : false;
      });
    });
  }

  async function rescanLan() {
    if (
      config.localMode !== true ||
      tuya.status !== STATUS.CONNECTED ||
      discoveryInFlight ||
      !Array.isArray(tuya.discoveredDevices) ||
      tuya.discoveredDevices.length === 0
    ) {
      return;
    }
    const missingIds = new Set();
    createdDevicesMissingLan().forEach((device) => {
      try {
        missingIds.add(getTuyaDeviceId(device));
      } catch {
        // not a Tuya external id: ignore
      }
    });
    if (missingIds.size === 0) {
      return;
    }
    await withDeviceListLock(async () => {
      const scan = await tuya.localScan({ timeoutSeconds: 10 });
      const found = Object.keys((scan && scan.devices) || {}).filter((id) => missingIds.has(id));
      if (found.length === 0) {
        logger.debug(
          `[Tuya][lanRescan] ${missingIds.size} device(s) still without LAN info, none answered`,
        );
        return;
      }
      tuya.discoveredDevices = enrichFromCreatedDevices(
        applyLocalScanResults(tuya.discoveredDevices, scan.devices, config.localMode),
        gladys.devices,
        config.localMode,
      );
      await publishDiscoveredDevices(tuya.discoveredDevices);
      logger.info(
        `[Tuya][lanRescan] found ${found.length} device(s) on the LAN: ${found.join(', ')}`,
      );
    });
  }

  let lanRescanTimer = null;
  function startLanRescan() {
    if (lanRescanTimer) {
      return;
    }
    lanRescanTimer = setInterval(() => {
      rescanLan().catch((err) => logger.warn('[Tuya][lanRescan] LAN re-scan failed', err));
    }, lanRescanIntervalMs);
    if (typeof lanRescanTimer.unref === 'function') {
      lanRescanTimer.unref();
    }
  }

  // --- Discovery: Gladys asks for the list of devices --------------------------
  gladys.onScanRequest(async () => {
    logger.info('onScanRequest -> discovering Tuya devices');
    await discoverAndPublish();
  });

  // --- Action: manual-IP protocol detection ------------------------------------
  // The device targeted by an action: picked in the list of created devices
  // (`device`, a Gladys external id), or typed for a device not created in
  // Gladys (`device_ref`: name or Tuya id; `device_id` is its pre-1.23 key).
  const getActionDeviceRef = (fields) =>
    String(
      (fields && fields.device) ||
        (fields && fields.device_ref) ||
        (fields && fields.device_id) ||
        '',
    ).trim();

  // For a device the UDP scan did not find, the user types its Tuya id + IP in
  // the Configuration screen (manifest `actions`): the integration probes the
  // local protocol versions, and on success persists ip/protocol on the device
  // through the re-publish params upsert of the core. The resolved message is
  // shown under the action button.
  gladys.onAction('detect_protocol', async (fields) => {
    const deviceRef = getActionDeviceRef(fields);
    const ip = String((fields && fields.ip) || '').trim();
    if (!deviceRef || !ip) {
      throw new Error('Pick a device in the list (or type its name or Tuya id) and its IP address');
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
    return withDeviceListLock(() => detectProtocolAndPersist(deviceRef, ip));
  });

  async function detectProtocolAndPersist(deviceRef, ip) {
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
      de: `Protokoll ${version} unter ${ip} erkannt — Gerät aktualisiert, lokaler Modus bereit.`,
      es: `Protocolo ${version} detectado en ${ip}: dispositivo actualizado, modo local listo.`,
    };
  }

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

  // --- Action: device diagnostic ------------------------------------------------
  // The logs already carry everything needed to support a new model, but each
  // diagnostic line is printed once per device per container start: a user who
  // opens the logs later never finds it. This rebuilds the report on demand.
  gladys.onAction('device_diagnostic', async (fields) => {
    const deviceRef = getActionDeviceRef(fields);
    if (!deviceRef) {
      throw new Error('Pick a device in the list, or type its name or Tuya id');
    }
    if (discoveryInFlight) {
      await discoveryInFlight;
    }
    if (tuya.status !== STATUS.CONNECTED) {
      throw new Error('Tuya cloud is not connected yet');
    }
    logger.info(`onAction device_diagnostic <- device=${deviceRef}`);
    const rawDevice = await resolveTuyaDeviceRef(tuya, deviceRef);
    const report = await buildDeviceDiagnostic(tuya, rawDevice);
    // Also in the logs: a user who cannot copy from the UI still has it.
    logger.info(`[Tuya][diagnostic]\n${report}`);
    return { en: report, fr: report, de: report, es: report };
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
      de: 'Manuell getrennt. Speichern Sie die Konfiguration, um die Verbindung wiederherzustellen.',
      es: 'Desconectado manualmente. Guarde la configuración para volver a conectarse.',
    });
    return {
      en: 'Disconnected from the Tuya cloud. Save the configuration to reconnect.',
      fr: 'Déconnecté du cloud Tuya. Enregistrez la configuration pour vous reconnecter.',
      de: 'Von der Tuya-Cloud getrennt. Speichern Sie die Konfiguration, um die Verbindung wiederherzustellen.',
      es: 'Desconectado de la nube Tuya. Guarde la configuración para volver a conectarse.',
    };
  });

  // --- Command: the user acts on a controllable feature ------------------------
  gladys.onSetValue(async (device, feature, value) => {
    logger.info(`onSetValue <- ${feature.external_id} = ${value}`);
    await tuya.setValue(resolveDevice(device), feature, value);
  });

  // --- Polling: Gladys asks to refresh a device --------------------------------
  gladys.onPoll(async (device) => {
    const resolved = resolveDevice(device);
    await tuya.poll(resolved);
    // Keep the stored image of a camera recent (the dashboard widget shows it,
    // and the core expires it after 1 hour): a live frame every few minutes,
    // in the background so the poll cycle is never held by ffmpeg.
    if (
      tuya.status === STATUS.CONNECTED &&
      getDeviceType(resolved) === DEVICE_TYPES.CAMERA &&
      isSnapshotRefreshDue(tuya, resolved.external_id)
    ) {
      refreshCameraSnapshot(tuya, resolved).catch(() => {});
    }
  });

  // --- Live view: Gladys asks for a fresh camera image -------------------------
  // A frame grabbed from the camera's live stream (RTSPS + ffmpeg); when the
  // stream cannot be read, the last event snapshot (doorbell ring / motion)
  // the media handler stored for this device.
  gladys.onGetImage(async (device) => {
    const resolved = resolveDevice(device);
    // A download in flight (the ring just fired) is awaited first, bounded:
    // the visitor's picture wins over a frame of the stream (and there is no
    // time left for a capture within the core's 15 s after that wait).
    const eventPending = Boolean(
      tuya.pendingCameraImage && tuya.pendingCameraImage[resolved.external_id],
    );
    if (eventPending) {
      const eventImage = await awaitCameraImage(tuya, resolved.external_id);
      if (eventImage) {
        return eventImage;
      }
    } else if (tuya.status === STATUS.CONNECTED) {
      const liveImage = await refreshCameraSnapshot(tuya, resolved);
      if (liveImage) {
        return liveImage;
      }
    }
    const image = getLastCameraImage(tuya, resolved.external_id);
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
      const featureNamesChanged = previousConfig.featureNames !== config.featureNames;
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
      if (featureNamesChanged && !localModeChanged) {
        // Only the feature-name language changed (localModeChanged already
        // rebuilds everything via discoverAndPublish). Re-publish the cached
        // discovered list so the Discover screen switches language right away —
        // buildDiscoveredDevices reads config.featureNames live, no cloud call.
        await publishDiscoveredDevices(tuya.discoveredDevices);
      }
    });
    return configUpdateChain;
  });

  // --- Connection lifecycle ----------------------------------------------------
  // The WebSocket to Gladys can flap (core restart, network blip): every
  // reconnection emits 'connected' again. When the Tuya cloud is still
  // connected with the very same configuration, renegotiating it and re-running
  // a full discovery + LAN scan while the polls are live is wasted work
  // (issue #21): only re-report the status and republish the cached list.
  gladys.on('connected', async () => {
    logger.info('WebSocket connected to Gladys');
    try {
      // 1) Fetch the config filled in by the user.
      const freshConfig = normalizeConfig(await gladys.getConfig());
      const sameConfig = JSON.stringify(freshConfig) === JSON.stringify(config);
      config = freshConfig;
      if (
        sameConfig &&
        tuya.status === STATUS.CONNECTED &&
        Array.isArray(tuya.discoveredDevices) &&
        tuya.discoveredDevices.length > 0
      ) {
        logger.info('Tuya cloud still connected with the same configuration: no reconnect');
        reportConnectionStatus(true);
        await withDeviceListLock(() => publishDiscoveredDevices(tuya.discoveredDevices));
        return;
      }

      // 2) Connect to the Tuya cloud and publish the devices.
      await connectTuya();
      tuya.startReconnect();
      startLanRescan();
      await discoverAndPublish();
    } catch (err) {
      logger.error('Post-connection initialization failed', err);
    }
  });

  gladys.on('disconnected', () => {
    logger.warn('WebSocket disconnected - the SDK will try to reconnect');
  });

  // --- Graceful shutdown -------------------------------------------------------
  // The SDK awaits this cleanup, disconnects cleanly and exits with code 0 when
  // the supervisor stops the container (SIGTERM/SIGINT). Awaiting the Tuya
  // teardown lets the local sockets close before the exit (a device only
  // accepts one local connection), bounded so a stuck socket cannot hold the
  // shutdown (issue #21).
  gladys.handleShutdown(async (signal) => {
    logger.info(`Received ${signal} -> graceful shutdown`);
    clearInterval(lanRescanTimer);
    lanRescanTimer = null;
    let timeoutId;
    await Promise.race([
      tuya.disconnect(),
      new Promise((resolve) => {
        timeoutId = setTimeout(resolve, shutdownTimeoutMs);
      }),
    ]);
    clearTimeout(timeoutId);
  });

  return {
    getConfig: () => config,
    discoverAndPublish,
    rescanLan,
    resolveDevice,
    mergeParams,
  };
}
