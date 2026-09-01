import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';

import { getDeviceType, DEVICE_TYPES } from '../../src/tuya/mappings/index.js';
import { getLocalDpsFromCode } from '../../src/tuya/device/tuya.localMapping.js';
import { writeValues, readValues } from '../../src/tuya/device/tuya.deviceMapping.js';
import { convertDevice } from '../../src/tuya/device/tuya.convertDevice.js';
import { createFakeGladys } from '../helpers/fakeGladys.js';
import { HONITURE_Q6_PRO_STATE_TUYA_ENUM, VACUUM_CLEANER_STATE } from '../../src/devices/vacuum.js';

// Honiture Q6 Pro cloud specification, as read from the real robot via the
// "Debug device status" action (only the 13 codes this device type maps are
// listed here; the real cloud specification exposes many more, unmapped
// ones — see the comment at the top of src/devices/vacuum.js).
const HONITURE_Q6_PRO_DEVICE = {
  id: 'bfefc3fd4bc8db1135f8cw',
  name: 'Q6 Pro (robert)',
  product_id: 'c4ueb7cxlgmfon1t',
  local_key: 'lk',
  ip: '192.168.1.40',
  protocol_version: '3.3',
  specifications: {
    functions: [{ code: 'charge_switch', type: 'Boolean', values: '{}' }],
    status: [
      { code: 'charge_switch', type: 'Boolean', values: '{}' },
      { code: 'robot_state', type: 'Enum', values: '{"range":["fullcharge"]}' },
      { code: 'battery', type: 'Integer', values: '{"min":0,"max":100,"unit":"%"}' },
      { code: 'pause_switch', type: 'Boolean', values: '{}' },
      { code: 'auto_boost', type: 'Boolean', values: '{}' },
      { code: 'room_mode_switch', type: 'Boolean', values: '{}' },
      { code: 'fan_mode', type: 'Enum', values: '{"range":["quiet","auto","strong","max"]}' },
      { code: 'water_mode', type: 'Enum', values: '{"range":["low","mid","high"]}' },
      { code: 'main_brush_time', type: 'Value', values: '{}' },
      { code: 'side_brush_time', type: 'Value', values: '{}' },
      { code: 'dust_collection_num', type: 'Enum', values: '{"range":["0","1","2","3"]}' },
      { code: 'y_mop', type: 'Boolean', values: '{}' },
      { code: 'power_go', type: 'Boolean', values: '{}' },
    ],
  },
};

test('the Honiture Q6 Pro is detected by its product id', () => {
  assert.equal(getDeviceType({ product_id: 'c4ueb7cxlgmfon1t' }), DEVICE_TYPES.VACUUM);
});

test('convertDevice maps the 13 confirmed vacuum features', () => {
  const gladys = createFakeGladys();
  const device = convertDevice(gladys, HONITURE_Q6_PRO_DEVICE);
  const byCode = Object.fromEntries(
    device.features.map((f) => [f.external_id.split(':').pop(), f]),
  );

  assert.equal(byCode.charge_switch.category, DEVICE_FEATURE_CATEGORIES.VACUUM_CLEANER);
  assert.equal(byCode.charge_switch.type, DEVICE_FEATURE_TYPES.VACUUM_CLEANER.DOCK);

  assert.equal(byCode.robot_state.category, DEVICE_FEATURE_CATEGORIES.VACUUM_CLEANER);
  assert.equal(byCode.robot_state.type, DEVICE_FEATURE_TYPES.VACUUM_CLEANER.STATE);
  assert.equal(byCode.robot_state.read_only, true);

  assert.equal(byCode.battery.category, DEVICE_FEATURE_CATEGORIES.BATTERY);
  assert.equal(byCode.battery.type, DEVICE_FEATURE_TYPES.BATTERY.INTEGER);
  assert.equal(byCode.battery.unit, DEVICE_FEATURE_UNITS.PERCENT);

  // pause_switch/auto_boost/room_mode_switch/y_mop/power_go: no dedicated
  // VACUUM_CLEANER type exists for any of them, so each is exposed as a
  // plain switch.
  ['pause_switch', 'auto_boost', 'room_mode_switch', 'y_mop', 'power_go'].forEach((code) => {
    assert.equal(byCode[code].category, DEVICE_FEATURE_CATEGORIES.SWITCH);
    assert.equal(byCode[code].type, DEVICE_FEATURE_TYPES.SWITCH.BINARY);
  });

  // power_go (DP 2) is write-only: it never appears in a local status()
  // snapshot, so Gladys cannot read its own toggle back.
  assert.equal(byCode.power_go.has_feedback, false);

  // Everything except the 2 consumables opts OUT of history (frequent DPS
  // like state/battery would flood the states table); the consumables opt
  // IN explicitly (see the file header).
  [
    'charge_switch',
    'robot_state',
    'battery',
    'pause_switch',
    'auto_boost',
    'room_mode_switch',
    'fan_mode',
    'water_mode',
    'dust_collection_num',
    'y_mop',
    'power_go',
  ].forEach((code) => {
    assert.equal(byCode[code].keep_history, false, `${code} should default keep_history to false`);
  });
  ['main_brush_time', 'side_brush_time'].forEach((code) => {
    assert.equal(byCode[code].keep_history, true, `${code} should keep history`);
  });

  // fan_mode/water_mode: TEXT/SELECT, with exactly the confirmed vocabulary
  // as supported_options (not a fixed/hardcoded Gladys enum).
  assert.equal(byCode.fan_mode.category, DEVICE_FEATURE_CATEGORIES.TEXT);
  assert.equal(byCode.fan_mode.type, DEVICE_FEATURE_TYPES.TEXT.SELECT);
  assert.deepEqual(
    byCode.fan_mode.supported_options.map((o) => o.value),
    ['quiet', 'auto', 'strong', 'max'],
  );
  assert.equal(byCode.fan_mode.supported_options.find((o) => o.value === 'auto').label, 'Standard');

  assert.equal(byCode.water_mode.category, DEVICE_FEATURE_CATEGORIES.TEXT);
  assert.equal(byCode.water_mode.type, DEVICE_FEATURE_TYPES.TEXT.SELECT);
  assert.deepEqual(
    byCode.water_mode.supported_options.map((o) => o.value),
    ['low', 'mid', 'high'],
  );

  assert.equal(byCode.dust_collection_num.category, DEVICE_FEATURE_CATEGORIES.TEXT);
  assert.equal(byCode.dust_collection_num.type, DEVICE_FEATURE_TYPES.TEXT.SELECT);
  assert.deepEqual(
    byCode.dust_collection_num.supported_options.map((o) => o.value),
    ['0', '1', '2', '3'],
  );

  ['main_brush_time', 'side_brush_time'].forEach((code) => {
    assert.equal(byCode[code].category, DEVICE_FEATURE_CATEGORIES.MAINTENANCE);
    assert.equal(byCode[code].type, DEVICE_FEATURE_TYPES.MAINTENANCE.LIFE_REMAINING);
    assert.equal(byCode[code].read_only, true);
    assert.equal(byCode[code].unit, DEVICE_FEATURE_UNITS.PERCENT);
  });

  assert.deepEqual(Object.keys(byCode).sort(), [
    'auto_boost',
    'battery',
    'charge_switch',
    'dust_collection_num',
    'fan_mode',
    'main_brush_time',
    'pause_switch',
    'power_go',
    'robot_state',
    'room_mode_switch',
    'side_brush_time',
    'water_mode',
    'y_mop',
  ]);
});

test('convertDevice names/labels are plain French strings (no per-viewer i18n exists for these)', () => {
  const gladys = createFakeGladys();
  const device = convertDevice(gladys, HONITURE_Q6_PRO_DEVICE);
  const byCode = Object.fromEntries(
    device.features.map((f) => [f.external_id.split(':').pop(), f]),
  );
  assert.equal(byCode.charge_switch.name, 'Retour à la base');
  assert.equal(byCode.robot_state.name, 'État');
  assert.equal(byCode.battery.name, 'Batterie');
  assert.equal(byCode.auto_boost.name, 'Boost tapis');
  assert.equal(byCode.room_mode_switch.name, 'Mode personnalisé');
  assert.equal(byCode.fan_mode.name, "Puissance d'aspiration");
  assert.equal(byCode.fan_mode.supported_options.find((o) => o.value === 'strong').label, 'Fort');
  assert.equal(byCode.water_mode.name, "Niveau d'eau");
  assert.equal(byCode.water_mode.supported_options.find((o) => o.value === 'low').label, 'Faible');
  assert.equal(byCode.main_brush_time.name, 'Brosse principale');
  assert.equal(byCode.side_brush_time.name, 'Brosse latérale');
  assert.equal(byCode.dust_collection_num.name, 'Collecte des poussières');
  assert.equal(
    byCode.dust_collection_num.supported_options.find((o) => o.value === '2').label,
    'Après 2 nettoyages',
  );
  assert.equal(byCode.y_mop.name, 'Lavage en Y');
  assert.equal(byCode.power_go.name, 'Nettoyage');
});

test('convertDevice drops fan_mode/water_mode/dust_collection_num on a core older than 4.86.0 (no downgrade path for TEXT/SELECT)', () => {
  const gladys = createFakeGladys();
  const device = convertDevice(gladys, HONITURE_Q6_PRO_DEVICE, { coreSupportsTextSelect: false });
  const codes = device.features.map((f) => f.external_id.split(':').pop()).sort();
  assert.deepEqual(codes, [
    'auto_boost',
    'battery',
    'charge_switch',
    'main_brush_time',
    'pause_switch',
    'power_go',
    'robot_state',
    'room_mode_switch',
    'side_brush_time',
    'y_mop',
  ]);
});

test('DP 2/102/103/105/106/109/110/119/120/136/137/139/144 resolve locally for the vacuum device type (confirmed against the real robot)', () => {
  const device = { device_type: DEVICE_TYPES.VACUUM };
  assert.equal(getLocalDpsFromCode('charge_switch', device), 103);
  assert.equal(getLocalDpsFromCode('robot_state', device), 105);
  assert.equal(getLocalDpsFromCode('battery', device), 106);
  assert.equal(getLocalDpsFromCode('pause_switch', device), 102);
  assert.equal(getLocalDpsFromCode('auto_boost', device), 137);
  assert.equal(getLocalDpsFromCode('room_mode_switch', device), 144);
  assert.equal(getLocalDpsFromCode('fan_mode', device), 109);
  assert.equal(getLocalDpsFromCode('water_mode', device), 110);
  assert.equal(getLocalDpsFromCode('main_brush_time', device), 120);
  assert.equal(getLocalDpsFromCode('side_brush_time', device), 119);
  assert.equal(getLocalDpsFromCode('dust_collection_num', device), 136);
  assert.equal(getLocalDpsFromCode('y_mop', device), 139);
  assert.equal(getLocalDpsFromCode('power_go', device), 2);
  // Strict mapping: a code that isn't wired yet (e.g. clean_mode — see the
  // comment at the top of src/devices/vacuum.js) never falls back to a
  // guessed DPS.
  assert.equal(getLocalDpsFromCode('clean_mode', device), null);
});

test('BUTTON.PUSH has no write transform (regression guard: petFeeder.js manual_feed needs the plain 1 unchanged, not coerced)', () => {
  const writeCategory = writeValues[DEVICE_FEATURE_CATEGORIES.BUTTON];
  assert.equal(writeCategory, undefined);
});

test('MAINTENANCE.LIFE_REMAINING converts elapsed seconds to a remaining percent (main brush, 300h full life)', () => {
  const read =
    readValues[DEVICE_FEATURE_CATEGORIES.MAINTENANCE][
      DEVICE_FEATURE_TYPES.MAINTENANCE.LIFE_REMAINING
    ];
  const mappingEntry = { fullLifeSeconds: 300 * 3600 };

  // Cross-checked against the Smart Life app: 632691s elapsed -> app showed
  // 41% remaining (see the comment above MAIN_BRUSH_FULL_LIFE_SECONDS in
  // src/devices/vacuum.js).
  assert.equal(read(632691, {}, mappingEntry), 41);
  assert.equal(read(0, {}, mappingEntry), 100);
  // Past its full life: clamped to 0, never negative.
  assert.equal(read(300 * 3600 + 10000, {}, mappingEntry), 0);
  // No confirmed full-life reference for this DPS (e.g. filter_time — not
  // wired, see src/devices/vacuum.js): read as null rather than a guessed
  // percent.
  assert.equal(read(100, {}, {}), null);
  assert.equal(read('not-a-number', {}, mappingEntry), null);
});

test('MAINTENANCE.LIFE_REMAINING converts elapsed seconds to a remaining percent (side brush, 150h full life)', () => {
  const read =
    readValues[DEVICE_FEATURE_CATEGORIES.MAINTENANCE][
      DEVICE_FEATURE_TYPES.MAINTENANCE.LIFE_REMAINING
    ];
  // Confirmed by resetting the side brush in the app: DP 119 read back at 0
  // right after, matching the app's 100% / 150h — see the comment above
  // SIDE_BRUSH_FULL_LIFE_SECONDS in src/devices/vacuum.js.
  assert.equal(read(0, {}, { fullLifeSeconds: 150 * 3600 }), 100);
});

test('TEXT.SELECT passes the raw device string straight through (no int enum, unlike CLEAN_MODE)', () => {
  const write = writeValues[DEVICE_FEATURE_CATEGORIES.TEXT][DEVICE_FEATURE_TYPES.TEXT.SELECT];
  const read = readValues[DEVICE_FEATURE_CATEGORIES.TEXT][DEVICE_FEATURE_TYPES.TEXT.SELECT];
  assert.equal(write('strong'), 'strong');
  assert.equal(read('max'), 'max');
});

test('VACUUM_CLEANER.DOCK writes a plain boolean (dock DP is confirmed as a boolean)', () => {
  const write =
    writeValues[DEVICE_FEATURE_CATEGORIES.VACUUM_CLEANER][DEVICE_FEATURE_TYPES.VACUUM_CLEANER.DOCK];
  assert.equal(write(1), true);
  assert.equal(write(0), false);
});

test('VACUUM_CLEANER.DOCK has a reader (regression: was missing, so getFeatureReader skipped it and the dock state never polled)', () => {
  const read =
    readValues[DEVICE_FEATURE_CATEGORIES.VACUUM_CLEANER][DEVICE_FEATURE_TYPES.VACUUM_CLEANER.DOCK];
  assert.equal(typeof read, 'function');
  assert.equal(read(true), 1);
  assert.equal(read(false), 0);
});

test('BATTERY.INTEGER has a reader (regression: was missing entirely — affected this AND petFeeder.js battery_percentage)', () => {
  const read = readValues[DEVICE_FEATURE_CATEGORIES.BATTERY][DEVICE_FEATURE_TYPES.BATTERY.INTEGER];
  assert.equal(typeof read, 'function');
  assert.equal(read(100), 100);
  assert.equal(read('73'), 73);
  assert.equal(read('not-a-number'), null);
});

test('VACUUM_CLEANER.STATE reads back through the per-device tuyaEnum vocabulary', () => {
  const read =
    readValues[DEVICE_FEATURE_CATEGORIES.VACUUM_CLEANER][DEVICE_FEATURE_TYPES.VACUUM_CLEANER.STATE];
  const mappingEntry = { tuyaEnum: { charging: 5, idle: 0 } };
  assert.equal(read('charging', {}, mappingEntry), 5);
  assert.equal(read('idle', {}, mappingEntry), 0);
  // A string outside the vocabulary reads back as null rather than a guess.
  assert.equal(read('cleaning', {}, mappingEntry), null);
});

test('the Honiture Q6 Pro STATE vocabulary maps every robot_state string confirmed by hand-testing', () => {
  // Each pair below was confirmed by triggering the matching robot action in
  // the Smart Life app and diffing DPS snapshots — see the comment above
  // HONITURE_Q6_PRO_STATE_TUYA_ENUM in src/devices/vacuum.js.
  const read =
    readValues[DEVICE_FEATURE_CATEGORIES.VACUUM_CLEANER][DEVICE_FEATURE_TYPES.VACUUM_CLEANER.STATE];
  const mappingEntry = { tuyaEnum: HONITURE_Q6_PRO_STATE_TUYA_ENUM };

  assert.equal(read('fullcharge', {}, mappingEntry), VACUUM_CLEANER_STATE.DOCKED);
  assert.equal(read('chargring', {}, mappingEntry), VACUUM_CLEANER_STATE.CHARGING);
  assert.equal(read('selectroom', {}, mappingEntry), VACUUM_CLEANER_STATE.RUNNING);
  assert.equal(read('totaling', {}, mappingEntry), VACUUM_CLEANER_STATE.RUNNING);
  assert.equal(read('pause', {}, mappingEntry), VACUUM_CLEANER_STATE.PAUSED);
  assert.equal(read('tocharge', {}, mappingEntry), VACUUM_CLEANER_STATE.RETURNING_TO_DOCK);
  assert.equal(read('idle', {}, mappingEntry), VACUUM_CLEANER_STATE.STOPPED);
  assert.equal(read('fault', {}, mappingEntry), VACUUM_CLEANER_STATE.ERROR);
  // A string outside the confirmed vocabulary must read back as null, never
  // a guess.
  assert.equal(read('cleaning', {}, mappingEntry), null);
});

test('power_go (DP 2) is a real Start/Stop confirmed by a raw LAN write, bypassing Gladys (tinytuya set_value(2, true/false))', () => {
  // true launches a cycle (from idle) or restarts one already running;
  // false is a full stop (robot_state -> "idle"), not a pause. Since DP 2 is
  // write-only (never in a local status() snapshot), SWITCH.BINARY's shared
  // boolean writer is reused as-is: no dedicated read/write transform for it.
  const write = writeValues[DEVICE_FEATURE_CATEGORIES.SWITCH][DEVICE_FEATURE_TYPES.SWITCH.BINARY];
  assert.equal(write(1), true);
  assert.equal(write(0), false);
});
