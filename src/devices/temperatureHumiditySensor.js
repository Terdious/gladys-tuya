// -----------------------------------------------------------------------------
// Device type: TEMPERATURE & HUMIDITY SENSOR (Tuya category `wsdcg`).
//
// Requested on the forum for a Konyks Termo (product id oc5ayveauaz2ev4e),
// discovered with "no feature". Its diagnostic report (1.17.0) reads:
//   category=wsdcg detected type=unknown mapped features=0
//   battery_state = "middle"   va_temperature = 216   va_humidity = 62
//   temp_current  = 216        humidity_value = 62
//   Declared enum ranges: battery_state: low, middle, high (status+model)
// so the temperature is 21.6 °C with scale 1, the humidity 62 % with scale 0,
// and the battery is a three-level enum. The rest of the standard `wsdcg`
// instruction set (developer.tuya.com/en/docs/iot/categorywsdcg, cross-checked
// against the Home Assistant Tuya integration) is covered below.
//
// Scope — cloud only (see LOCAL_MAPPINGS below).
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';

import { globalCloudMapping } from './global.js';

// Codes that identify a Tuya temperature & humidity sensor (at least one must
// be exposed). `temp_current` alone is also an AC / thermostat code: those
// types are tried first, and this one only claims it with the `wsdcg`
// category or a sensor keyword in the device name.
const SENSOR_CODES = new Set(['va_temperature', 'va_humidity', 'temp_current', 'humidity_value']);

// The Konyks reports its three-level battery state as a string: only `low`
// means "change the batteries". No percentage is invented from it — a model
// that measures one reports `battery_percentage`, mapped below.
const BATTERY_STATE_TO_LOW = {
  low: 1,
  middle: 0,
  high: 0,
};

const cloudMapping = {
  // A device-type mapping REPLACES the global one, and a sensor discovered
  // before this type existed was created as `unknown` — WITH the global
  // mapping. Starting from it guarantees that re-running the discovery can
  // only ADD features to those devices, never drop one.
  ...globalCloudMapping,
  ignoredCodes: [
    // Display unit of the device (c/f): applied to the temperature feature's
    // unit instead (see temperatureUnit in tuya.convertFeature.js).
    'temp_unit_convert',
    // Alarm thresholds, alarm states, report periods and sensitivities: device
    // settings with no Gladys feature type that fits — the thresholds would
    // be plain integers written to Integer DPs whose scale varies per model.
    'maxtemp_set',
    'minitemp_set',
    'maxhum_set',
    'minihum_set',
    'temp_alarm',
    'hum_alarm',
    'temp_periodic_report',
    'hum_periodic_report',
    'temp_sensitivity',
    'hum_sensitivity',
  ],
  // The spec range of this DP is declared in tenths of a degree (216 = 21.6 °C
  // on the bench): scale 1 is the default when a model declares none.
  va_temperature: {
    name: 'Temperature',
    category: DEVICE_FEATURE_CATEGORIES.TEMPERATURE_SENSOR,
    type: DEVICE_FEATURE_TYPES.SENSOR.DECIMAL,
    unit: DEVICE_FEATURE_UNITS.CELSIUS,
    scale: 1,
  },
  va_humidity: {
    name: 'Humidity',
    category: DEVICE_FEATURE_CATEGORIES.HUMIDITY_SENSOR,
    type: DEVICE_FEATURE_TYPES.SENSOR.DECIMAL,
    unit: DEVICE_FEATURE_UNITS.PERCENT,
    scale: 0,
  },
  // The Konyks reports the SAME two DPs a second time under the generic
  // `temp_current` / `humidity_value` codes (identical values on the bench).
  // `duplicateOf` keeps them out when the primary code is exposed too — one
  // feature per measure, not two — and still maps them on a model that only
  // reports these generic codes.
  temp_current: {
    name: 'Temperature',
    category: DEVICE_FEATURE_CATEGORIES.TEMPERATURE_SENSOR,
    type: DEVICE_FEATURE_TYPES.SENSOR.DECIMAL,
    unit: DEVICE_FEATURE_UNITS.CELSIUS,
    scale: 1,
    duplicateOf: 'va_temperature',
  },
  humidity_value: {
    name: 'Humidity',
    category: DEVICE_FEATURE_CATEGORIES.HUMIDITY_SENSOR,
    type: DEVICE_FEATURE_TYPES.SENSOR.DECIMAL,
    unit: DEVICE_FEATURE_UNITS.PERCENT,
    scale: 0,
    duplicateOf: 'va_humidity',
  },
  // The device's own battery verdict, usable as a scene trigger. The enum is
  // translated through tuyaEnum by the BATTERY_LOW reader; a value outside the
  // vocabulary publishes nothing rather than a wrong flag.
  battery_state: {
    name: 'Battery low',
    category: DEVICE_FEATURE_CATEGORIES.BATTERY_LOW,
    type: DEVICE_FEATURE_TYPES.BATTERY_LOW.BINARY,
    tuyaEnum: BATTERY_STATE_TO_LOW,
  },
  battery_percentage: {
    name: 'Battery',
    category: DEVICE_FEATURE_CATEGORIES.BATTERY,
    type: DEVICE_FEATURE_TYPES.SENSOR.INTEGER,
    unit: DEVICE_FEATURE_UNITS.PERCENT,
  },
};

// LAN mapping: intentionally empty. These sensors run on batteries and sleep
// between two reports: a LAN poll would only time out and park the device
// (see the poll circuit breaker), while the cloud (and the Pulsar listener,
// when enabled) receives each report as the device wakes up. `strict: true`
// keeps every feature on the cloud even with local mode on.
const localMapping = {
  strict: true,
  ignoredDps: [],
  codeAliases: {},
  dps: {},
};

export const temperatureHumiditySensor = {
  DEVICE_TYPE_NAME: 'temperature-humidity-sensor',
  CATEGORIES: new Set(['wsdcg']),
  PRODUCT_IDS: new Set(['oc5ayveauaz2ev4e']),
  // Matched against the device name/model, and only for a device that also
  // exposes one of the codes above ("Termo" is the Konyks product name).
  KEYWORDS: [
    'thermometer',
    'thermomètre',
    'thermometre',
    'hygrometer',
    'hygromètre',
    'hygrometre',
    'termo',
    'temperature sensor',
    'capteur de température',
    'capteur température',
    'capteur temperature',
  ],
  REQUIRED_CODES: SENSOR_CODES,
  CLOUD_MAPPINGS: cloudMapping,
  LOCAL_MAPPINGS: localMapping,
};
