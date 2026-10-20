import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import { createFakeGladys as createSdkFakeGladys } from '@gladysassistant/integration-sdk/testing';

import { createTuyaIntegration } from '../../src/app.js';
import { TuyaHandler } from '../../src/tuya/handler.js';
import { STATUS, DEVICE_PARAM_NAME } from '../../src/tuya/constants.js';
import { convertDevice } from '../../src/tuya/device/tuya.convertDevice.js';
import { getLocalDpsFromCode } from '../../src/tuya/device/tuya.localMapping.js';
import {
  applyGatewayLinks,
  extractDpIds,
  findProbeChild,
} from '../../src/tuya/local/tuya.gatewayLinks.js';
import { createFakeGladys } from '../helpers/fakeGladys.js';

// Issue #78: Zigbee sub-devices of a Tuya gateway, run locally through the
// gateway's session and addressed by their node id (`cid`). The fixtures
// follow @UniversalOverrun's 1.30.1 diagnostics: a `wg2` gateway and its
// plug, temperature sensor and motion sensor (sub=true, gateway_id, node_id).

const GATEWAY = {
  id: 'gw1',
  name: 'ZigBee Maison',
  category: 'wg2',
  local_key: 'gwkey',
  sub: false,
  online: true,
  specifications: { category: 'wg2', functions: [], status: [] },
};
const plugSpec = (code, dpId, type = 'Boolean') => ({ code, dp_id: dpId, type, values: '{}' });
const PLUG = {
  id: 'plug1',
  name: 'Prise Salle de bain',
  product_id: 'xzhnra8x',
  local_key: 'plugkey',
  sub: true,
  gateway_id: 'gw1',
  node_id: 'node-plug',
  online: true,
  specifications: {
    category: 'cz',
    functions: [plugSpec('switch_1', 1)],
    status: [plugSpec('switch_1', 1), plugSpec('cur_power', 19, 'Integer')],
  },
};
const PIR = {
  id: 'pir1',
  name: 'Ouverture tiroir',
  product_id: '3towulqd',
  local_key: 'pirkey',
  sub: true,
  gateway_id: 'gw1',
  node_id: 'node-pir',
  online: true,
  specifications: {
    category: 'pir',
    functions: [],
    status: [{ code: 'pir', type: 'Enum', values: '{"range":["pir","none"]}' }],
  },
  thing_model: {
    services: [
      {
        properties: [
          { code: 'pir', abilityId: 1, typeSpec: { type: 'enum', range: ['pir', 'none'] } },
          {
            code: 'battery_percentage',
            abilityId: 4,
            typeSpec: { type: 'value', min: 0, max: 100, scale: 0, unit: '%' },
          },
        ],
      },
    ],
  },
};

const scanned = (devices) =>
  devices.map((raw) =>
    raw.id === 'gw1' ? { ...raw, ip: '192.168.1.25', protocol_version: '3.4' } : raw,
  );

test('#78: a sub-device takes the LAN identity of its gateway, and its node id', () => {
  const [, plug, pir] = applyGatewayLinks(scanned([GATEWAY, PLUG, PIR]), true);
  assert.equal(plug.ip, '192.168.1.25');
  assert.equal(plug.protocol_version, '3.4');
  assert.equal(plug.gateway_local_key, 'gwkey');
  assert.equal(plug.node_id, 'node-plug');
  assert.equal(plug.local_override, true);
  assert.deepEqual(plug.dp_ids, { switch_1: 1, cur_power: 19 });
  assert.deepEqual(pir.dp_ids, { pir: 1, battery_percentage: 4 });

  // A gateway not seen on the LAN yet: the link is kept, the device stays cloud.
  const [, unlinked] = applyGatewayLinks([GATEWAY, PLUG], true);
  assert.equal(unlinked.node_id, 'node-plug');
  assert.equal(unlinked.ip, undefined);
});

test('#78: a later discovery keeps the gateway identity the created sub-devices carry', () => {
  // The gateway is neither created in Gladys nor seen by the scan: only the
  // created sub-devices still know its IP / protocol (enrichFromCreatedDevices
  // put them back on the raw sub-devices). Their key must stay the gateway's.
  const restored = [GATEWAY, { ...PLUG, ip: '192.168.1.25', protocol_version: '3.3' }, PIR];
  const [gateway, plug, pir] = applyGatewayLinks(restored, true);
  assert.equal(gateway.ip, '192.168.1.25');
  assert.equal(gateway.protocol_version, '3.3');
  for (const child of [plug, pir]) {
    assert.equal(child.ip, '192.168.1.25');
    assert.equal(child.protocol_version, '3.3');
    assert.equal(child.gateway_local_key, 'gwkey');
    assert.equal(child.local_override, true);
  }
  // Even with no LAN identity anywhere, a sub-device never stores its own key.
  const [, alone] = applyGatewayLinks([GATEWAY, PLUG], true);
  assert.equal(alone.gateway_local_key, 'gwkey');
  assert.equal(
    convertDevice(createFakeGladys(), alone).params.find((p) => p.name === 'LOCAL_KEY').value,
    'gwkey',
  );
});

test('#78: the cloud DP ids come from the specification, the shadow and the thing model', () => {
  assert.deepEqual(
    extractDpIds({
      specifications: { status: [{ code: 'switch_1', dp_id: 1 }] },
      properties: { properties: [{ code: 'cur_voltage', dp_id: 20 }] },
      thing_model: { services: [{ properties: [{ code: 'add_ele', abilityId: 17 }] }] },
    }),
    { switch_1: 1, cur_voltage: 20, add_ele: 17 },
  );
});

test('#78: the probe of a gateway reads a mains-powered, online sub-device first', () => {
  const sensor = { ...PIR, category: 'wsdcg', online: false };
  assert.equal(findProbeChild([GATEWAY, sensor, PLUG], 'gw1').id, 'plug1');
});

test('#78: the created sub-device stores the gateway key, the node id and its DP ids', () => {
  const [, , pir] = applyGatewayLinks(scanned([GATEWAY, PLUG, PIR]), true);
  const device = convertDevice(createFakeGladys(), pir);
  const param = (name) => (device.params.find((p) => p.name === name) || {}).value;
  assert.equal(param(DEVICE_PARAM_NAME.LOCAL_KEY), 'gwkey');
  assert.equal(param(DEVICE_PARAM_NAME.GATEWAY_ID), 'gw1');
  assert.equal(param(DEVICE_PARAM_NAME.NODE_ID), 'node-pir');
  assert.equal(param(DEVICE_PARAM_NAME.IP_ADDRESS), '192.168.1.25');
  // The motion-sensor type has an empty (strict) LAN mapping: the DP ids the
  // cloud declares for this sub-device fill it.
  assert.equal(getLocalDpsFromCode('pir', device), 1);
  assert.equal(getLocalDpsFromCode('battery_percentage', device), 4);
});

// --- The gateway session ----------------------------------------------------

function createFakeApiFactory(log) {
  return class FakeGatewayApi extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      log.instances.push(this);
    }

    async connect() {
      log.connects += 1;
    }

    async get(options) {
      log.gets.push(options);
      return { dps: { ...(log.dpsByCid[options.cid] || {}) }, cid: options.cid };
    }

    async set(options) {
      log.sets.push(options);
    }

    async disconnect() {}
  };
}

function createGatewayHandler() {
  const gladys = createFakeGladys();
  const handler = new TuyaHandler(gladys);
  handler.config = { localMode: true };
  const log = {
    instances: [],
    connects: 0,
    gets: [],
    sets: [],
    dpsByCid: { 'node-plug': { 1: true }, 'node-pir': { 1: 'pir', 4: 87 } },
  };
  const Fake = createFakeApiFactory(log);
  handler.localApiClasses = { TuyAPI: Fake, TuyAPINewGen: Fake };
  const linked = applyGatewayLinks(scanned([GATEWAY, PLUG, PIR]), true);
  const created = linked.slice(1).map((raw) => convertDevice(gladys, raw));
  gladys.devices = created;
  return { gladys, handler, log, plug: created[0], pir: created[1] };
}

const publishedState = (gladys, device, code) =>
  gladys.published
    .filter((p) => p.featureExternalId === `${device.external_id}:${code}`)
    .map((p) => p.state)
    .at(-1);

test('#78: the sub-devices share ONE gateway session and are read by their node id', async () => {
  const { gladys, handler, log, plug, pir } = createGatewayHandler();
  await Promise.all([handler.poll(plug), handler.poll(pir)]);

  assert.equal(log.instances.length, 1, 'one session for the gateway');
  const [api] = log.instances;
  assert.equal(api.options.id, 'gw1');
  assert.equal(api.options.key, 'gwkey');
  assert.equal(api.options.version, '3.4');
  // A gateway has no DP of its own: no bare read on connect nor on ping.
  assert.equal(api.options.issueGetOnConnect, false);
  assert.equal(api.options.issueRefreshOnPing, false);
  assert.deepEqual(log.gets.map((o) => o.cid).sort(), ['node-pir', 'node-plug']);

  assert.equal(publishedState(gladys, plug, 'switch_1'), 1);
  assert.equal(publishedState(gladys, pir, 'pir'), 1);
});

test('#78: a push of the gateway reaches the sub-device its node id names', async () => {
  const { gladys, handler, log, plug, pir } = createGatewayHandler();
  await handler.poll(plug);
  const [api] = log.instances;
  api.emit('data', { dps: { 1: 'none' }, cid: 'node-pir' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(publishedState(gladys, pir, 'pir'), 0);
  // The plug's state is untouched by the sensor's report.
  assert.equal(publishedState(gladys, plug, 'switch_1'), 1);
});

test('#78: a command goes through the gateway session with the node id', async () => {
  const { handler, log, plug } = createGatewayHandler();
  await handler.poll(plug);
  const feature = plug.features.find((f) => f.external_id.endsWith(':switch_1'));
  await handler.setValue(plug, feature, 0);
  assert.deepEqual(log.sets, [{ dps: 1, set: false, cid: 'node-plug' }]);
  assert.equal(log.instances.length, 1);
});

// --- Protocol detection of a gateway ------------------------------------------

test('#78: "Detect local protocol" on a gateway probes a sub-device and updates them all', async () => {
  const gladys = createSdkFakeGladys({
    selector: 'tuya',
    config: {
      endpoint: 'westernEurope',
      access_key: 'a',
      secret_key: 's',
      app_account_id: 'u',
      GLADYS_PREFER_LOCAL: true,
    },
  });
  const probes = [];
  const tuya = {
    status: STATUS.NOT_INITIALIZED,
    config: null,
    discoveredDevices: [],
    gladys,
    async connect() {
      this.status = STATUS.CONNECTED;
    },
    async disconnect() {},
    startReconnect() {},
    async startPulsar() {},
    stopPulsar() {},
    async discoverDevices() {
      return [{ ...GATEWAY }, { ...PLUG }, { ...PIR }];
    },
    async localScan() {
      return { devices: {} };
    },
    async closeAllLocalSessions() {},
    async poll() {},
    async detectProtocol(payload) {
      probes.push(payload);
      return { version: '3.3' };
    },
  };
  createTuyaIntegration(gladys, tuya);
  await gladys.connect();

  const ack = await gladys.fake.action('detect_protocol', {
    device_ref: 'ZigBee Maison',
    ip: '192.168.1.25',
  });
  assert.equal(ack.success, true, JSON.stringify(ack.error));
  assert.deepEqual(probes, [
    { deviceId: 'gw1', ip: '192.168.1.25', localKey: 'gwkey', cid: 'node-plug' },
  ]);
  assert.match(ack.data.message.fr, /Passerelle « ZigBee Maison » : protocole 3.3/);
  assert.match(ack.data.message.en, /its 2 sub-device\(s\) updated/);

  const published = gladys.fake.discoveredDevices;
  const param = (device, name) => (device.params.find((p) => p.name === name) || {}).value;
  const plug = published.find((d) => param(d, DEVICE_PARAM_NAME.DEVICE_ID) === 'plug1');
  assert.equal(param(plug, DEVICE_PARAM_NAME.IP_ADDRESS), '192.168.1.25');
  assert.equal(param(plug, DEVICE_PARAM_NAME.PROTOCOL_VERSION), '3.3');
  assert.equal(param(plug, DEVICE_PARAM_NAME.LOCAL_KEY), 'gwkey');
  assert.equal(param(plug, DEVICE_PARAM_NAME.NODE_ID), 'node-plug');

  // Picking a sub-device probes its gateway the same way.
  probes.length = 0;
  await gladys.fake.action('detect_protocol', {
    device_ref: 'Ouverture tiroir',
    ip: '192.168.1.25',
  });
  assert.deepEqual(probes, [
    { deviceId: 'gw1', ip: '192.168.1.25', localKey: 'gwkey', cid: 'node-pir' },
  ]);
});
