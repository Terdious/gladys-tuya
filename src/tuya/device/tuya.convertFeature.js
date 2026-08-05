// Ported from server/services/tuya/lib/device/tuya.convertFeature.js.
//
// The feature external id is built with the SDK external-ids factory instead
// of the hand-built `tuya:<id>:<code>` of the core; the core-side selector
// generation (addSelector) is left to Gladys.

import {
  createLogger,
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
} from '@gladysassistant/integration-sdk';

import { getFeatureMapping, getIgnoredCloudCodes, normalizeCode } from '../mappings/index.js';
import { buildFeatureSelector } from '../utils/tuya.selector.js';
import { buildAcSupportedOptions, buildPilotWireSupportedOptions } from './tuya.deviceMapping.js';

const logger = createLogger({ name: 'tuya' });

// AC feature types introduced in Gladys core 4.84.2 (older cores reject them).
const AC_FIRST_CLASS_TYPES = [
  DEVICE_FEATURE_TYPES.AIR_CONDITIONING.FAN_SPEED,
  DEVICE_FEATURE_TYPES.AIR_CONDITIONING.SWING_HORIZONTAL,
  DEVICE_FEATURE_TYPES.AIR_CONDITIONING.SWING_VERTICAL,
];

// Every discovery re-converts every device: warn once per unknown code per
// process instead of re-printing the same 60-line wall on each scan.
const warnedUnmanagedCodes = new Set();

/**
 * @description Transforms Tuya feature as Gladys feature.
 * @param {object} tuyaFunctions - Functions from Tuya.
 * @param {object} ids - Device external ids factory (gladys.externalIds result).
 * @param {object} options - Mapping options.
 * @returns {object} Gladys feature or undefined.
 * @example
 * convertFeature({ code: 'switch', values: '{}', readOnly: false }, ids, { deviceType: 'smart-socket' });
 */
export function convertFeature(tuyaFunctions, ids, options = {}) {
  const { code, values, readOnly } = tuyaFunctions;
  const {
    deviceType,
    ignoredCloudCodes,
    deviceSelector,
    temperatureUnit,
    productId,
    // Whether the running Gladys core (>= 4.84.2) accepts the DOORBELL category
    // and the AC fan-speed / swing types. Defaults to true (the current core);
    // index.js passes the value it detects from gladys.getStatus() so an older
    // core gets the downgraded mapping below instead of a rejected discovery.
    coreSupportsFirstClassTypes = true,
    // Optional collector filled with what happened to each code, so the caller
    // can log a per-device discovery summary (mapped / ignored / unmanaged).
    // This is what makes an unsupported device reportable by a user: the
    // per-code warning below is deduplicated for the whole process lifetime.
    report,
  } = options;
  const collect = (bucket, value) => {
    if (report && Array.isArray(report[bucket])) {
      report[bucket].push(value);
    }
  };

  const codeLower = normalizeCode(code);
  const ignoredCodes = Array.isArray(ignoredCloudCodes)
    ? ignoredCloudCodes
    : getIgnoredCloudCodes(deviceType, productId);
  if (codeLower && ignoredCodes.includes(codeLower)) {
    collect('ignored', codeLower);
    return undefined;
  }

  const mappingEntry = getFeatureMapping(code, deviceType, productId);
  if (!mappingEntry) {
    collect('unmanaged', codeLower || String(code));
    if (!warnedUnmanagedCodes.has(codeLower)) {
      warnedUnmanagedCodes.add(codeLower);
      logger.warn(`Tuya function with "${code}" code is not managed`);
    } else {
      logger.debug(`Tuya function with "${code}" code is not managed`);
    }
    return undefined;
  }
  // tuyaEnum is mapping-only metadata (per-variant mode vocabulary consumed by
  // the read/write pipeline); it must not leak onto the persisted feature.
  const { tuyaEnum: _tuyaEnum, ...featuresCategoryAndType } = mappingEntry;

  // Graceful degradation for a Gladys core older than 4.84.2, which knows
  // neither the DOORBELL category nor the AC fan-speed / swing types. The core
  // discovery validator rejects the WHOLE device list on a single unknown
  // category/type, so we must not publish them there: downgrade the doorbell
  // ring to a BUTTON click (its pre-4.84.2 mapping) and skip the AC fan/swing
  // features entirely. On a supported core, nothing changes.
  let downgradeSupportedOptions = null;
  if (!coreSupportsFirstClassTypes) {
    if (featuresCategoryAndType.category === DEVICE_FEATURE_CATEGORIES.DOORBELL) {
      featuresCategoryAndType.category = DEVICE_FEATURE_CATEGORIES.BUTTON;
      featuresCategoryAndType.type = DEVICE_FEATURE_TYPES.BUTTON.CLICK;
      // The button only ever reports the ring: expose that single option so the
      // scene value selector shows "Ring", not the full generic button list.
      downgradeSupportedOptions = [{ value: 1, label: 'Ring', sort_order: 0 }];
    } else if (
      featuresCategoryAndType.category === DEVICE_FEATURE_CATEGORIES.AIR_CONDITIONING &&
      AC_FIRST_CLASS_TYPES.includes(featuresCategoryAndType.type)
    ) {
      collect('ignored', `${codeLower} (needs Gladys >= 4.84.2)`);
      return undefined;
    }
  }

  let valuesObject = {};
  if (values && typeof values === 'object') {
    valuesObject = values;
  } else if (typeof values === 'string') {
    try {
      valuesObject = JSON.parse(values);
    } catch {
      logger.error(
        `Tuya function as unmappable "${values}" values on "${featuresCategoryAndType.category}/${featuresCategoryAndType.type}" type with "${code}" code`,
      );
    }
  }

  const feature = {
    external_id: ids.feature(code),
    // Scope the selector to the device so two devices exposing a feature with
    // the same code/name do not collide on a globally-unique selector (the
    // core rejects duplicates). When no device selector is provided, let the
    // core derive it from the name (legacy behaviour).
    ...(deviceSelector ? { selector: buildFeatureSelector(deviceSelector, code) } : {}),
    read_only: readOnly,
    has_feedback: false,
    min: 0,
    max: 1,
    ...featuresCategoryAndType,
  };
  // Display name priority: a curated mapping name wins so device-type mappings
  // can fix Tuya typos (e.g. code "energy_forword_a" -> name "Forward energy A").
  // Otherwise the Tuya code is used as the display name, preserving the existing
  // behaviour for device types without curated names. (`code` is always defined
  // here: an empty code is rejected earlier by getFeatureMapping.)
  feature.name = featuresCategoryAndType.name || code;
  if (typeof valuesObject.min === 'number') {
    feature.min = valuesObject.min;
  }
  if (typeof valuesObject.max === 'number') {
    feature.max = valuesObject.max;
  }
  if ('scale' in valuesObject) {
    feature.scale = valuesObject.scale;
  }
  // Some devices report their temperatures in Fahrenheit (temp_unit_convert /
  // unit property): reflect the real device unit on the feature.
  if (
    temperatureUnit &&
    (codeLower === 'temp_set' || codeLower === 'temp_current') &&
    feature.unit !== undefined
  ) {
    feature.unit = temperatureUnit;
  }

  // Scaled target temperatures declare their bounds in device units (an AC
  // spec with min 160 / max 880 and scale 1 means 16..88 degrees): bring the
  // Gladys min/max back to real degrees, like the value transforms do.
  const isScaledTargetTemperature =
    (feature.category === DEVICE_FEATURE_CATEGORIES.AIR_CONDITIONING &&
      feature.type === DEVICE_FEATURE_TYPES.AIR_CONDITIONING.TARGET_TEMPERATURE) ||
    (feature.category === DEVICE_FEATURE_CATEGORIES.THERMOSTAT &&
      feature.type === DEVICE_FEATURE_TYPES.THERMOSTAT.TARGET_TEMPERATURE);
  if (feature.scale !== undefined && isScaledTargetTemperature) {
    const divider = 10 ** feature.scale;
    feature.min /= divider;
    feature.max /= divider;
  }
  // A writable feature reports its state back after a command.
  if (feature.read_only === false) {
    feature.has_feedback = true;
  }
  if (
    feature.category === DEVICE_FEATURE_CATEGORIES.HEATER &&
    feature.type === DEVICE_FEATURE_TYPES.HEATER.PILOT_WIRE_MODE
  ) {
    // Restrict UI mode choices to what this device really supports: the spec
    // enum range intersected with the device vocabulary (variants may lack
    // Off/Thermostat — writing them is rejected anyway).
    feature.supported_options = buildPilotWireSupportedOptions(mappingEntry, valuesObject.range);
  }
  if (feature.category === DEVICE_FEATURE_CATEGORIES.AIR_CONDITIONING) {
    // Same restriction for the AC enums (mode / fan speed / swings): models
    // vary a lot (cold-only units, no quiet/turbo...), the spec range is the
    // per-device truth. Null for non-enum types (binary, target temperature).
    const acSupportedOptions = buildAcSupportedOptions(feature.type, valuesObject.range);
    if (acSupportedOptions) {
      feature.supported_options = acSupportedOptions;
    }
  }
  // A doorbell downgraded to a BUTTON (old core) carries its single "Ring"
  // option so the scene selector stays clean.
  if (downgradeSupportedOptions) {
    feature.supported_options = downgradeSupportedOptions;
  }

  collect('mapped', `${codeLower}=${feature.category}/${feature.type}`);
  return feature;
}
