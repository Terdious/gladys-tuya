// -----------------------------------------------------------------------------
// Dashboard widgets (Gladys >= 5.1.0, manifest `widgets`).
//
// The core renders a declarative content (tiles, status rows, chart, image,
// buttons) the integration produces on demand. Five widgets:
//   - tuya_camera          a live frame of a camera (RTSPS snapshot), its
//                          privacy / motion settings, PTZ arrows;
//   - tuya_energy          a power meter (three-phase clamp, smart meter,
//                          smart socket): power gauge, phases, energy, chart;
//   - tuya_overview        the integration at a glance: devices online,
//                          local / cloud, the ones needing attention;
//   - tuya_vacuum          a robot vacuum: state, battery, brushes, buttons;
//   - tuya_water_purifier  a water purifier: filter life gauges, TDS.
// Device-bound tiles and charts follow the published states live; status
// rows and images are re-pulled on the content `ttl_seconds`.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import {
  createLogger,
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  WIDGET_COLORS,
} from '@gladysassistant/integration-sdk';

import { STATUS } from '../constants.js';
import { getDeviceType, DEVICE_TYPES } from '../mappings/index.js';
import { getTuyaDeviceId } from '../utils/tuya.externalId.js';
import { CAMERA_MOVE } from '../device/tuya.deviceMapping.js';
import { getLastCameraImage } from '../media/tuya.media.js';
import { refreshCameraSnapshot } from '../media/tuya.liveSnapshot.js';
import { VACUUM_CLEANER_STATE } from '../../devices/vacuum.js';

const logger = createLogger({ name: 'tuya' });

export const WIDGET_KEYS = {
  CAMERA: 'tuya_camera',
  ENERGY: 'tuya_energy',
  OVERVIEW: 'tuya_overview',
  VACUUM: 'tuya_vacuum',
  WATER_PURIFIER: 'tuya_water_purifier',
};

const IMAGE_PREFIX = /^image\/[a-z]+;base64,/;
// Images served by onWidgetGetImage, by key (the core caches them 1 h by key).
const MAX_WIDGET_IMAGES = 30;
// After a PTZ move (stopped by the 2 s watchdog), the frame shown next.
const PTZ_SETTLE_MS = 2500;

// One action key per arrow (the core drops buttons sharing an action key).
const PTZ_ACTIONS = {
  move_left: CAMERA_MOVE.PAN_LEFT,
  move_up: CAMERA_MOVE.TILT_UP,
  move_down: CAMERA_MOVE.TILT_DOWN,
  move_right: CAMERA_MOVE.PAN_RIGHT,
};

const TEXT = {
  chooseCamera: {
    en: 'Choose a Tuya camera in the widget settings.',
    fr: 'Choisissez une caméra Tuya dans les réglages du widget.',
    de: 'Wählen Sie in den Widget-Einstellungen eine Tuya-Kamera.',
    es: 'Elija una cámara Tuya en los ajustes del widget.',
  },
  chooseMeter: {
    en: 'Choose a Tuya meter or socket measuring power in the widget settings.',
    fr: 'Choisissez un compteur ou une prise Tuya mesurant la puissance dans les réglages du widget.',
    de: 'Wählen Sie in den Widget-Einstellungen einen Tuya-Zähler oder eine Steckdose mit Leistungsmessung.',
    es: 'Elija un medidor o enchufe Tuya que mida la potencia en los ajustes del widget.',
  },
  chooseVacuum: {
    en: 'Choose a Tuya robot vacuum in the widget settings.',
    fr: 'Choisissez un aspirateur robot Tuya dans les réglages du widget.',
    de: 'Wählen Sie in den Widget-Einstellungen einen Tuya-Saugroboter.',
    es: 'Elija un robot aspirador Tuya en los ajustes del widget.',
  },
  choosePurifier: {
    en: 'Choose a Tuya water purifier in the widget settings.',
    fr: 'Choisissez un purificateur d’eau Tuya dans les réglages du widget.',
    de: 'Wählen Sie in den Widget-Einstellungen einen Tuya-Wasserfilter.',
    es: 'Elija un purificador de agua Tuya en los ajustes del widget.',
  },
  noImage: {
    en: 'No image yet: it appears once the live stream or a motion event provides one.',
    fr: 'Pas encore d’image : elle apparaît dès que le flux en direct ou un mouvement en fournit une.',
    de: 'Noch kein Bild: Es erscheint, sobald der Live-Stream oder eine Bewegung eines liefert.',
    es: 'Aún no hay imagen: aparece en cuanto el vídeo en directo o un movimiento la proporciona.',
  },
  on: { en: 'On', fr: 'Activé', de: 'Ein', es: 'Activado' },
  off: { en: 'Off', fr: 'Désactivé', de: 'Aus', es: 'Desactivado' },
  privacy: { en: 'Privacy mode', fr: 'Mode privé', de: 'Privatmodus', es: 'Modo privado' },
  privacyOn: { en: 'Privacy on', fr: 'Mode privé', de: 'Privatmodus an', es: 'Modo privado' },
  privacyOff: {
    en: 'Privacy off',
    fr: 'Quitter privé',
    de: 'Privatmodus aus',
    es: 'Salir privado',
  },
  privacyEnabled: {
    en: 'Privacy mode enabled',
    fr: 'Mode privé activé',
    de: 'Privatmodus aktiviert',
    es: 'Modo privado activado',
  },
  privacyDisabled: {
    en: 'Privacy mode disabled',
    fr: 'Mode privé désactivé',
    de: 'Privatmodus deaktiviert',
    es: 'Modo privado desactivado',
  },
  motionDetection: {
    en: 'Motion detection',
    fr: 'Détection de mouvement',
    de: 'Bewegungserkennung',
    es: 'Detección de movimiento',
  },
  recording: { en: 'Recording', fr: 'Enregistrement', de: 'Aufnahme', es: 'Grabación' },
  refresh: { en: 'Refresh', fr: 'Actualiser', de: 'Aktualisieren', es: 'Actualizar' },
  left: { en: 'Left', fr: 'Gauche', de: 'Links', es: 'Izquierda' },
  right: { en: 'Right', fr: 'Droite', de: 'Rechts', es: 'Derecha' },
  up: { en: 'Up', fr: 'Haut', de: 'Hoch', es: 'Arriba' },
  down: { en: 'Down', fr: 'Bas', de: 'Runter', es: 'Abajo' },
  powerToday: {
    en: 'Power, last 24 h',
    fr: 'Puissance sur 24 h',
    de: 'Leistung, letzte 24 h',
    es: 'Potencia, últimas 24 h',
  },
  phase: { en: 'Phase', fr: 'Phase', de: 'Phase', es: 'Fase' },
  devices: { en: 'Devices', fr: 'Appareils', de: 'Geräte', es: 'Dispositivos' },
  local: { en: 'Local', fr: 'Local', de: 'Lokal', es: 'Local' },
  cloud: { en: 'Cloud', fr: 'Cloud', de: 'Cloud', es: 'Nube' },
  offline: { en: 'Offline', fr: 'Hors ligne', de: 'Offline', es: 'Sin conexión' },
  degraded: { en: 'Degraded', fr: 'Dégradé', de: 'Eingeschränkt', es: 'Degradado' },
  degradedDetail: {
    en: 'Local unreachable, served by the cloud',
    fr: 'Local injoignable, servi par le cloud',
    de: 'Lokal nicht erreichbar, über die Cloud',
    es: 'Local inaccesible, servido por la nube',
  },
  offlineDetail: {
    en: 'Not reachable by the Tuya cloud',
    fr: 'Injoignable par le cloud Tuya',
    de: 'Für die Tuya-Cloud nicht erreichbar',
    es: 'Inaccesible para la nube Tuya',
  },
  allGood: {
    en: 'Every device answers normally.',
    fr: 'Tous les appareils répondent normalement.',
    de: 'Alle Geräte antworten normal.',
    es: 'Todos los dispositivos responden con normalidad.',
  },
  tuyaCloud: { en: 'Tuya cloud', fr: 'Cloud Tuya', de: 'Tuya-Cloud', es: 'Nube Tuya' },
  connected: { en: 'Connected', fr: 'Connecté', de: 'Verbunden', es: 'Conectado' },
  disconnected: { en: 'Disconnected', fr: 'Déconnecté', de: 'Getrennt', es: 'Desconectado' },
  localMode: { en: 'Local mode', fr: 'Mode local', de: 'Lokaler Modus', es: 'Modo local' },
  realtime: {
    en: 'Real-time events',
    fr: 'Événements temps réel',
    de: 'Echtzeit-Ereignisse',
    es: 'Eventos en tiempo real',
  },
  scan: { en: 'Scan devices', fr: 'Rechercher', de: 'Geräte suchen', es: 'Buscar' },
  scanStarted: {
    en: 'Scan started, the widget updates when it ends',
    fr: 'Recherche lancée, le widget se met à jour à la fin',
    de: 'Suche gestartet, das Widget aktualisiert sich danach',
    es: 'Búsqueda iniciada, el widget se actualiza al terminar',
  },
  state: { en: 'State', fr: 'État', de: 'Zustand', es: 'Estado' },
  start: { en: 'Start', fr: 'Démarrer', de: 'Starten', es: 'Iniciar' },
  pause: { en: 'Pause', fr: 'Pause', de: 'Pause', es: 'Pausa' },
  dock: { en: 'Dock', fr: 'Base', de: 'Station', es: 'Base' },
  daysLeft: { en: 'days left', fr: 'jours restants', de: 'Tage übrig', es: 'días restantes' },
};

const VACUUM_STATE_LABELS = {
  [VACUUM_CLEANER_STATE.STOPPED]: { en: 'Stopped', fr: 'Arrêté', de: 'Gestoppt', es: 'Detenido' },
  [VACUUM_CLEANER_STATE.RUNNING]: {
    en: 'Cleaning',
    fr: 'Nettoyage',
    de: 'Reinigt',
    es: 'Limpiando',
  },
  [VACUUM_CLEANER_STATE.PAUSED]: { en: 'Paused', fr: 'En pause', de: 'Pausiert', es: 'En pausa' },
  [VACUUM_CLEANER_STATE.ERROR]: { en: 'Error', fr: 'Erreur', de: 'Fehler', es: 'Error' },
  [VACUUM_CLEANER_STATE.RETURNING_TO_DOCK]: {
    en: 'Returning to dock',
    fr: 'Retour à la base',
    de: 'Fährt zur Station',
    es: 'Volviendo a la base',
  },
  [VACUUM_CLEANER_STATE.CHARGING]: { en: 'Charging', fr: 'En charge', de: 'Lädt', es: 'Cargando' },
  [VACUUM_CLEANER_STATE.DOCKED]: {
    en: 'Docked',
    fr: 'Sur la base',
    de: 'In der Station',
    es: 'En la base',
  },
};

const VACUUM_STATE_COLORS = {
  [VACUUM_CLEANER_STATE.RUNNING]: WIDGET_COLORS.PRIMARY,
  [VACUUM_CLEANER_STATE.ERROR]: WIDGET_COLORS.DANGER,
  [VACUUM_CLEANER_STATE.CHARGING]: WIDGET_COLORS.SUCCESS,
  [VACUUM_CLEANER_STATE.DOCKED]: WIDGET_COLORS.SUCCESS,
};

// --- helpers -----------------------------------------------------------------

const pick = (text, language) => (text && (text[language] || text.en)) || '';

const message = (text) => ({ en: text.en, fr: text.fr, de: text.de, es: text.es });

const emptyState = (text, language) => ({
  ttl_seconds: 300,
  components: [{ type: 'text', variant: 'body', text: pick(text, language) }],
});

const featureCode = (feature) =>
  String((feature && feature.external_id) || '')
    .split(':')
    .pop()
    .toLowerCase();

const findFeature = (device, codes) => {
  const wanted = (Array.isArray(codes) ? codes : [codes]).map((code) => code.toLowerCase());
  const features = Array.isArray(device && device.features) ? device.features : [];
  for (const code of wanted) {
    const feature = features.find((f) => featureCode(f) === code);
    if (feature) {
      return feature;
    }
  }
  return null;
};

const findFeatureByType = (device, category, type) =>
  (Array.isArray(device && device.features) ? device.features : []).find(
    (feature) => feature.category === category && feature.type === type,
  ) || null;

// The live value of a feature: the last state this process published, else
// the value Gladys stored.
const currentValue = (tuya, feature) => {
  if (!feature) {
    return undefined;
  }
  const state = tuya.featureStates && tuya.featureStates.get(feature.external_id);
  if (state && state.lastValue !== undefined && state.lastValue !== null) {
    return state.lastValue;
  }
  return feature.last_value_string ?? feature.last_value;
};

const isOn = (value) => value === 1 || value === true || value === '1';

const optionLabel = (feature, value) => {
  const option = (feature.supported_options || []).find((o) => String(o.value) === String(value));
  return option ? option.label : String(value);
};

const formatNumber = (value, digits) =>
  Number.isFinite(Number(value))
    ? String(Math.round(Number(value) * 10 ** digits) / 10 ** digits)
    : '–';

const truncate = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/**
 * @description Wire the Tuya dashboard widgets on the SDK client.
 * @param {object} gladys - The SDK client.
 * @param {object} tuya - The TuyaHandler.
 * @param {object} ctx - `{ resolveDevice, discoverAndPublish, getConfig }` from app.js.
 * @returns {object} The content builders (tests).
 * @example
 * registerTuyaWidgets(gladys, tuya, { resolveDevice, discoverAndPublish, getConfig });
 */
export function registerTuyaWidgets(gladys, tuya, ctx) {
  const images = new Map();

  const findDevice = (externalId, types) => {
    const device = (gladys.devices || []).find((d) => d.external_id === externalId);
    if (!device) {
      return null;
    }
    const resolved = ctx.resolveDevice(device);
    if (types && !types.includes(getDeviceType(resolved))) {
      return null;
    }
    return resolved;
  };

  const storeImage = (image) => {
    const raw = String(image).replace(IMAGE_PREFIX, '');
    const key = `cam-${createHash('sha1').update(raw).digest('hex').slice(0, 20)}`;
    images.delete(key);
    images.set(key, raw);
    while (images.size > MAX_WIDGET_IMAGES) {
      images.delete(images.keys().next().value);
    }
    return key;
  };

  // --- camera ------------------------------------------------------------------

  const buildCamera = async ({ settings, language }) => {
    const device = findDevice(settings.camera, [DEVICE_TYPES.CAMERA, DEVICE_TYPES.VIDEO_DOORBELL]);
    if (!device) {
      return emptyState(TEXT.chooseCamera, language);
    }
    let image = null;
    if (tuya.status === STATUS.CONNECTED) {
      image = await refreshCameraSnapshot(tuya, device);
    }
    image = image || getLastCameraImage(tuya, device.external_id);
    const components = [];
    if (image) {
      components.push({ type: 'image', key: storeImage(image), alt: device.name, fit: 'cover' });
    } else {
      components.push({ type: 'text', variant: 'caption', text: pick(TEXT.noImage, language) });
    }

    const privacy = findFeature(device, 'basic_private');
    const items = [
      [privacy, TEXT.privacy, WIDGET_COLORS.WARNING],
      [findFeature(device, 'motion_switch'), TEXT.motionDetection, WIDGET_COLORS.SUCCESS],
      [findFeature(device, 'record_switch'), TEXT.recording, WIDGET_COLORS.SUCCESS],
    ]
      .filter(([feature]) => feature)
      .map(([feature, label, colorWhenOn]) => {
        const on = isOn(currentValue(tuya, feature));
        return {
          label: pick(label, language),
          value: pick(on ? TEXT.on : TEXT.off, language),
          color: on ? colorWhenOn : WIDGET_COLORS.NEUTRAL,
        };
      });
    if (items.length > 0) {
      components.push({ type: 'status', items });
    }

    const ptz = findFeatureByType(
      device,
      DEVICE_FEATURE_CATEGORIES.CAMERA,
      DEVICE_FEATURE_TYPES.CAMERA.MOVE,
    );
    if (ptz) {
      [
        ['move_left', TEXT.left, 'arrow-left'],
        ['move_up', TEXT.up, 'arrow-up'],
        ['move_down', TEXT.down, 'arrow-down'],
        ['move_right', TEXT.right, 'arrow-right'],
      ].forEach(([key, label, icon]) =>
        components.push({
          type: 'button',
          label: pick(label, language),
          icon,
          style: 'secondary',
          action: { key },
        }),
      );
    } else {
      if (privacy) {
        const on = isOn(currentValue(tuya, privacy));
        components.push({
          type: 'button',
          label: pick(on ? TEXT.privacyOff : TEXT.privacyOn, language),
          icon: on ? 'eye' : 'eye-off',
          style: 'secondary',
          action: { key: 'privacy', params: { value: on ? 0 : 1 } },
        });
      }
      components.push({
        type: 'button',
        label: pick(TEXT.refresh, language),
        icon: 'refresh-cw',
        style: 'secondary',
        action: { key: 'refresh' },
      });
    }
    return { ttl_seconds: 60, components };
  };

  const cameraAction = async (actionKey, params, { settings }) => {
    const device = findDevice(settings.camera, [DEVICE_TYPES.CAMERA, DEVICE_TYPES.VIDEO_DOORBELL]);
    if (!device) {
      throw new Error('Camera not found');
    }
    if (Object.prototype.hasOwnProperty.call(PTZ_ACTIONS, actionKey)) {
      const ptz = findFeatureByType(
        device,
        DEVICE_FEATURE_CATEGORIES.CAMERA,
        DEVICE_FEATURE_TYPES.CAMERA.MOVE,
      );
      if (!ptz) {
        throw new Error('This camera cannot move');
      }
      await tuya.setValue(device, ptz, PTZ_ACTIONS[actionKey]);
      // The move runs until the watchdog stops it: show the new view.
      await new Promise((resolve) => {
        setTimeout(resolve, tuya.ptzSettleMs ?? PTZ_SETTLE_MS);
      });
      await refreshCameraSnapshot(tuya, device, { maxAgeMs: 0 });
      return undefined;
    }
    if (actionKey === 'privacy') {
      const privacy = findFeature(device, 'basic_private');
      if (!privacy) {
        throw new Error('This camera has no privacy mode');
      }
      const value = Number(params.value) === 1 ? 1 : 0;
      await tuya.setValue(device, privacy, value);
      return message(value === 1 ? TEXT.privacyEnabled : TEXT.privacyDisabled);
    }
    if (actionKey === 'refresh') {
      await refreshCameraSnapshot(tuya, device, { maxAgeMs: 0 });
      return undefined;
    }
    throw new Error(`Unknown action ${actionKey}`);
  };

  // --- energy ------------------------------------------------------------------

  const ENERGY_CATEGORIES = [
    DEVICE_FEATURE_CATEGORIES.ENERGY_SENSOR,
    DEVICE_FEATURE_CATEGORIES.SWITCH,
  ];
  const energyFeatures = (device, type) =>
    (device.features || []).filter(
      (feature) => ENERGY_CATEGORIES.includes(feature.category) && feature.type === type,
    );

  const buildEnergy = async ({ settings, language }) => {
    const device = findDevice(settings.meter);
    const powers = device ? energyFeatures(device, DEVICE_FEATURE_TYPES.ENERGY_SENSOR.POWER) : [];
    if (powers.length === 0) {
      return emptyState(TEXT.chooseMeter, language);
    }
    const total = findFeature(device, ['activepower', 'total_power', 'cur_power']) || powers[0];
    const phases = ['activepowera', 'activepowerb', 'activepowerc']
      .map((code) => findFeature(device, code))
      .filter(Boolean);
    const energy =
      findFeature(device, ['energyconsumed', 'forward_energy_total', 'add_ele']) ||
      energyFeatures(device, DEVICE_FEATURE_TYPES.ENERGY_SENSOR.ENERGY)[0];
    const current =
      findFeature(device, ['current', 'cur_current']) ||
      energyFeatures(device, DEVICE_FEATURE_TYPES.ENERGY_SENSOR.CURRENT)[0];
    const voltage =
      findFeature(device, ['cur_voltage', 'voltage_a', 'voltagea']) ||
      energyFeatures(device, DEVICE_FEATURE_TYPES.ENERGY_SENSOR.VOLTAGE)[0];

    const maxPower = Number(settings.max_power) > 0 ? Number(settings.max_power) : 6000;
    const components = [
      {
        type: 'gauge',
        label: truncate(total.name, 24),
        device_feature: total.external_id,
        min: 0,
        max: maxPower,
      },
    ];
    const tile = (feature) => ({
      type: 'value',
      label: truncate(feature.name, 24),
      device_feature: feature.external_id,
    });
    if (phases.length > 0) {
      phases.forEach((feature) => components.push(tile(feature)));
    } else if (voltage) {
      components.push(tile(voltage));
    }
    [current, energy].filter(Boolean).forEach((feature) => components.push(tile(feature)));
    components.push({
      type: 'chart',
      title: pick(TEXT.powerToday, language),
      chart_type: 'area',
      device_features: [total.external_id],
      interval: 'last-day',
    });
    if (phases.length > 0) {
      const items = ['a', 'b', 'c']
        .map((phase) => {
          const v = findFeature(device, `voltage${phase}`);
          const i = findFeature(device, `current${phase}`);
          if (!v && !i) {
            return null;
          }
          const parts = [];
          if (v) {
            parts.push(`${formatNumber(currentValue(tuya, v), 1)} V`);
          }
          if (i) {
            parts.push(`${formatNumber(currentValue(tuya, i), 2)} A`);
          }
          return {
            label: `${pick(TEXT.phase, language)} ${phase.toUpperCase()}`,
            value: parts.join(' · '),
          };
        })
        .filter(Boolean);
      if (items.length > 0) {
        components.push({ type: 'status', items });
      }
    }
    return { ttl_seconds: 60, components };
  };

  // --- overview ----------------------------------------------------------------

  const buildOverview = async ({ language }) => {
    const config = ctx.getConfig() || {};
    const devices = gladys.devices || [];
    const onlineById = new Map(
      (tuya.discoveredDevices || []).map((raw) => [String(raw.id), raw.online]),
    );
    const transports = tuya.lastTransports || new Map();
    let local = 0;
    let cloud = 0;
    let offline = 0;
    const problems = [];
    devices.forEach((device) => {
      let id;
      try {
        id = getTuyaDeviceId(device);
      } catch {
        id = device.external_id;
      }
      const [transport, degraded] = String(transports.get(device.external_id) || '').split('|');
      const isOffline = onlineById.get(String(id)) === false || transport === 'unreachable';
      if (isOffline) {
        offline += 1;
        problems.push({
          title: truncate(device.name || String(id), 60),
          subtitle: pick(TEXT.offlineDetail, language),
          badge: { text: pick(TEXT.offline, language), color: WIDGET_COLORS.DANGER },
        });
        return;
      }
      if (transport === 'local') {
        local += 1;
      } else {
        cloud += 1;
      }
      if (degraded === '1') {
        problems.push({
          title: truncate(device.name || String(id), 60),
          subtitle: pick(TEXT.degradedDetail, language),
          badge: { text: pick(TEXT.degraded, language), color: WIDGET_COLORS.WARNING },
        });
      }
    });
    const connected = tuya.status === STATUS.CONNECTED;
    const components = [
      { type: 'value', label: pick(TEXT.devices, language), value: devices.length, icon: 'cpu' },
      { type: 'value', label: pick(TEXT.local, language), value: local, icon: 'home' },
      { type: 'value', label: pick(TEXT.cloud, language), value: cloud, icon: 'cloud' },
      {
        type: 'value',
        label: pick(TEXT.offline, language),
        value: offline,
        icon: 'wifi-off',
        color: offline > 0 ? WIDGET_COLORS.DANGER : WIDGET_COLORS.SUCCESS,
      },
      {
        type: 'status',
        items: [
          {
            label: pick(TEXT.tuyaCloud, language),
            value: pick(connected ? TEXT.connected : TEXT.disconnected, language),
            color: connected ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.DANGER,
          },
          {
            label: pick(TEXT.localMode, language),
            value: pick(config.localMode ? TEXT.on : TEXT.off, language),
            color: config.localMode ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.NEUTRAL,
          },
          {
            label: pick(TEXT.realtime, language),
            value: pick(config.pulsarEnabled ? TEXT.on : TEXT.off, language),
            color: config.pulsarEnabled ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.NEUTRAL,
          },
        ],
      },
    ];
    if (problems.length > 0) {
      components.push({ type: 'card-list', display: 'list', items: problems.slice(0, 8) });
    } else {
      components.push({ type: 'text', variant: 'caption', text: pick(TEXT.allGood, language) });
    }
    components.push({
      type: 'button',
      label: pick(TEXT.scan, language),
      icon: 'search',
      style: 'secondary',
      action: { key: 'scan' },
    });
    return { ttl_seconds: 60, components };
  };

  const overviewAction = async (actionKey) => {
    if (actionKey !== 'scan') {
      throw new Error(`Unknown action ${actionKey}`);
    }
    // A discovery (cloud + LAN scan) can outlast the action ack: run it in
    // the background and nudge the widget when it ends.
    Promise.resolve()
      .then(() => ctx.discoverAndPublish())
      .catch((e) => logger.warn(`[Tuya][widget] scan failed: ${e.message}`))
      .finally(() => gladys.requestWidgetRefresh(WIDGET_KEYS.OVERVIEW));
    return message(TEXT.scanStarted);
  };

  // --- vacuum ------------------------------------------------------------------

  const buildVacuum = async ({ settings, language }) => {
    const device = findDevice(settings.vacuum, [DEVICE_TYPES.VACUUM]);
    if (!device) {
      return emptyState(TEXT.chooseVacuum, language);
    }
    const components = [];
    const battery = findFeature(device, 'battery');
    if (battery) {
      components.push({
        type: 'value',
        label: truncate(battery.name, 24),
        device_feature: battery.external_id,
      });
    }
    ['main_brush_time', 'side_brush_time']
      .map((code) => findFeature(device, code))
      .filter(Boolean)
      .forEach((feature) =>
        components.push({
          type: 'gauge',
          label: truncate(feature.name, 24),
          device_feature: feature.external_id,
          min: 0,
          max: 100,
        }),
      );
    const items = [];
    const state = findFeature(device, 'robot_state');
    if (state) {
      const value = Number(currentValue(tuya, state));
      items.push({
        label: pick(TEXT.state, language),
        value: VACUUM_STATE_LABELS[value] ? pick(VACUUM_STATE_LABELS[value], language) : '–',
        color: VACUUM_STATE_COLORS[value] || WIDGET_COLORS.NEUTRAL,
      });
    }
    ['fan_mode', 'water_mode']
      .map((code) => findFeature(device, code))
      .filter(Boolean)
      .forEach((feature) => {
        const value = currentValue(tuya, feature);
        items.push({
          label: truncate(feature.name, 40),
          value:
            value === undefined || value === null ? '–' : truncate(optionLabel(feature, value), 40),
        });
      });
    if (items.length > 0) {
      components.push({ type: 'status', items });
    }
    [
      ['power_go', TEXT.start, 'play', 'primary'],
      ['pause_switch', TEXT.pause, 'pause', 'secondary'],
      ['charge_switch', TEXT.dock, 'home', 'secondary'],
    ].forEach(([code, label, icon, style]) => {
      const feature = findFeature(device, code);
      if (feature) {
        components.push({
          type: 'button',
          label: pick(label, language),
          icon,
          style,
          device_feature: feature.external_id,
          value: 1,
        });
      }
    });
    return { ttl_seconds: 30, components };
  };

  // --- water purifier ----------------------------------------------------------

  const buildWaterPurifier = async ({ settings, language }) => {
    const device = findDevice(settings.purifier, [DEVICE_TYPES.WATER_PURIFIER]);
    if (!device) {
      return emptyState(TEXT.choosePurifier, language);
    }
    const components = [];
    ['pp_filtertime', 'cto_filtertime', 'ro_filtertime']
      .map((code) => findFeature(device, code))
      .filter(Boolean)
      .forEach((feature) =>
        components.push({
          type: 'gauge',
          label: truncate(feature.name, 24),
          device_feature: feature.external_id,
          min: 0,
          max: 100,
        }),
      );
    ['tds_in', 'tds_out']
      .map((code) => findFeature(device, code))
      .filter(Boolean)
      .forEach((feature) =>
        components.push({
          type: 'value',
          label: truncate(feature.name, 24),
          device_feature: feature.external_id,
        }),
      );
    const items = [];
    const status = findFeature(device, 'status');
    if (status) {
      const value = currentValue(tuya, status);
      items.push({
        label: truncate(status.name, 40),
        value:
          value === undefined || value === null ? '–' : truncate(optionLabel(status, value), 40),
      });
    }
    ['pp_filtertime_day', 'cto_filtertime_day', 'ro_filtertime_day']
      .map((code) => findFeature(device, code))
      .filter(Boolean)
      .forEach((feature) => {
        const days = currentValue(tuya, feature);
        items.push({
          label: truncate(feature.name, 40),
          value: Number.isFinite(Number(days))
            ? `${Number(days)} ${pick(TEXT.daysLeft, language)}`
            : '–',
          color: Number(days) <= 15 ? WIDGET_COLORS.WARNING : WIDGET_COLORS.NEUTRAL,
        });
      });
    if (items.length > 0) {
      components.push({ type: 'status', items });
    }
    return { ttl_seconds: 300, components };
  };

  gladys.onWidgetGet(WIDGET_KEYS.CAMERA, buildCamera);
  gladys.onWidgetGet(WIDGET_KEYS.ENERGY, buildEnergy);
  gladys.onWidgetGet(WIDGET_KEYS.OVERVIEW, buildOverview);
  gladys.onWidgetGet(WIDGET_KEYS.VACUUM, buildVacuum);
  gladys.onWidgetGet(WIDGET_KEYS.WATER_PURIFIER, buildWaterPurifier);
  gladys.onWidgetAction(WIDGET_KEYS.CAMERA, cameraAction);
  gladys.onWidgetAction(WIDGET_KEYS.OVERVIEW, overviewAction);
  gladys.onWidgetGetImage(async (imageKey) => {
    const image = images.get(imageKey);
    if (!image) {
      throw new Error(`Unknown widget image ${imageKey}`);
    }
    return image;
  });

  return { buildCamera, buildEnergy, buildOverview, buildVacuum, buildWaterPurifier };
}
