import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DEVICE_FEATURE_CATEGORIES, DEVICE_FEATURE_TYPES } from '@gladysassistant/integration-sdk';

import { TuyaHandler } from '../../src/tuya/handler.js';
import { convertDevice } from '../../src/tuya/device/tuya.convertDevice.js';
import { readValues } from '../../src/tuya/device/tuya.deviceMapping.js';
import { getLocalDpsFromCode } from '../../src/tuya/device/tuya.localMapping.js';
import { getDeviceType, DEVICE_TYPES } from '../../src/tuya/mappings/index.js';
import { buildDeviceDiagnostic } from '../../src/tuya/tuya.diagnostic.js';
import { emitLocalDpsStates } from '../../src/tuya/tuya.poll.js';
import { waterPurifier } from '../../src/devices/waterPurifier.js';
import { globalCloudMapping } from '../../src/devices/index.js';
import { DEVICE_PARAM_NAME } from '../../src/tuya/constants.js';
import { createFakeGladys } from '../helpers/fakeGladys.js';

// "The Box" reverse-osmosis purifier of issue #54, with the codes, values,
// enum ranges and LAN DPS of its diagnostic report.
const INT = (min, max, unit = '') => JSON.stringify({ unit, min, max, scale: 0, step: 1 });
const STATUS_RANGE_SPEC = '{"range":["purified","heating","standby","washing","sterilization"]}';
const THE_BOX = {
  id: 'box1',
  name: 'La Box',
  product_name: 'The Box',
  model: 'The Box',
  product_id: '4lno1rskgtnivxni',
  online: true,
  specifications: {
    category: 'js',
    functions: [
      { code: 'pp_filter_reset', type: 'Boolean', values: '{}' },
      { code: 'cto_filter_reset', type: 'Boolean', values: '{}' },
      { code: 'ro_filter_reset', type: 'Boolean', values: '{}' },
      { code: 'switch_flow', type: 'Boolean', values: '{}' },
    ],
    status: [
      { code: 'tds_in', type: 'Integer', values: INT(0, 9999, 'ppm') },
      { code: 'tds_out', type: 'Integer', values: INT(0, 9999, 'ppm') },
      { code: 'pp_filtertime', type: 'Integer', values: INT(0, 100, '%') },
      { code: 'cto_filtertime', type: 'Integer', values: INT(0, 100, '%') },
      { code: 'ro_filtertime', type: 'Integer', values: INT(0, 100, '%') },
      { code: 'pp_filtertime_day', type: 'Integer', values: INT(0, 9999, 'day') },
      { code: 'cto_filtertime_day', type: 'Integer', values: INT(0, 9999, 'day') },
      { code: 'ro_filtertime_day', type: 'Integer', values: INT(0, 9999, 'day') },
      { code: 'status', type: 'Enum', values: STATUS_RANGE_SPEC },
      { code: 'fault', type: 'Bitmap', values: '{"label":["E1","E2","E3"]}' },
    ],
  },
  thing_model: {
    services: [
      {
        properties: [
          {
            code: 'status',
            accessMode: 'ro',
            typeSpec: {
              type: 'enum',
              range: ['purified', 'heating', 'water_intake', 'standby', 'washing', 'sterilization'],
            },
          },
        ],
      },
    ],
  },
};

const CLOUD_STATUS = [
  { code: 'cto_filter_reset', value: false },
  { code: 'cto_filtertime', value: 72 },
  { code: 'cto_filtertime_day', value: 429 },
  { code: 'fault', value: 0 },
  { code: 'pp_filter_reset', value: false },
  { code: 'pp_filtertime', value: 43 },
  { code: 'pp_filtertime_day', value: 129 },
  { code: 'ro_filter_reset', value: false },
  { code: 'ro_filtertime', value: 81 },
  { code: 'ro_filtertime_day', value: 729 },
  { code: 'status', value: 'standby' },
  { code: 'switch_flow', value: false },
  { code: 'tds_in', value: 195 },
  { code: 'tds_out', value: 5 },
];

const gladys = createFakeGladys();
const featuresByCode = (device) =>
  Object.fromEntries(device.features.map((f) => [f.external_id.split(':').pop(), f]));
const createdDevice = (fake) => {
  const converted = convertDevice(fake, THE_BOX);
  return {
    external_id: converted.external_id,
    device_type: converted.device_type,
    features: converted.features,
    params: [{ name: DEVICE_PARAM_NAME.DEVICE_ID, value: 'box1' }],
  };
};

test('The Box is detected from its js category, its product id or its name', () => {
  assert.equal(getDeviceType(THE_BOX), DEVICE_TYPES.WATER_PURIFIER);
  assert.equal(getDeviceType({ product_id: '4lno1rskgtnivxni' }), DEVICE_TYPES.WATER_PURIFIER);
  assert.equal(
    getDeviceType({ name: 'Osmoseur cuisine', status: [{ code: 'tds_out' }] }),
    DEVICE_TYPES.WATER_PURIFIER,
  );
  // A js device with none of the purifier codes keeps the global mapping.
  assert.equal(
    getDeviceType({ specifications: { category: 'js', status: [{ code: 'switch' }] } }),
    DEVICE_TYPES.UNKNOWN,
  );
});

test('convertDevice maps the TDS, the three filter stages and the status requested in issue #54', () => {
  const byCode = featuresByCode(convertDevice(gladys, THE_BOX));

  for (const code of ['tds_in', 'tds_out']) {
    assert.equal(byCode[code].category, DEVICE_FEATURE_CATEGORIES.COUNTER_SENSOR);
    assert.equal(byCode[code].type, DEVICE_FEATURE_TYPES.SENSOR.INTEGER);
    assert.equal(byCode[code].unit, 'ppm');
    assert.equal(byCode[code].read_only, true);
  }
  assert.equal(byCode.tds_in.name, 'Inlet TDS');
  assert.equal(byCode.tds_out.name, 'Outlet TDS');

  for (const stage of ['pp', 'cto', 'ro']) {
    const life = byCode[`${stage}_filtertime`];
    assert.equal(life.category, DEVICE_FEATURE_CATEGORIES.MAINTENANCE);
    assert.equal(life.type, DEVICE_FEATURE_TYPES.MAINTENANCE.LIFE_REMAINING);
    assert.equal(life.unit, 'percent');
    assert.equal(life.min, 0);
    assert.equal(life.max, 100);
    // Mapping-only hint, never persisted.
    assert.equal(life.percentRemaining, undefined);

    const days = byCode[`${stage}_filtertime_day`];
    assert.equal(days.category, DEVICE_FEATURE_CATEGORIES.DURATION);
    assert.equal(days.type, DEVICE_FEATURE_TYPES.DURATION.INTEGER);
    assert.equal(days.unit, 'days');
  }
  assert.equal(byCode.pp_filtertime.name, 'PP filter life');
  assert.equal(byCode.ro_filtertime_day.name, 'RO filter days left');

  // Read-only status with labelled options, including `water_intake` that
  // only the thing model declares (the ranges of every source are merged).
  assert.equal(byCode.status.category, DEVICE_FEATURE_CATEGORIES.TEXT);
  assert.equal(byCode.status.type, DEVICE_FEATURE_TYPES.TEXT.SELECT);
  assert.equal(byCode.status.read_only, true);
  assert.deepEqual(
    byCode.status.supported_options.map((o) => [o.value, o.label]),
    [
      ['purified', 'Purifying'],
      ['heating', 'Heating'],
      ['standby', 'Standby'],
      ['washing', 'Flushing'],
      ['sterilization', 'Sterilizing'],
      ['water_intake', 'Water intake'],
    ],
  );

  // The filter resets (destructive one-shot commands), the undocumented
  // switch_flow and the alarm bitmap stay out.
  assert.deepEqual(Object.keys(byCode).sort(), [
    'cto_filtertime',
    'cto_filtertime_day',
    'pp_filtertime',
    'pp_filtertime_day',
    'ro_filtertime',
    'ro_filtertime_day',
    'status',
    'tds_in',
    'tds_out',
  ]);
});

test('the MAINTENANCE reader passes a percentage through, and still converts the vacuum brushes', () => {
  const read =
    readValues[DEVICE_FEATURE_CATEGORIES.MAINTENANCE][
      DEVICE_FEATURE_TYPES.MAINTENANCE.LIFE_REMAINING
    ];
  const entry = waterPurifier.CLOUD_MAPPINGS.pp_filtertime;
  assert.equal(read(43, {}, entry), 43);
  assert.equal(read('72', {}, entry), 72);
  assert.equal(read(140, {}, entry), 100);
  assert.equal(read(-3, {}, entry), 0);
  assert.equal(read('n/a', {}, entry), null);
  // The elapsed-seconds path is unchanged: half of a 100 s full life is 50 %.
  assert.equal(read(50, {}, { fullLifeSeconds: 100 }), 50);
  assert.equal(read(50, {}, {}), null);
});

test('poll publishes the values of the issue report over the cloud', async () => {
  const fake = createFakeGladys();
  const handler = new TuyaHandler(fake);
  const device = createdDevice(fake);
  handler.connector = { request: async () => ({ success: true, result: CLOUD_STATUS }) };

  await handler.poll(device);

  const byCode = Object.fromEntries(
    fake.published.map((p) => [p.featureExternalId.split(':').pop(), p.state]),
  );
  assert.equal(byCode.tds_in, 195);
  assert.equal(byCode.tds_out, 5);
  assert.equal(byCode.pp_filtertime, 43);
  assert.equal(byCode.cto_filtertime, 72);
  assert.equal(byCode.ro_filtertime, 81);
  assert.equal(byCode.pp_filtertime_day, 129);
  assert.equal(byCode.cto_filtertime_day, 429);
  assert.equal(byCode.ro_filtertime_day, 729);
  assert.deepEqual(byCode.status, { text: 'standby' });
  assert.equal(byCode.fault, undefined);
  assert.equal(byCode.switch_flow, undefined);
});

test('the LAN mapping resolves every unambiguous DPS of the snapshot, and only those', () => {
  const device = { device_type: DEVICE_TYPES.WATER_PURIFIER };
  assert.equal(getLocalDpsFromCode('tds_out', device), 1);
  assert.equal(getLocalDpsFromCode('tds_in', device), 2);
  assert.equal(getLocalDpsFromCode('pp_filtertime', device), 3);
  assert.equal(getLocalDpsFromCode('cto_filtertime', device), 4);
  assert.equal(getLocalDpsFromCode('ro_filtertime', device), 5);
  assert.equal(getLocalDpsFromCode('status', device), 16);
  assert.equal(getLocalDpsFromCode('pp_filtertime_day', device), 26);
  assert.equal(getLocalDpsFromCode('cto_filtertime_day', device), 27);
  assert.equal(getLocalDpsFromCode('ro_filtertime_day', device), 28);
  // DPS 12/17/18/19 all read false: which one is which reset is unknown.
  assert.equal(getLocalDpsFromCode('switch_flow', device), null);
  assert.equal(getLocalDpsFromCode('pp_filter_reset', device), null);
});

test('a local DPS read publishes the same values as the cloud', async () => {
  const fake = createFakeGladys();
  const handler = new TuyaHandler(fake);
  const device = createdDevice(fake);
  // The DPS snapshot of the issue report.
  const dps = {
    1: 5,
    2: 195,
    3: 43,
    4: 72,
    5: 81,
    12: false,
    16: 'standby',
    17: false,
    18: false,
    19: false,
    23: 0,
    26: 129,
    27: 429,
    28: 729,
  };
  const pending = [];
  emitLocalDpsStates(handler, device, dps, pending);
  await Promise.all(pending);

  const byCode = Object.fromEntries(
    fake.published.map((p) => [p.featureExternalId.split(':').pop(), p.state]),
  );
  assert.equal(byCode.tds_out, 5);
  assert.equal(byCode.tds_in, 195);
  assert.equal(byCode.pp_filtertime, 43);
  assert.equal(byCode.cto_filtertime, 72);
  assert.equal(byCode.ro_filtertime, 81);
  assert.equal(byCode.pp_filtertime_day, 129);
  assert.equal(byCode.cto_filtertime_day, 429);
  assert.equal(byCode.ro_filtertime_day, 729);
  assert.deepEqual(byCode.status, { text: 'standby' });
});

test('the diagnostic of the issue report has no UNMANAGED code left', async () => {
  const report = await buildDeviceDiagnostic(
    {
      gladys: createFakeGladys(),
      connector: { request: async () => ({ success: true, result: CLOUD_STATUS }) },
    },
    THE_BOX,
  );
  assert.match(report, /detected type=water-purifier mapped features=9/);
  assert.match(report, /tds_in = 195 {2}\[counter-sensor\/integer\]/);
  assert.match(report, /pp_filtertime = 43 {2}\[maintenance\/life-remaining\]/);
  assert.match(report, /ro_filtertime_day = 729 {2}\[duration\/integer\]/);
  assert.match(report, /status = "standby" {2}\[text\/select\]/);
  assert.match(report, /pp_filter_reset = false {2}\[ignored on purpose\]/);
  assert.doesNotMatch(report, /UNMANAGED/);
});

test('every code of the global mapping is still handled by the purifier mapping', () => {
  const missing = Object.keys(globalCloudMapping).filter(
    (code) => !waterPurifier.CLOUD_MAPPINGS[code],
  );
  assert.deepEqual(missing, []);
});
