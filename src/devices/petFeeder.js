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
};

// No LAN mapping yet (see the header): strict with no DPS, so every feature
// resolves to no local DPS and is polled over the cloud.
const localMapping = {
  strict: true,
  ignoredDps: [],
  codeAliases: {},
  dps: {},
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
