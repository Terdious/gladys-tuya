// -----------------------------------------------------------------------------
// Device type: WATER PURIFIER (Tuya category `js`, reverse-osmosis units).
//
// Issue #54: "The Box" reverse-osmosis purifier (product id 4lno1rskgtnivxni)
// discovered with no feature. Its diagnostic report (1.18.0) reads:
//   tds_in = 195              tds_out = 5
//   pp_filtertime  = 43       pp_filtertime_day  = 129
//   cto_filtertime = 72       cto_filtertime_day = 429
//   ro_filtertime  = 81       ro_filtertime_day  = 729
//   status = "standby"        switch_flow = false     fault = 0
//   pp/cto/ro_filter_reset = false
//   Declared enum ranges: status: purified, heating, standby, washing,
//     sterilization (status) | + water_intake (model)
// The three filter stages (PP sediment, CTO activated carbon, RO membrane)
// each report their remaining life twice: as a percentage and in days. The
// TDS (total dissolved solids, ppm) is read before and after filtration.
//
// LAN mapping from the DPS snapshot of the same report (see LOCAL_MAPPINGS).
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';

import { globalCloudMapping } from './global.js';

// Codes that identify a Tuya water purifier (at least one must be exposed).
const WATER_PURIFIER_CODES = new Set([
  'tds_in',
  'tds_out',
  'pp_filtertime',
  'cto_filtertime',
  'ro_filtertime',
  'pp_filtertime_day',
  'cto_filtertime_day',
  'ro_filtertime_day',
]);

// Remaining life of a filter stage, as the device reports it: already a
// percentage of the stage's full life (`percentRemaining`, see the
// MAINTENANCE reader in tuya.deviceMapping.js) — no full-life reference to
// convert from, unlike the vacuum brushes' elapsed seconds.
const filterLife = (name) => ({
  name,
  category: DEVICE_FEATURE_CATEGORIES.MAINTENANCE,
  type: DEVICE_FEATURE_TYPES.MAINTENANCE.LIFE_REMAINING,
  unit: DEVICE_FEATURE_UNITS.PERCENT,
  percentRemaining: true,
  min: 0,
  max: 100,
});

// The same filter's remaining life in days, counted down by the device.
const filterDays = (name) => ({
  name,
  category: DEVICE_FEATURE_CATEGORIES.DURATION,
  type: DEVICE_FEATURE_TYPES.DURATION.INTEGER,
  unit: DEVICE_FEATURE_UNITS.DAYS,
});

// TDS in ppm. Gladys has no water-quality category: COUNTER_SENSOR is its
// generic numeric sensor, and the front renders the unit generically.
const tds = (name) => ({
  name,
  category: DEVICE_FEATURE_CATEGORIES.COUNTER_SENSOR,
  type: DEVICE_FEATURE_TYPES.SENSOR.INTEGER,
  unit: DEVICE_FEATURE_UNITS.PPM,
});

const cloudMapping = {
  // A device-type mapping REPLACES the global one, and a purifier discovered
  // before this type existed was created as `unknown` — WITH the global
  // mapping. Starting from it guarantees that re-running the discovery can
  // only ADD features to those devices, never drop one.
  ...globalCloudMapping,
  ignoredCodes: [
    // One-shot "filter replaced" resets: writing one zeroes that stage's
    // counters. A single misclick on a dashboard would lose the filter's
    // real wear, so they stay in the Tuya app, next to the replacement
    // procedure.
    'pp_filter_reset',
    'cto_filter_reset',
    'ro_filter_reset',
    // Undocumented boolean (false on the reported unit, in standby): no way
    // to tell whether it reads a flow state or starts a flush.
    'switch_flow',
    // Bitmap of the device alarms: a raw bitmask nobody can read without the
    // per-product bit labels.
    'fault',
  ],
  tds_in: tds('Inlet TDS'),
  tds_out: tds('Outlet TDS'),
  pp_filtertime: filterLife('PP filter life'),
  cto_filtertime: filterLife('CTO filter life'),
  ro_filtertime: filterLife('RO filter life'),
  pp_filtertime_day: filterDays('PP filter days left'),
  cto_filtertime_day: filterDays('CTO filter days left'),
  ro_filtertime_day: filterDays('RO filter days left'),
  // Working state, read-only: a TEXT/SELECT whose options are the states the
  // device declares, so the dashboard shows a label instead of the raw string.
  status: {
    name: 'Status',
    category: DEVICE_FEATURE_CATEGORIES.TEXT,
    type: DEVICE_FEATURE_TYPES.TEXT.SELECT,
    keep_history: false,
    selectOptionsFromRange: true,
    selectLabels: {
      purified: 'Purifying',
      heating: 'Heating',
      water_intake: 'Water intake',
      standby: 'Standby',
      washing: 'Flushing',
      sterilization: 'Sterilizing',
    },
  },
};

// LAN mapping, from the DPS snapshot of issue #54: every declared index is
// identified by a value no other code shares (tds_out 5, tds_in 195, the six
// filter counters, "standby", fault 0). DPS 12, 17, 18 and 19 all read
// `false` and stand for switch_flow and the three filter resets in an unknown
// order: they are left out (all four codes are ignored anyway). `fault` is
// declared for the record — the code itself stays ignored.
//
// These indexes come from one product id. A second model with a different
// layout gets its own VARIANT rather than a change here.
const localMapping = {
  strict: true,
  ignoredDps: [],
  codeAliases: {},
  dps: {
    tds_out: 1,
    tds_in: 2,
    pp_filtertime: 3,
    cto_filtertime: 4,
    ro_filtertime: 5,
    status: 16,
    fault: 23,
    pp_filtertime_day: 26,
    cto_filtertime_day: 27,
    ro_filtertime_day: 28,
  },
};

export const waterPurifier = {
  DEVICE_TYPE_NAME: 'water-purifier',
  CATEGORIES: new Set(['js']),
  PRODUCT_IDS: new Set(['4lno1rskgtnivxni']),
  // Matched against the device name/model, and only for a device that also
  // exposes one of the codes above.
  KEYWORDS: [
    'osmoseur',
    'osmose',
    'osmosis',
    'water purifier',
    "purificateur d'eau",
    'purificateur eau',
  ],
  REQUIRED_CODES: WATER_PURIFIER_CODES,
  CLOUD_MAPPINGS: cloudMapping,
  LOCAL_MAPPINGS: localMapping,
};
