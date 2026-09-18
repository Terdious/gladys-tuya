// -----------------------------------------------------------------------------
// Device type: FAN (Tuya fan, category `fs`).
//
// Reported on the forum: an AV-TTW5-W decentralized heat-recovery ventilation
// unit, discovered with its on/off switch only. Its Tuya specifications (API
// Explorer dump posted with the request) are:
//   functions: switch (Boolean), fan_speed_percent (Integer, min 1 max 3,
//              scale 0, step 1), light (Boolean)
//   status:    the same three, plus fault (Bitmap ["E1".."E5"])
// so the speed and the light had no mapping and were dropped at discovery.
//
// The rest of the standard `fs` instruction set
// (developer.tuya.com/en/docs/iot/categoryfs, cross-checked against the Home
// Assistant Tuya integration) is mapped here too when its meaning is the same
// on every product; the codes whose vocabulary varies from one model to the
// next are listed in `ignoredCodes` below, with the reason.
//
// Only the `fs` category claims this type: `fsd` (ceiling fan light) and
// `fskg` (fan wall switch) expose light/gang codes this mapping does not
// cover, and a device-type mapping REPLACES the global one — claiming them
// here would drop features they get today from the global mapping.
//
// Scope — cloud only (see LOCAL_MAPPINGS below).
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';

// Mirror of the core FAN_AIRFLOW_DIRECTION constant (server/utils/constants.js):
// the values the Gladys front renders for a fan `airflow-direction` feature.
export const FAN_AIRFLOW_DIRECTION = {
  FORWARD: 0,
  REVERSE: 1,
};

// Codes that identify a Tuya fan (at least one must be exposed). A plain
// `switch` is not enough: every Tuya device has one.
const FAN_CODES = new Set([
  'fan_speed_percent',
  'fan_speed',
  'fan_speed_enum',
  'fan_direction',
  'switch_horizontal',
  'switch_vertical',
  'switch_fan',
]);

const cloudMapping = {
  ignoredCodes: [
    // Speed as an enum. Its vocabulary is product-specific — Tuya products
    // ship ["low","mid","high"], ["1","2","3"] and ["level_1".."level_n"]
    // ranges for this same code — and a write must send back the EXACT
    // string the device declares. Reading could be aliased, but writing
    // could not: the pipeline gives the write transform the mapping entry
    // and the Gladys feature, not the per-device spec range. Mapping it
    // would mean a speed slider that reads right and fails to set. It stays
    // out until the write path can carry the device range (a fan exposing
    // it also exposes `fan_speed_percent` in most cases).
    'fan_speed_enum',
    // Preset mode. Same problem, worse: the range is ["normal","nature",
    // "sleep"] on pedestal fans, ["fresh","auto","manual"] on ventilation
    // units like the one from the report — with no way to tell which Gladys
    // wind-setting value ("sleep", "natural") a given string means.
    'mode',
    // Swing ANGLE enums (["30","60","90"], ["small","middle","big"]...):
    // per-product vocabularies again. The boolean swing switches below are
    // the ones that behave the same everywhere.
    'fan_horizontal',
    'fan_vertical',
    // Target temperature of a fan-heater, and the timer codes: no Gladys
    // feature type fits them on a fan.
    'temp',
    'countdown',
    'countdown_left',
    'countdown_set',
    // Bitmap of the device error codes (E1..E5 on the reported unit): a
    // Gladys feature would publish a raw bitmask nobody can read.
    'fault',
  ],
  switch: {
    name: 'On/off',
    category: DEVICE_FEATURE_CATEGORIES.SWITCH,
    type: DEVICE_FEATURE_TYPES.SWITCH.BINARY,
  },
  // On/off of the fan block itself on the products that separate it from the
  // light (fan wall switches, some `fs` models).
  switch_fan: {
    name: 'On/off',
    category: DEVICE_FEATURE_CATEGORIES.SWITCH,
    type: DEVICE_FEATURE_TYPES.SWITCH.BINARY,
  },
  // Speed as a plain integer DP. Despite its name, `fan_speed_percent` is a
  // LEVEL on many products (1..3 on the reported unit): the Gladys feature
  // takes the spec range as it is (a 1..3 slider there, 1..100 on a fan that
  // really is a percentage) and the raw value is written back unchanged —
  // rescaling 3 levels to a percentage would only lose steps. min/max here
  // are the fallback for a device discovered without a spec range.
  fan_speed_percent: {
    name: 'Speed',
    category: DEVICE_FEATURE_CATEGORIES.FAN,
    type: DEVICE_FEATURE_TYPES.FAN.SPEED,
    min: 1,
    max: 100,
  },
  fan_speed: {
    name: 'Speed',
    category: DEVICE_FEATURE_CATEGORIES.FAN,
    type: DEVICE_FEATURE_TYPES.FAN.SPEED,
    min: 1,
    max: 100,
  },
  // The one `fs` enum with a single documented vocabulary across products:
  // ["forward","reverse"] (the aliases are handled in tuya.deviceMapping.js).
  fan_direction: {
    name: 'Airflow direction',
    category: DEVICE_FEATURE_CATEGORIES.FAN,
    type: DEVICE_FEATURE_TYPES.FAN.AIRFLOW_DIRECTION,
    min: FAN_AIRFLOW_DIRECTION.FORWARD,
    max: FAN_AIRFLOW_DIRECTION.REVERSE,
  },
  // Oscillation, as two independent boolean DPs. Gladys has a native
  // FAN/ROCK_SETTING type, but it is a BITMAP (1 = left-right, 2 = up-down,
  // 3 = both): one Gladys feature cannot back two separate DPs, and a
  // vertical-only device would have to expose value 2 without exposing 1,
  // which the front's option list (values within min..max) cannot express.
  // Two plain switches say exactly what the device does.
  switch_horizontal: {
    name: 'Horizontal swing',
    category: DEVICE_FEATURE_CATEGORIES.SWITCH,
    type: DEVICE_FEATURE_TYPES.SWITCH.BINARY,
  },
  switch_vertical: {
    name: 'Vertical swing',
    category: DEVICE_FEATURE_CATEGORIES.SWITCH,
    type: DEVICE_FEATURE_TYPES.SWITCH.BINARY,
  },
  // The light of the fan: a real light in Gladys, so it lands in the light
  // controls (and not among the switches) like the `switch_led` of the
  // global mapping.
  light: {
    name: 'Light',
    category: DEVICE_FEATURE_CATEGORIES.LIGHT,
    type: DEVICE_FEATURE_TYPES.LIGHT.BINARY,
  },
  switch_led: {
    name: 'LED',
    category: DEVICE_FEATURE_CATEGORIES.LIGHT,
    type: DEVICE_FEATURE_TYPES.LIGHT.BINARY,
  },
  child_lock: {
    name: 'Child lock',
    category: DEVICE_FEATURE_CATEGORIES.CHILD_LOCK,
    type: DEVICE_FEATURE_TYPES.CHILD_LOCK.BINARY,
  },
  // Ambient temperature, on the fans that measure one (ventilation units,
  // fan-heaters). Scaled like every other Tuya temperature.
  temp_current: {
    name: 'Temperature',
    category: DEVICE_FEATURE_CATEGORIES.TEMPERATURE_SENSOR,
    type: DEVICE_FEATURE_TYPES.SENSOR.DECIMAL,
    unit: DEVICE_FEATURE_UNITS.CELSIUS,
  },
};

// LAN mapping: intentionally empty, like the pet feeder. The DPS indexes of a
// fan are product-specific (the reported unit is a ventilation device whose
// DP layout is nothing like a pedestal fan's), and no DPS dump of a supported
// fan is available yet. `strict: true` therefore sends every feature through
// the cloud, even when local mode is on, instead of writing a speed to
// whatever DP happens to sit at that index. A dump from the "Device
// diagnostic" action is all it takes to fill this in.
const localMapping = {
  strict: true,
  ignoredDps: [],
  codeAliases: {},
  dps: {},
};

export const fan = {
  DEVICE_TYPE_NAME: 'fan',
  CATEGORIES: new Set(['fs']),
  PRODUCT_IDS: new Set(),
  // Matched against the device name/model, and only for a device that also
  // exposes one of the codes above (accented and unaccented spellings: Tuya
  // names come from the Smart Life app, where the user typed them).
  KEYWORDS: [
    'fan',
    'ventilateur',
    'ventilation',
    'vmc',
    'extracteur',
    'extractor',
    'recuperateur',
    'récupérateur',
  ],
  REQUIRED_CODES: FAN_CODES,
  CLOUD_MAPPINGS: cloudMapping,
  LOCAL_MAPPINGS: localMapping,
};
