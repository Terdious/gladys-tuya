import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';

import { createTuyaIntegration } from '../../src/app.js';
import { STATUS } from '../../src/tuya/constants.js';
import { convertDevice } from '../../src/tuya/device/tuya.convertDevice.js';
import { CAMERA_MOVE } from '../../src/tuya/device/tuya.deviceMapping.js';
import { VACUUM_CLEANER_STATE } from '../../src/devices/vacuum.js';

// The five dashboard widgets: contents checked against the SDK's copy of the
// core vocabulary and budget (validateWidgetContent returns [] when the core
// renders the content exactly as sent).

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9]);
const enumSpec = (code, range) => ({ code, type: 'Enum', values: JSON.stringify({ range }) });
const bool = (code) => ({ code, type: 'Boolean', values: '{}' });
const value = (code, scale, unit) => ({
  code,
  accessMode: 'ro',
  typeSpec: { type: 'value', min: 0, max: 100000, scale, step: 1, unit },
});
const asCreated = (converted) => ({
  ...converted,
  params: [...converted.params, { name: 'DEVICE_TYPE', value: converted.device_type }],
});

const PTZ_CAMERA = asCreated(
  convertDevice(createFakeGladys(), {
    id: 'cam1',
    name: 'Caméra jardin',
    product_id: 'rogprwflblumx2co',
    local_key: 'lk',
    online: true,
    specifications: {
      category: 'sp',
      functions: [
        bool('basic_private'),
        bool('motion_switch'),
        bool('record_switch'),
        enumSpec('ptz_control', ['0', '1', '2', '3', '4', '5', '6', '7']),
      ],
      status: [bool('basic_private'), bool('motion_switch'), bool('record_switch')],
    },
  }),
);
const FIXED_CAMERA = asCreated(
  convertDevice(createFakeGladys(), {
    id: 'cam2',
    name: 'Caméra entrée',
    product_id: 'p-cam2',
    local_key: 'lk',
    online: false,
    specifications: { category: 'sp', functions: [bool('basic_private')], status: [] },
  }),
);
const CLAMP = asCreated(
  convertDevice(createFakeGladys(), {
    id: 'clamp1',
    name: 'Pince PAC',
    product_id: '9rjjf6rdkca9woju',
    online: true,
    specifications: { category: 'zndb', functions: [], status: [] },
    thing_model: {
      services: [
        {
          properties: [
            value('ActivePower', 0, 'W'),
            ...['A', 'B', 'C'].flatMap((p) => [
              value(`ActivePower${p}`, 0, 'W'),
              value(`Current${p}`, 3, 'A'),
              value(`Voltage${p}`, 1, 'V'),
            ]),
            value('Current', 3, 'A'),
            value('EnergyConsumed', 2, 'kWh'),
          ],
        },
      ],
    },
  }),
);
const VACUUM = asCreated(
  convertDevice(createFakeGladys(), {
    id: 'vac1',
    name: 'Aspirateur',
    product_id: 'c4ueb7cxlgmfon1t',
    local_key: 'lk',
    online: true,
    specifications: {
      category: 'sd',
      functions: [
        bool('power_go'),
        bool('pause_switch'),
        bool('charge_switch'),
        enumSpec('fan_mode', ['quiet', 'auto', 'strong', 'max']),
      ],
      status: [
        enumSpec('robot_state', ['cleaning', 'charging']),
        { code: 'battery', type: 'Integer', values: '{"min":0,"max":100}' },
        { code: 'main_brush_time', type: 'Integer', values: '{}' },
        { code: 'side_brush_time', type: 'Integer', values: '{}' },
      ],
    },
  }),
);
const INT = (min, max, unit) => JSON.stringify({ unit, min, max, scale: 0, step: 1 });
const PURIFIER = asCreated(
  convertDevice(createFakeGladys(), {
    id: 'box1',
    name: 'Osmoseur',
    product_id: '4lno1rskgtnivxni',
    online: true,
    specifications: {
      category: 'js',
      functions: [],
      status: [
        { code: 'tds_in', type: 'Integer', values: INT(0, 9999, 'ppm') },
        { code: 'tds_out', type: 'Integer', values: INT(0, 9999, 'ppm') },
        ...['pp', 'cto', 'ro'].flatMap((s) => [
          { code: `${s}_filtertime`, type: 'Integer', values: INT(0, 100, '%') },
          { code: `${s}_filtertime_day`, type: 'Integer', values: INT(0, 9999, 'day') },
        ]),
        enumSpec('status', ['purified', 'standby']),
      ],
    },
  }),
);

const featureId = (device, code) =>
  device.features.find((f) => f.external_id.split(':').pop().toLowerCase() === code.toLowerCase())
    .external_id;

async function setup() {
  const devices = [PTZ_CAMERA, FIXED_CAMERA, CLAMP, VACUUM, PURIFIER];
  const gladys = createFakeGladys({
    selector: 'tuya',
    config: { endpoint: 'westernEurope', access_key: 'a', secret_key: 's', app_account_id: 'u' },
    devices,
  });
  const setValues = [];
  const tuya = {
    status: STATUS.NOT_INITIALIZED,
    config: null,
    discoveredDevices: [],
    gladys,
    featureStates: new Map(),
    lastTransports: new Map(),
    ptzSettleMs: 0,
    connector: {
      request: async () => ({ success: true, result: { url: 'rtsps://stream/token' } }),
    },
    captureFrame: async () => JPEG,
    async connect() {
      this.status = STATUS.CONNECTED;
    },
    async disconnect() {},
    startReconnect() {},
    async startPulsar() {},
    stopPulsar() {},
    async discoverDevices() {
      return [
        { id: 'cam1', online: true },
        { id: 'cam2', online: false },
      ];
    },
    async localScan() {
      return { devices: {} };
    },
    async closeAllLocalSessions() {},
    async poll() {},
    async setValue(device, feature, newValue) {
      setValues.push({ code: feature.external_id.split(':').pop(), value: newValue });
    },
  };
  createTuyaIntegration(gladys, tuya);
  await gladys.connect();
  const setState = (device, code, lastValue) =>
    tuya.featureStates.set(featureId(device, code), { lastValue });
  const get = async (key, settings = {}, language = 'fr') => {
    const ack = await gladys.fake.widgetGet(key, { settings, language });
    assert.equal(ack.success, true, JSON.stringify(ack.error));
    return ack.data.content;
  };
  return { gladys, tuya, setValues, setState, get };
}

const ofType = (content, type) => content.components.filter((c) => c.type === type);

test('camera widget: a live frame, the settings, and the four PTZ arrows', async () => {
  const { gladys, setState, get, setValues } = await setup();
  setState(PTZ_CAMERA, 'basic_private', 0);
  setState(PTZ_CAMERA, 'motion_switch', 1);
  const content = await get('tuya_camera', { camera: PTZ_CAMERA.external_id });
  assert.deepEqual(validateWidgetContent(content), []);

  const [image] = ofType(content, 'image');
  assert.match(image.key, /^cam-[0-9a-f]{20}$/);
  const served = await gladys.fake.widgetGetImage(image.key);
  assert.equal(served.data.image, JPEG.toString('base64'));

  const [status] = ofType(content, 'status');
  assert.deepEqual(
    status.items.map(({ label, value: v }) => [label, v]),
    [
      ['Mode privé', 'Désactivé'],
      ['Détection de mouvement', 'Activé'],
      ['Enregistrement', 'Désactivé'],
    ],
  );
  const buttons = ofType(content, 'button');
  assert.deepEqual(
    buttons.map((b) => [b.label, b.action.key]),
    [
      ['Gauche', 'move_left'],
      ['Haut', 'move_up'],
      ['Bas', 'move_down'],
      ['Droite', 'move_right'],
    ],
  );

  const ack = await gladys.fake.widgetAction(
    'tuya_camera',
    'move_left',
    {},
    { settings: { camera: PTZ_CAMERA.external_id } },
  );
  assert.equal(ack.success, true, JSON.stringify(ack.error));
  assert.deepEqual(setValues, [{ code: 'ptz_control', value: CAMERA_MOVE.PAN_LEFT }]);
});

test('camera widget without PTZ: privacy toggle and refresh buttons', async () => {
  const { gladys, setState, get, setValues } = await setup();
  setState(FIXED_CAMERA, 'basic_private', 1);
  const content = await get('tuya_camera', { camera: FIXED_CAMERA.external_id }, 'en');
  assert.deepEqual(validateWidgetContent(content), []);
  const buttons = ofType(content, 'button');
  assert.deepEqual(
    buttons.map((b) => [b.label, b.action.key, b.action.params]),
    [
      ['Privacy off', 'privacy', { value: 0 }],
      ['Refresh', 'refresh', undefined],
    ],
  );
  const ack = await gladys.fake.widgetAction(
    'tuya_camera',
    'privacy',
    { value: 0 },
    { settings: { camera: FIXED_CAMERA.external_id } },
  );
  assert.equal(ack.data.message.fr, 'Mode privé désactivé');
  assert.deepEqual(setValues, [{ code: 'basic_private', value: 0 }]);
});

test('a widget pointing at a device of another kind asks to pick the right one', async () => {
  const { get } = await setup();
  const content = await get('tuya_camera', { camera: CLAMP.external_id });
  assert.deepEqual(validateWidgetContent(content), []);
  assert.match(content.components[0].text, /Choisissez une caméra Tuya/);
  const vacuum = await get('tuya_vacuum', {}, 'de');
  assert.match(vacuum.components[0].text, /Saugroboter/);
});

test('energy widget: power gauge, the three phases live, current, energy, 24 h chart, voltages', async () => {
  const { setState, get } = await setup();
  setState(CLAMP, 'VoltageA', 225.5);
  setState(CLAMP, 'CurrentA', 0.516);
  const content = await get('tuya_energy', { meter: CLAMP.external_id, max_power: 9000 });
  assert.deepEqual(validateWidgetContent(content), []);
  const [gauge] = ofType(content, 'gauge');
  assert.equal(gauge.device_feature, featureId(CLAMP, 'ActivePower'));
  assert.equal(gauge.max, 9000);
  assert.deepEqual(
    ofType(content, 'value').map((c) => c.device_feature),
    ['ActivePowerA', 'ActivePowerB', 'ActivePowerC', 'Current', 'EnergyConsumed'].map((code) =>
      featureId(CLAMP, code),
    ),
  );
  const [chart] = ofType(content, 'chart');
  assert.deepEqual(chart.device_features, [featureId(CLAMP, 'ActivePower')]);
  const [status] = ofType(content, 'status');
  assert.deepEqual(status.items[0], { label: 'Phase A', value: '225.5 V · 0.52 A' });
});

test('overview widget: counts, cloud status, the devices needing attention, a scan button', async () => {
  const { gladys, tuya, get } = await setup();
  tuya.lastTransports.set(CLAMP.external_id, 'local|0');
  tuya.lastTransports.set(VACUUM.external_id, 'cloud|1');
  const content = await get('tuya_overview', {}, 'en');
  assert.deepEqual(validateWidgetContent(content), []);
  assert.deepEqual(
    ofType(content, 'value').map((c) => [c.label, c.value]),
    [
      ['Devices', 5],
      ['Local', 1],
      ['Cloud', 3],
      ['Offline', 1],
    ],
  );
  const [list] = ofType(content, 'card-list');
  assert.deepEqual(
    list.items.map((item) => [item.title, item.badge.text]),
    [
      ['Caméra entrée', 'Offline'],
      ['Aspirateur', 'Degraded'],
    ],
  );
  const ack = await gladys.fake.widgetAction('tuya_overview', 'scan');
  assert.equal(ack.success, true);
  assert.match(ack.data.message.en, /Scan started/);
});

test('vacuum widget: battery, brushes, state and the three buttons bound to the device', async () => {
  const { setState, get } = await setup();
  setState(VACUUM, 'robot_state', VACUUM_CLEANER_STATE.CHARGING);
  setState(VACUUM, 'fan_mode', 'strong');
  const content = await get('tuya_vacuum', { vacuum: VACUUM.external_id });
  assert.deepEqual(validateWidgetContent(content), []);
  const [status] = ofType(content, 'status');
  assert.deepEqual(status.items[0], { label: 'État', value: 'En charge', color: 'success' });
  assert.deepEqual(
    ofType(content, 'button').map((b) => [b.label, b.device_feature, b.value]),
    [
      ['Démarrer', featureId(VACUUM, 'power_go'), 1],
      ['Pause', featureId(VACUUM, 'pause_switch'), 1],
      ['Base', featureId(VACUUM, 'charge_switch'), 1],
    ],
  );
});

test('water purifier widget: three filter gauges, TDS in/out, days left', async () => {
  const { setState, get } = await setup();
  setState(PURIFIER, 'ro_filtertime_day', 12);
  const content = await get('tuya_water_purifier', { purifier: PURIFIER.external_id }, 'en');
  assert.deepEqual(validateWidgetContent(content), []);
  assert.equal(ofType(content, 'gauge').length, 3);
  assert.equal(ofType(content, 'value').length, 2);
  const [status] = ofType(content, 'status');
  const ro = status.items.find((item) => item.value === '12 days left');
  assert.equal(ro.color, 'warning');
});
