import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DEVICE_FEATURE_CATEGORIES, DEVICE_FEATURE_TYPES } from '@gladysassistant/integration-sdk';

import { TuyaHandler } from '../../src/tuya/handler.js';
import { convertDevice } from '../../src/tuya/device/tuya.convertDevice.js';
import { readValues } from '../../src/tuya/device/tuya.deviceMapping.js';
import { getLocalDpsFromCode } from '../../src/tuya/device/tuya.localMapping.js';
import { getDeviceType, DEVICE_TYPES } from '../../src/tuya/mappings/index.js';
import { buildDeviceDiagnostic } from '../../src/tuya/tuya.diagnostic.js';
import { temperatureHumiditySensor } from '../../src/devices/temperatureHumiditySensor.js';
import { globalCloudMapping } from '../../src/devices/index.js';
import { DEVICE_PARAM_NAME } from '../../src/tuya/constants.js';
import { createFakeGladys } from '../helpers/fakeGladys.js';

// The Konyks Termo reported on the forum, with the five codes its diagnostic
// report listed (va_* and the generic temp_current / humidity_value twins
// carry the same values) and the standard wsdcg spec values.
const TEMP_SPEC = '{"unit":"℃","min":-200,"max":600,"scale":1,"step":1}';
const HUM_SPEC = '{"unit":"%","min":0,"max":100,"scale":0,"step":1}';
const KONYKS_TERMO = {
  id: 'termo1',
  name: 'Termo parents',
  product_name: 'Konyks Termo',
  model: 'Konyks Termo',
  product_id: 'oc5ayveauaz2ev4e',
  online: true,
  specifications: {
    category: 'wsdcg',
    functions: [],
    status: [
      { code: 'va_temperature', type: 'Integer', values: TEMP_SPEC },
      { code: 'va_humidity', type: 'Integer', values: HUM_SPEC },
      { code: 'battery_state', type: 'Enum', values: '{"range":["low","middle","high"]}' },
      { code: 'temp_current', type: 'Integer', values: TEMP_SPEC },
      { code: 'humidity_value', type: 'Integer', values: HUM_SPEC },
    ],
  },
};

const gladys = createFakeGladys();
const featuresByCode = (device) =>
  Object.fromEntries(device.features.map((f) => [f.external_id.split(':').pop(), f]));

test('the Konyks Termo is detected from its category, its product id or its name', () => {
  assert.equal(getDeviceType(KONYKS_TERMO), DEVICE_TYPES.TEMPERATURE_HUMIDITY_SENSOR);
  assert.equal(
    getDeviceType({ product_id: 'oc5ayveauaz2ev4e' }),
    DEVICE_TYPES.TEMPERATURE_HUMIDITY_SENSOR,
  );
  // Name + a sensor code, for a device whose specifications are empty.
  assert.equal(
    getDeviceType({ name: 'Termo parents', status: [{ code: 'va_temperature' }] }),
    DEVICE_TYPES.TEMPERATURE_HUMIDITY_SENSOR,
  );
  // `temp_current` is also a pilot-thermostat / AC code: a sensor must not be
  // taken for one, and a thermostat must not become a sensor.
  assert.equal(
    getDeviceType({ name: 'Thermostat pilote salon', status: [{ code: 'temp_current' }] }),
    DEVICE_TYPES.PILOT_THERMOSTAT,
  );
});

test('convertDevice maps temperature, humidity and the battery verdict — once each', () => {
  const device = convertDevice(gladys, KONYKS_TERMO);
  const byCode = featuresByCode(device);

  assert.equal(device.device_type, DEVICE_TYPES.TEMPERATURE_HUMIDITY_SENSOR);

  assert.equal(byCode.va_temperature.category, DEVICE_FEATURE_CATEGORIES.TEMPERATURE_SENSOR);
  assert.equal(byCode.va_temperature.type, DEVICE_FEATURE_TYPES.SENSOR.DECIMAL);
  assert.equal(byCode.va_temperature.unit, 'celsius');
  assert.equal(byCode.va_temperature.scale, 1);
  assert.equal(byCode.va_temperature.read_only, true);

  assert.equal(byCode.va_humidity.category, DEVICE_FEATURE_CATEGORIES.HUMIDITY_SENSOR);
  assert.equal(byCode.va_humidity.unit, 'percent');
  assert.equal(byCode.va_humidity.scale, 0);

  assert.equal(byCode.battery_state.category, DEVICE_FEATURE_CATEGORIES.BATTERY_LOW);
  assert.equal(byCode.battery_state.type, DEVICE_FEATURE_TYPES.BATTERY_LOW.BINARY);

  // The mapping-only hints never reach the persisted feature.
  assert.equal(byCode.battery_state.tuyaEnum, undefined);

  // temp_current / humidity_value are the same two DPs reported twice: with
  // the primary codes present, they do not become a second pair of features.
  assert.deepEqual(Object.keys(byCode).sort(), ['battery_state', 'va_humidity', 'va_temperature']);
});

test('a model reporting only the generic temp_current / humidity_value codes gets its features from them', () => {
  const byCode = featuresByCode(
    convertDevice(gladys, {
      id: 'generic1',
      name: 'Capteur température cave',
      specifications: {
        category: 'wsdcg',
        status: [
          { code: 'temp_current', type: 'Integer', values: TEMP_SPEC },
          { code: 'humidity_value', type: 'Integer', values: HUM_SPEC },
          { code: 'battery_percentage', type: 'Integer', values: '{"min":0,"max":100}' },
        ],
      },
    }),
  );
  assert.equal(byCode.temp_current.category, DEVICE_FEATURE_CATEGORIES.TEMPERATURE_SENSOR);
  assert.equal(byCode.temp_current.duplicateOf, undefined);
  assert.equal(byCode.humidity_value.category, DEVICE_FEATURE_CATEGORIES.HUMIDITY_SENSOR);
  assert.equal(byCode.battery_percentage.category, DEVICE_FEATURE_CATEGORIES.BATTERY);
  assert.deepEqual(Object.keys(byCode).sort(), [
    'battery_percentage',
    'humidity_value',
    'temp_current',
  ]);
});

test('the temperature feature follows the device display unit, like temp_current does', () => {
  const byCode = featuresByCode(
    convertDevice(gladys, {
      ...KONYKS_TERMO,
      properties: { properties: [{ code: 'temp_unit_convert', value: 'f' }] },
    }),
  );
  assert.equal(byCode.va_temperature.unit, 'fahrenheit');
  assert.equal(byCode.va_humidity.unit, 'percent');
});

test('the BATTERY_LOW reader translates the battery_state levels and still reads a boolean flag', () => {
  const read =
    readValues[DEVICE_FEATURE_CATEGORIES.BATTERY_LOW][DEVICE_FEATURE_TYPES.BATTERY_LOW.BINARY];
  const entry = temperatureHumiditySensor.CLOUD_MAPPINGS.battery_state;
  assert.equal(read('low', {}, entry), 1);
  assert.equal(read('middle', {}, entry), 0);
  assert.equal(read('high', {}, entry), 0);
  assert.equal(read('High', {}, entry), 0);
  // Outside the declared vocabulary: nothing published, not a wrong flag.
  assert.equal(read('empty', {}, entry), null);
  // The pet feeder's boolean battery_alarm keeps working (no tuyaEnum).
  assert.equal(read(true, {}, {}), 1);
  assert.equal(read(false, {}, {}), 0);
  assert.equal(read(0, {}, undefined), 0);
});

test('poll publishes 21.6 °C, 62 % and the battery verdict from the cloud status of the forum report', async () => {
  const fake = createFakeGladys();
  const handler = new TuyaHandler(fake);
  const converted = convertDevice(fake, KONYKS_TERMO);
  const device = {
    external_id: converted.external_id,
    device_type: converted.device_type,
    features: converted.features,
    params: [{ name: DEVICE_PARAM_NAME.DEVICE_ID, value: 'termo1' }],
  };
  handler.connector = {
    request: async () => ({
      success: true,
      result: [
        { code: 'battery_state', value: 'middle' },
        { code: 'humidity_value', value: 62 },
        { code: 'temp_current', value: 216 },
        { code: 'va_humidity', value: 62 },
        { code: 'va_temperature', value: 216 },
      ],
    }),
  };

  await handler.poll(device);

  const byCode = Object.fromEntries(
    fake.published.map((p) => [p.featureExternalId.split(':').pop(), p.state]),
  );
  assert.equal(byCode.va_temperature, 21.6);
  assert.equal(byCode.va_humidity, 62);
  assert.equal(byCode.battery_state, 0);
  // The twin codes are read but consumed by no feature.
  assert.equal(byCode.temp_current, undefined);
  assert.equal(byCode.humidity_value, undefined);
});

test('poll restores the temperature scale lost by Gladys persistence', async () => {
  // Gladys does not persist `scale`: a feature read back from the created
  // devices has none, and 216 must still publish as 21.6, not 216.
  const fake = createFakeGladys();
  const handler = new TuyaHandler(fake);
  const converted = convertDevice(fake, KONYKS_TERMO);
  const device = {
    external_id: converted.external_id,
    device_type: converted.device_type,
    features: converted.features.map(({ scale: _scale, ...feature }) => feature),
    params: [{ name: DEVICE_PARAM_NAME.DEVICE_ID, value: 'termo1' }],
  };
  handler.connector = {
    request: async () => ({
      success: true,
      result: [
        { code: 'va_temperature', value: 216 },
        { code: 'va_humidity', value: 62 },
        { code: 'battery_state', value: 'low' },
      ],
    }),
  };

  await handler.poll(device);

  const byCode = Object.fromEntries(
    fake.published.map((p) => [p.featureExternalId.split(':').pop(), p.state]),
  );
  assert.equal(byCode.va_temperature, 21.6);
  assert.equal(byCode.va_humidity, 62);
  assert.equal(byCode.battery_state, 1);
});

test('the diagnostic reports the twin codes as the same DP, not as a gap', async () => {
  const self = {
    gladys: createFakeGladys(),
    connector: {
      request: async ({ path }) => {
        if (path.endsWith('/status')) {
          return {
            success: true,
            result: [
              { code: 'battery_state', value: 'middle' },
              { code: 'humidity_value', value: 62 },
              { code: 'temp_current', value: 216 },
              { code: 'va_humidity', value: 62 },
              { code: 'va_temperature', value: 216 },
            ],
          };
        }
        return { success: true, result: { properties: [] } };
      },
    },
  };
  const report = await buildDeviceDiagnostic(self, KONYKS_TERMO);

  assert.match(report, /detected type=temperature-humidity-sensor mapped features=3/);
  assert.match(report, /va_temperature = 216 {2}\[temperature-sensor\/decimal\]/);
  assert.match(report, /va_humidity = 62 {2}\[humidity-sensor\/decimal\]/);
  assert.match(report, /battery_state = "middle" {2}\[battery-low\/binary\]/);
  assert.match(report, /temp_current = 216 {2}\[same DP as va_temperature\]/);
  assert.match(report, /humidity_value = 62 {2}\[same DP as va_humidity\]/);
  assert.doesNotMatch(report, /UNMANAGED/);
  assert.match(report, /battery_state: low, middle, high \(status\)/);
});

test('every code of the global mapping is still handled by the sensor mapping', () => {
  const missing = Object.keys(globalCloudMapping).filter(
    (code) => !temperatureHumiditySensor.CLOUD_MAPPINGS[code],
  );
  assert.deepEqual(missing, []);
});

test('the sensor has no LAN mapping: a battery device sleeps between reports, the cloud serves it', () => {
  const device = { device_type: DEVICE_TYPES.TEMPERATURE_HUMIDITY_SENSOR };
  assert.equal(getLocalDpsFromCode('va_temperature', device), null);
  assert.equal(getLocalDpsFromCode('battery_state', device), null);
});
