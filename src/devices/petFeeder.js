// -----------------------------------------------------------------------------
// Device type: PET FEEDER (Tuya smart pet feeder, category `cwwsq`).
//
// Backport target: issue #35 (forum report of an F14-W feeder discovered with
// no feature at all). The standard `cwwsq` instruction set is cross-checked
// against the Home Assistant Tuya integration (PR home-assistant/core#61359 and
// the current const.py / number.py / sensor.py / switch.py mappings) and the
// Tuya category documentation (developer.tuya.com/en/docs/iot/categorycwwsq).
//
// Scope — cloud only (see LOCAL_MAPPINGS below): the local DPS indexes of a
// feeder vary from one model to another (community reports place `slow_feed` on
// DPS 6 on some models and DPS 23 on others), and no real DPS dump of a
// supported feeder is available yet. Declaring wrong indexes would write to the
// wrong DP, so the LAN mapping is intentionally left empty: every feature falls
// back to the cloud through the existing `partial_local_mapping` path, even
// when the local mode is enabled. LAN support can land once a diagnostic dump
// is available (issue #37).
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';

// Codes that identify a Tuya pet feeder (at least one must be exposed).
const PET_FEEDER_CODES = new Set(['manual_feed', 'feed_report', 'slow_feed', 'feed_state']);

const cloudMapping = {
  ignoredCodes: [
    // Feeding schedule: a raw (base64) payload, no Gladys feature type fits.
    'meal_plan',
    // Enum status (standby/feeding): needs a dedicated enum transform, and the
    // feed report already tells when a meal was served.
    'feed_state',
    // Voice recording settings, one-shot commands and charge state: no clean
    // feature type, or no value for the user.
    'voice_times',
    'voice_switch',
    'factory_reset',
    'charge_state',
    'quick_feed',
    'export_state',
    'weight',
    'unit',
    // F14-W variant (bench dump, forum): the second schedule slot is the same
    // raw hex payload as `meal_plan`, and `vip_alarm` is undocumented (it read
    // 0 on the bench device, with no way to tell what triggers it).
    'meal_plan2',
    'vip_alarm',
  ],
  // Writing a portion count triggers an immediate feed. Exposed as a PUSH
  // button: the Gladys push control always sends 1, i.e. one portion — the
  // common "feed now" gesture, usable in a scene (e.g. every day at 8am).
  manual_feed: {
    name: 'Feed',
    category: DEVICE_FEATURE_CATEGORIES.BUTTON,
    type: DEVICE_FEATURE_TYPES.BUTTON.PUSH,
  },
  // Portions served by the last feed (manual or scheduled).
  feed_report: {
    name: 'Last amount fed',
    category: DEVICE_FEATURE_CATEGORIES.COUNTER_SENSOR,
    type: DEVICE_FEATURE_TYPES.SENSOR.INTEGER,
  },
  slow_feed: {
    name: 'Slow feed',
    category: DEVICE_FEATURE_CATEGORIES.SWITCH,
    type: DEVICE_FEATURE_TYPES.SWITCH.BINARY,
  },
  light: {
    name: 'Light',
    category: DEVICE_FEATURE_CATEGORIES.SWITCH,
    type: DEVICE_FEATURE_TYPES.SWITCH.BINARY,
  },
  battery_percentage: {
    name: 'Battery',
    category: DEVICE_FEATURE_CATEGORIES.BATTERY,
    type: DEVICE_FEATURE_TYPES.SENSOR.INTEGER,
    unit: DEVICE_FEATURE_UNITS.PERCENT,
  },

  // --- F14-W variant codes ---------------------------------------------------
  // Same product id as above, but this firmware reports none of the standard
  // codes: `feed_record` instead of `feed_report`, `battery_val` instead of
  // `battery_percentage` (bench dump from the forum, issue #35). Both sets
  // live side by side: the lookup is per code, so each device gets the codes
  // it actually exposes.

  // The record of the last feed, as a compound value: {"value":3,"type":2}
  // (3 portions, dispensed manually). Only the portion count is exposed —
  // `type` has no documented vocabulary.
  feed_record: {
    name: 'Last amount fed',
    category: DEVICE_FEATURE_CATEGORIES.COUNTER_SENSOR,
    type: DEVICE_FEATURE_TYPES.SENSOR.INTEGER,
    jsonValueKey: 'value',
    min: 0,
    max: 50,
  },
  // Raw battery voltage in millivolts (2955 on the bench device). Published as
  // it is measured: converting it to a percentage would need the cell
  // chemistry and a discharge curve the device does not give us. The device's
  // own low-battery verdict is `battery_alarm` below.
  battery_val: {
    name: 'Battery voltage',
    category: DEVICE_FEATURE_CATEGORIES.ENERGY_SENSOR,
    type: DEVICE_FEATURE_TYPES.ENERGY_SENSOR.VOLTAGE,
    unit: DEVICE_FEATURE_UNITS.MILLI_VOLT,
    // Raw millivolts: unlike a mains meter (which reports decivolts), this DP
    // needs no division — pin the scale so the shared voltage reader does not
    // apply its default.
    scale: 0,
    min: 0,
    max: 10000,
  },
  // The device's own "batteries are low" flag: what a scene should trigger on.
  battery_alarm: {
    name: 'Battery low',
    category: DEVICE_FEATURE_CATEGORIES.BATTERY_LOW,
    type: DEVICE_FEATURE_TYPES.BATTERY_LOW.BINARY,
  },
  // How many meals the schedule currently holds.
  meal_plan_num: {
    name: 'Scheduled meals',
    category: DEVICE_FEATURE_CATEGORIES.COUNTER_SENSOR,
    type: DEVICE_FEATURE_TYPES.SENSOR.INTEGER,
    min: 0,
    max: 100,
  },
};

// LAN mapping, from the DPS dump of the F14-W (issue #35). Only the indexes
// whose value identifies them beyond doubt are declared: DPS 113 and 114 both
// read 0 and stand for `battery_alarm` / `vip_alarm` in an unknown order, so
// they are left out rather than risk publishing one as the other. `manual_feed`
// is a command DP that never appears in a read: it keeps going through the
// cloud. Any code absent here simply falls back to the cloud.
//
// `feed_state` and `meal_plan2` are declared even though both codes are
// currently ignored: they document the layout of this model for the day one of
// them gets a feature.
//
// These indexes come from one product id (the only pet feeder known to this
// integration). A second model with a different layout gets its own VARIANT
// rather than a change here.
const localMapping = {
  strict: true,
  ignoredDps: [],
  codeAliases: {},
  dps: {
    feed_state: 4,
    battery_val: 106,
    meal_plan2: 108,
    feed_record: 112,
  },
};

export const petFeeder = {
  DEVICE_TYPE_NAME: 'pet-feeder',
  CATEGORIES: new Set(['cwwsq']),
  PRODUCT_IDS: new Set(['cyip5aunfcx3ftws']),
  KEYWORDS: ['pet feeder', 'feeder', 'distributeur', 'croquette', 'gamelle'],
  REQUIRED_CODES: PET_FEEDER_CODES,
  CLOUD_MAPPINGS: cloudMapping,
  LOCAL_MAPPINGS: localMapping,
};
