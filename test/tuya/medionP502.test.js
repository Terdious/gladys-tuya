import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DEVICE_FEATURE_CATEGORIES, DEVICE_FEATURE_TYPES } from '@gladysassistant/integration-sdk';

import { TuyaHandler } from '../../src/tuya/handler.js';
import { convertDevice } from '../../src/tuya/device/tuya.convertDevice.js';
import { getLocalDpsFromCode } from '../../src/tuya/device/tuya.localMapping.js';
import { DEVICE_TYPES } from '../../src/tuya/mappings/index.js';
import { AC_MODE, AC_FAN_SPEED } from '../../src/devices/airConditioner.js';
import {
  gladysToTuyaAcValue,
  tuyaToGladysAcValue,
} from '../../src/tuya/device/tuya.deviceMapping.js';
import { DEVICE_PARAM_NAME } from '../../src/tuya/constants.js';
import { getParamValue } from '../../src/tuya/utils/tuya.deviceParams.js';
import { createFakeGladys } from '../helpers/fakeGladys.js';

// MEDION Smart mobile camping AC P502 (MD37735), as documented by the
// gladys-tuya-medion fork (Tuya IoT Platform > Device Debugging): non-standard
// codes (Power, C_F, Timer, Shake), temperatures in whole degrees (scale 0),
// UPPERCASE modes including SLEEP, and a two-level fan speed declared as "1"/"2".
const MODE_SPEC = '{"range":["COOL","FAN","DRY","HEAT","SLEEP"]}';
const FAN_SPEC = '{"range":["1","2"]}';
const MEDION_P502 = {
  id: 'p502',
  name: 'Clim camping-car',
  product_name: 'MEDION Camping AIR Conditioner P502',
  model: 'MEDION Camping AIR Conditioner P502',
  product_id: 'medionp502test',
  local_key: 'lk',
  online: true,
  specifications: {
    category: 'kt',
    functions: [
      { code: 'Power', type: 'Boolean', values: '{}' },
      { code: 'temp_set', type: 'Integer', values: '{"unit":"℃","min":16,"max":31,"scale":0}' },
      { code: 'mode', type: 'Enum', values: MODE_SPEC },
      { code: 'windspeed', type: 'Enum', values: FAN_SPEC },
      { code: 'C_F', type: 'Enum', values: '{"range":["C","F"]}' },
      { code: 'Timer', type: 'Integer', values: '{"min":0,"max":24,"scale":0}' },
      { code: 'Shake', type: 'Boolean', values: '{}' },
    ],
    status: [
      { code: 'Power', type: 'Boolean', values: '{}' },
      { code: 'temp_set', type: 'Integer', values: '{"unit":"℃","min":16,"max":31,"scale":0}' },
      {
        code: 'temp_current',
        type: 'Integer',
        values: '{"unit":"℃","min":0,"max":50,"scale":0}',
      },
      { code: 'mode', type: 'Enum', values: MODE_SPEC },
      { code: 'windspeed', type: 'Enum', values: FAN_SPEC },
      { code: 'C_F', type: 'Enum', values: '{"range":["C","F"]}' },
      { code: 'Timer', type: 'Integer', values: '{"min":0,"max":24,"scale":0}' },
      { code: 'Shake', type: 'Boolean', values: '{}' },
    ],
  },
};

const byCode = (device) =>
  Object.fromEntries(device.features.map((f) => [f.external_id.split(':').pop(), f]));

// A device as Gladys stores it: no feature `scale`, params kept.
function createdDevice() {
  const converted = convertDevice(createFakeGladys(), MEDION_P502);
  return {
    external_id: converted.external_id,
    name: converted.name,
    features: converted.features.map(({ scale: _scale, ...rest }) => rest),
    params: converted.params,
  };
}

const featureOf = (device, code) =>
  device.features.find((f) => f.external_id.toLowerCase().endsWith(`:${code}`));

test('P502: detected as an AC, with the swing switch and without unmanaged codes', () => {
  const device = convertDevice(createFakeGladys(), MEDION_P502);
  assert.equal(device.device_type, DEVICE_TYPES.AIR_CONDITIONER);
  const features = byCode(device);
  assert.deepEqual(Object.keys(features).sort(), [
    'Power',
    'Shake',
    'mode',
    'temp_current',
    'temp_set',
    'windspeed',
  ]);
  assert.equal(features.Shake.category, DEVICE_FEATURE_CATEGORIES.SWITCH);
  assert.equal(features.Shake.type, DEVICE_FEATURE_TYPES.SWITCH.BINARY);
  assert.equal(features.Shake.name, 'Swing');
});

test('P502: the fan speed offers Low and High, read from its "1"/"2" levels', () => {
  const features = byCode(convertDevice(createFakeGladys(), MEDION_P502));
  assert.deepEqual(
    features.windspeed.supported_options.map(({ value, label }) => [value, label]),
    [
      [AC_FAN_SPEED.LOW, 'Low'],
      [AC_FAN_SPEED.HIGH, 'High'],
    ],
  );
});

test('P502: the declared enum ranges are stored as a device param', () => {
  const device = convertDevice(createFakeGladys(), MEDION_P502);
  const ranges = JSON.parse(getParamValue(device.params, DEVICE_PARAM_NAME.AC_ENUM_RANGES));
  assert.deepEqual(ranges.mode, ['COOL', 'FAN', 'DRY', 'HEAT', 'SLEEP']);
  assert.deepEqual(ranges.windspeed, ['1', '2']);
});

test('P502: poll reads the UPPERCASE mode, the numeric fan level and whole degrees', async () => {
  const fake = createFakeGladys();
  const handler = new TuyaHandler(fake);
  const device = createdDevice();
  handler.connector = {
    request: async () => ({
      success: true,
      result: [
        { code: 'mode', value: 'HEAT' },
        { code: 'windspeed', value: '2' },
        { code: 'temp_set', value: 22 },
        { code: 'temp_current', value: 27 },
        { code: 'Shake', value: true },
      ],
    }),
  };

  await handler.poll(device);

  const states = Object.fromEntries(fake.published.map((p) => [p.featureExternalId, p.state]));
  assert.equal(states['ext:tuya:device:p502:mode'], AC_MODE.HEATING);
  assert.equal(states['ext:tuya:device:p502:windspeed'], AC_FAN_SPEED.HIGH);
  assert.equal(states['ext:tuya:device:p502:temp_set'], 22);
  assert.equal(states['ext:tuya:device:p502:temp_current'], 27);
  assert.equal(states['ext:tuya:device:p502:Shake'], 1);
});

test('P502: setValue writes the device own spelling (COOL, DRY, "1", "2")', async () => {
  const handler = new TuyaHandler(createFakeGladys());
  const device = createdDevice();
  const commands = [];
  handler.connector = {
    request: async ({ body }) => {
      commands.push(body.commands[0]);
      return { success: true };
    },
  };

  await handler.setValue(device, featureOf(device, 'mode'), AC_MODE.COOLING);
  await handler.setValue(device, featureOf(device, 'mode'), AC_MODE.DRYING);
  await handler.setValue(device, featureOf(device, 'windspeed'), AC_FAN_SPEED.LOW);
  await handler.setValue(device, featureOf(device, 'windspeed'), AC_FAN_SPEED.HIGH);
  await handler.setValue(device, featureOf(device, 'temp_set'), 24);
  assert.deepEqual(commands, [
    { code: 'mode', value: 'COOL' },
    { code: 'mode', value: 'DRY' },
    { code: 'windspeed', value: '1' },
    { code: 'windspeed', value: '2' },
    { code: 'temp_set', value: 24 },
  ]);
});

test('P502: the swing is read and written on DPS 8 over the LAN', () => {
  assert.equal(getLocalDpsFromCode('Shake', { device_type: DEVICE_TYPES.AIR_CONDITIONER }), 8);
});

test('AC enum helpers: the common spellings are unchanged without a stored range', () => {
  const { MODE, FAN_SPEED } = DEVICE_FEATURE_TYPES.AIR_CONDITIONING;
  assert.equal(gladysToTuyaAcValue(MODE, AC_MODE.COOLING), 'cold');
  assert.equal(gladysToTuyaAcValue(FAN_SPEED, AC_FAN_SPEED.HIGH), 'high');
  assert.equal(
    gladysToTuyaAcValue(MODE, AC_MODE.COOLING, ['auto', 'cold', 'wet', 'heat', 'fan']),
    'cold',
  );
  // A mode the device does not declare falls back to the common spelling
  // (the device refuses it, as before).
  assert.equal(gladysToTuyaAcValue(MODE, AC_MODE.AUTO, ['COOL', 'HEAT']), 'auto');
  // Numeric levels resolve only through a range; unknown values stay unknown.
  assert.equal(tuyaToGladysAcValue(FAN_SPEED, '2'), undefined);
  assert.equal(tuyaToGladysAcValue(FAN_SPEED, '2', ['1', '2', '3']), AC_FAN_SPEED.MID);
  assert.equal(tuyaToGladysAcValue(MODE, 'SLEEP', ['COOL', 'SLEEP']), undefined);
  assert.equal(tuyaToGladysAcValue(MODE, 'Cool'), AC_MODE.COOLING);
});
