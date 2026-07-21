import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';

import {
  getDeviceType,
  getFeatureMapping,
  getIgnoredCloudCodes,
  DEVICE_TYPES,
} from '../../src/tuya/mappings/index.js';
import { convertDevice } from '../../src/tuya/device/tuya.convertDevice.js';
import { convertFeature } from '../../src/tuya/device/tuya.convertFeature.js';
import { convertUnit } from '../../src/tuya/device/tuya.convertUnit.js';
import { readValues, writeValues, COVER_STATE } from '../../src/tuya/device/tuya.deviceMapping.js';
import {
  resolveCloudReadStrategy,
  CLOUD_STRATEGY,
} from '../../src/tuya/cloud/tuya.cloudStrategy.js';
import { DEVICE_PARAM_NAME } from '../../src/tuya/constants.js';
import { createFakeGladys } from '../helpers/fakeGladys.js';

const gladys = createFakeGladys();

// --- getDeviceType -----------------------------------------------------------

test('getDeviceType matches a smart socket by product id', () => {
  assert.equal(getDeviceType({ product_id: 'cya3zxfd38g4qp8d' }), DEVICE_TYPES.SMART_SOCKET);
});

test('getDeviceType matches a smart socket by category + switch code', () => {
  const device = {
    specifications: { category: 'cz', functions: [{ code: 'switch_1' }] },
  };
  assert.equal(getDeviceType(device), DEVICE_TYPES.SMART_SOCKET);
});

test('getDeviceType matches a smart meter by product id', () => {
  assert.equal(getDeviceType({ product_id: 'bbcg1hrkrj5rifsd' }), DEVICE_TYPES.SMART_METER);
});

test('getDeviceType matches a smart meter by name keyword + required code', () => {
  const device = {
    name: 'Garage smart meter',
    specifications: { status: [{ code: 'total_power' }] },
  };
  assert.equal(getDeviceType(device), DEVICE_TYPES.SMART_METER);
});

test('getDeviceType falls back to unknown', () => {
  assert.equal(getDeviceType({ name: 'Mystery box' }), DEVICE_TYPES.UNKNOWN);
  assert.equal(getDeviceType(null), DEVICE_TYPES.UNKNOWN);
});

// --- feature mapping ---------------------------------------------------------

test('getFeatureMapping resolves per device type, with global fallback', () => {
  const meterMapping = getFeatureMapping('total_power', DEVICE_TYPES.SMART_METER);
  assert.equal(meterMapping.category, DEVICE_FEATURE_CATEGORIES.ENERGY_SENSOR);
  assert.equal(meterMapping.type, DEVICE_FEATURE_TYPES.ENERGY_SENSOR.POWER);

  // total_power is not in the global mapping used for unknown devices.
  assert.equal(getFeatureMapping('total_power', DEVICE_TYPES.UNKNOWN), null);

  const globalSwitch = getFeatureMapping('switch', DEVICE_TYPES.UNKNOWN);
  assert.equal(globalSwitch.category, DEVICE_FEATURE_CATEGORIES.SWITCH);
});

test('getIgnoredCloudCodes returns the per-type ignore list', () => {
  const socketIgnored = getIgnoredCloudCodes(DEVICE_TYPES.SMART_SOCKET);
  assert.ok(socketIgnored.includes('countdown'));
  assert.ok(socketIgnored.includes('relay_status'), 'the LSC configuration codes are ignored');
  assert.ok(getIgnoredCloudCodes(DEVICE_TYPES.SMART_METER).includes('freq'));
  assert.deepEqual(getIgnoredCloudCodes(DEVICE_TYPES.UNKNOWN), []);
});

// --- convertFeature ----------------------------------------------------------

const ids = gladys.externalIds('device', 'dev1');

test('convertFeature converts a mapped writable feature', () => {
  const feature = convertFeature({ code: 'switch', values: '{}', readOnly: false }, ids, {
    deviceType: DEVICE_TYPES.SMART_SOCKET,
  });
  assert.equal(feature.external_id, 'ext:tuya:device:dev1:switch');
  assert.equal(feature.category, DEVICE_FEATURE_CATEGORIES.SWITCH);
  assert.equal(feature.type, DEVICE_FEATURE_TYPES.SWITCH.BINARY);
  assert.equal(feature.read_only, false);
  assert.equal(feature.name, 'switch');
});

test('convertFeature applies min/max/scale from the Tuya values', () => {
  const feature = convertFeature(
    { code: 'cur_power', values: JSON.stringify({ min: 0, max: 50000, scale: 1 }), readOnly: true },
    ids,
    { deviceType: DEVICE_TYPES.SMART_SOCKET },
  );
  assert.equal(feature.min, 0);
  assert.equal(feature.max, 50000);
  assert.equal(feature.scale, 1);
  assert.equal(feature.unit, DEVICE_FEATURE_UNITS.WATT);
});

test('convertFeature uses the curated mapping name when available', () => {
  const feature = convertFeature({ code: 'energy_forword_a', values: {}, readOnly: true }, ids, {
    deviceType: DEVICE_TYPES.SMART_METER,
  });
  assert.equal(feature.name, 'Forward energy A');
});

test('convertFeature drops ignored and unmapped codes', () => {
  assert.equal(
    convertFeature({ code: 'countdown', values: {}, readOnly: false }, ids, {
      deviceType: DEVICE_TYPES.SMART_SOCKET,
    }),
    undefined,
  );
  assert.equal(
    convertFeature({ code: 'no_such_code', values: {}, readOnly: false }, ids, {
      deviceType: DEVICE_TYPES.SMART_SOCKET,
    }),
    undefined,
  );
});

// --- convertUnit -------------------------------------------------------------

test('convertUnit converts the known Tuya units', () => {
  assert.equal(convertUnit('°C'), DEVICE_FEATURE_UNITS.CELSIUS);
  assert.equal(convertUnit('°F'), DEVICE_FEATURE_UNITS.FAHRENHEIT);
  assert.equal(convertUnit('V'), null);
});

// --- convertDevice -----------------------------------------------------------

const SMART_SOCKET_DEVICE = {
  id: 'socket1',
  name: 'Office socket',
  product_name: 'Smart Socket',
  product_id: 'cya3zxfd38g4qp8d',
  local_key: 'lk',
  cloud_ip: '82.64.1.1',
  online: true,
  specifications: {
    category: 'cz',
    functions: [
      { code: 'switch', type: 'Boolean', values: '{}' },
      { code: 'countdown', type: 'Integer', values: '{}' },
    ],
    status: [
      { code: 'switch', type: 'Boolean', values: '{}' },
      {
        code: 'cur_power',
        type: 'Integer',
        values: JSON.stringify({ min: 0, max: 50000, scale: 1 }),
      },
    ],
  },
};

test('convertDevice converts a smart socket', () => {
  const device = convertDevice(gladys, SMART_SOCKET_DEVICE);

  assert.equal(device.external_id, 'ext:tuya:device:socket1');
  assert.equal(device.name, 'Office socket');
  assert.equal(device.device_type, DEVICE_TYPES.SMART_SOCKET);
  assert.equal(device.model, 'Smart Socket');
  assert.equal(device.poll_frequency, 30000);
  assert.equal(device.should_poll, true);
  assert.equal(device.online, true);

  const codes = device.features.map((f) => f.external_id.split(':').pop()).sort();
  // countdown is ignored for smart sockets.
  assert.deepEqual(codes, ['cur_power', 'switch']);

  const switchFeature = device.features.find((f) => f.external_id.endsWith(':switch'));
  // The writable specification function wins over the read-only status entry.
  assert.equal(switchFeature.read_only, false);

  const params = Object.fromEntries(device.params.map((p) => [p.name, p.value]));
  assert.equal(params[DEVICE_PARAM_NAME.DEVICE_ID], 'socket1');
  assert.equal(params[DEVICE_PARAM_NAME.LOCAL_KEY], 'lk');
  assert.equal(params[DEVICE_PARAM_NAME.CLOUD_IP], '82.64.1.1');
  assert.equal(params[DEVICE_PARAM_NAME.PRODUCT_ID], 'cya3zxfd38g4qp8d');
  assert.equal(params[DEVICE_PARAM_NAME.CLOUD_READ_STRATEGY], CLOUD_STRATEGY.LEGACY);

  // The device selector embeds the Tuya id, and features are scoped to it.
  assert.equal(device.selector, 'office-socket-socket1');
  device.features.forEach((feature) => {
    assert.ok(
      feature.selector && feature.selector.startsWith('office-socket-socket1-'),
      `feature ${feature.external_id} selector should be device-scoped, got ${feature.selector}`,
    );
  });
});

test('convertDevice gives two same-named devices collision-free feature selectors', () => {
  const first = convertDevice(gladys, { ...SMART_SOCKET_DEVICE, id: 'plugA', name: 'Plug' });
  const second = convertDevice(gladys, { ...SMART_SOCKET_DEVICE, id: 'plugB', name: 'Plug' });

  assert.notEqual(first.selector, second.selector);
  const firstSelectors = first.features.map((f) => f.selector);
  const secondSelectors = second.features.map((f) => f.selector);
  // No selector is shared between the two devices (the pre-fix bug).
  firstSelectors.forEach((selector) => {
    assert.ok(selector);
    assert.ok(!secondSelectors.includes(selector), `selector ${selector} collides across devices`);
  });
});

test('convertDevice falls back to the thing model (shadow strategy)', () => {
  const device = convertDevice(gladys, {
    id: 'meter1',
    name: 'Main smart meter',
    product_id: 'bbcg1hrkrj5rifsd',
    specifications: {},
    thing_model: {
      services: [
        {
          properties: [
            { code: 'total_power', name: 'Total power', accessMode: 'ro', typeSpec: { scale: 1 } },
            {
              code: 'forward_energy_total',
              name: 'Forward',
              accessMode: 'ro',
              typeSpec: { scale: 2 },
            },
            { code: 'freq', name: 'Frequency', accessMode: 'ro', typeSpec: {} },
          ],
        },
      ],
    },
  });

  assert.equal(device.device_type, DEVICE_TYPES.SMART_METER);
  const codes = device.features.map((f) => f.external_id.split(':').pop()).sort();
  // freq is in the smart meter ignore list.
  assert.deepEqual(codes, ['forward_energy_total', 'total_power']);
  for (const feature of device.features) {
    assert.equal(feature.read_only, true);
  }
  const params = Object.fromEntries(device.params.map((p) => [p.name, p.value]));
  assert.equal(params[DEVICE_PARAM_NAME.CLOUD_READ_STRATEGY], CLOUD_STRATEGY.SHADOW);
});

test('convertDevice marks local-override devices with the faster poll frequency', () => {
  const device = convertDevice(gladys, {
    ...SMART_SOCKET_DEVICE,
    ip: '192.168.1.30',
    protocol_version: '3.3',
    local_override: true,
  });
  assert.equal(device.poll_frequency, 10000);
  const params = Object.fromEntries(device.params.map((p) => [p.name, p.value]));
  assert.equal(params[DEVICE_PARAM_NAME.LOCAL_OVERRIDE], true);
  assert.equal(params[DEVICE_PARAM_NAME.IP_ADDRESS], '192.168.1.30');
  assert.equal(params[DEVICE_PARAM_NAME.PROTOCOL_VERSION], '3.3');
});

// --- cloud read strategy -----------------------------------------------------

test('resolveCloudReadStrategy prefers the legacy status endpoint', () => {
  const strategy = resolveCloudReadStrategy(SMART_SOCKET_DEVICE, DEVICE_TYPES.SMART_SOCKET);
  assert.equal(strategy, CLOUD_STRATEGY.LEGACY);
});

test('resolveCloudReadStrategy returns null when nothing is supported', () => {
  assert.equal(resolveCloudReadStrategy({ specifications: {} }, DEVICE_TYPES.SMART_SOCKET), null);
});

// --- read/write value transforms --------------------------------------------

test('read transforms scale electrical values like the core service', () => {
  const read = readValues[DEVICE_FEATURE_CATEGORIES.SWITCH];
  assert.equal(read[DEVICE_FEATURE_TYPES.SWITCH.BINARY](true), 1);
  assert.equal(read[DEVICE_FEATURE_TYPES.SWITCH.BINARY]('false'), 0);
  // Default scales: power 1, energy 2, voltage 1, current 0.
  assert.equal(read[DEVICE_FEATURE_TYPES.SWITCH.POWER](125, {}), 12.5);
  assert.equal(read[DEVICE_FEATURE_TYPES.SWITCH.ENERGY](250, {}), 2.5);
  assert.equal(read[DEVICE_FEATURE_TYPES.SWITCH.VOLTAGE](2302, {}), 230.2);
  assert.equal(read[DEVICE_FEATURE_TYPES.SWITCH.CURRENT](450, {}), 450);
  // Explicit feature scale wins.
  assert.equal(read[DEVICE_FEATURE_TYPES.SWITCH.POWER](1250, { scale: 2 }), 12.5);
});

test('energy sensor read transforms cover the smart meter features', () => {
  const read = readValues[DEVICE_FEATURE_CATEGORIES.ENERGY_SENSOR];
  assert.equal(read[DEVICE_FEATURE_TYPES.ENERGY_SENSOR.POWER](1234, {}), 123.4);
  assert.equal(read[DEVICE_FEATURE_TYPES.ENERGY_SENSOR.ENERGY](56789, {}), 567.89);
  const production = readValues[DEVICE_FEATURE_CATEGORIES.ENERGY_PRODUCTION_SENSOR];
  assert.equal(production[DEVICE_FEATURE_TYPES.ENERGY_PRODUCTION_SENSOR.INDEX](100, {}), 1);
});

test('write transforms convert Gladys values to Tuya values', () => {
  const writeSwitch = writeValues[DEVICE_FEATURE_CATEGORIES.SWITCH];
  assert.equal(writeSwitch[DEVICE_FEATURE_TYPES.SWITCH.BINARY](1), true);
  assert.equal(writeSwitch[DEVICE_FEATURE_TYPES.SWITCH.BINARY](0), false);

  const writeCurtain = writeValues[DEVICE_FEATURE_CATEGORIES.CURTAIN];
  assert.equal(writeCurtain[DEVICE_FEATURE_TYPES.CURTAIN.STATE](COVER_STATE.OPEN), 'open');
  assert.equal(writeCurtain[DEVICE_FEATURE_TYPES.CURTAIN.STATE](COVER_STATE.CLOSE), 'close');
  assert.equal(writeCurtain[DEVICE_FEATURE_TYPES.CURTAIN.STATE](COVER_STATE.STOP), 'stop');
});

test('light color transforms roundtrip through hsb', () => {
  const writeLight = writeValues[DEVICE_FEATURE_CATEGORIES.LIGHT];
  const readLight = readValues[DEVICE_FEATURE_CATEGORIES.LIGHT];
  const red = 0xff0000;
  const hsv = writeLight[DEVICE_FEATURE_TYPES.LIGHT.COLOR](red);
  assert.deepEqual(hsv, { h: 0, s: 1000, v: 1000 });
  assert.equal(readLight[DEVICE_FEATURE_TYPES.LIGHT.COLOR](JSON.stringify(hsv)), red);
});
