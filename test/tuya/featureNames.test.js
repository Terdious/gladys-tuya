import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DEVICE_TYPE_DEFINITIONS, globalCloudMapping } from '../../src/devices/index.js';
import {
  PILOT_WIRE_MODE_LABELS,
  AC_SUPPORTED_OPTION_SOURCES,
} from '../../src/tuya/device/tuya.deviceMapping.js';
import { FEATURE_NAMES_FR } from '../../src/i18n/featureNames.fr.js';
import { translateFeatureName } from '../../src/i18n/translateFeatureName.js';

// Collect every `name` and `selectOptions[].label` a CLOUD_MAPPINGS object
// (a device type's, a variant's, or the global one) can produce.
function collectFromCloudMapping(cloudMapping, collected) {
  Object.values(cloudMapping || {}).forEach((entry) => {
    if (!entry || typeof entry !== 'object') {
      // Skip non-entry keys like `ignoredCodes` (a plain array).
      return;
    }
    if (typeof entry.name === 'string') {
      collected.add(entry.name);
    }
    if (Array.isArray(entry.selectOptions)) {
      entry.selectOptions.forEach((option) => {
        if (option && typeof option.label === 'string') {
          collected.add(option.label);
        }
      });
    }
  });
}

// Every English name/label this repo's mappings can currently produce, from
// every source convertFeature.js draws one from (see the comment above the
// translation step at the end of convertFeature).
function collectAllFeatureNames() {
  const collected = new Set();

  DEVICE_TYPE_DEFINITIONS.forEach((definition) => {
    collectFromCloudMapping(definition.CLOUD_MAPPINGS, collected);
    (Array.isArray(definition.VARIANTS) ? definition.VARIANTS : []).forEach((variant) => {
      collectFromCloudMapping(variant.CLOUD_MAPPINGS, collected);
    });
  });
  collectFromCloudMapping(globalCloudMapping, collected);

  // Pilot-wire mode: English fallback labels for the first-class
  // HEATER.PILOT_WIRE_MODE type (see tuya.deviceMapping.js).
  Object.values(PILOT_WIRE_MODE_LABELS).forEach((label) => collected.add(label));

  // AC mode/fan-speed/swing: same idea, one labels object per feature type.
  Object.values(AC_SUPPORTED_OPTION_SOURCES).forEach((source) => {
    Object.values(source.labels).forEach((label) => collected.add(label));
  });

  // The doorbell-downgrade BUTTON option (pre-4.84.2 core) — see the
  // "Ring" literal in convertFeature.js.
  collected.add('Ring');

  return collected;
}

test('every name/label the repo mappings can produce has a French entry (fails on a new untranslated string)', () => {
  const allNames = collectAllFeatureNames();
  const missing = [...allNames].filter((name) => FEATURE_NAMES_FR[name] === undefined).sort();

  assert.deepEqual(
    missing,
    [],
    `Add a French entry in src/i18n/featureNames.fr.js for: ${missing.join(', ')}`,
  );
});

test('FEATURE_NAMES_FR has no stale entry (every key still matches a real name/label)', () => {
  // The reverse check: a dictionary entry for a name/label removed from a
  // mapping is dead weight, not a correctness bug — kept as its own test so
  // it can never block the exhaustiveness check above.
  const allNames = collectAllFeatureNames();
  const stale = Object.keys(FEATURE_NAMES_FR)
    .filter((key) => !allNames.has(key))
    .sort();
  assert.deepEqual(
    stale,
    [],
    `Remove now-unused entries from featureNames.fr.js: ${stale.join(', ')}`,
  );
});

test('translateFeatureName translates a known string in fr, passes through elsewhere', () => {
  assert.equal(translateFeatureName('Dock', 'fr'), 'Retour à la base');
  // 'en' (the default) is a no-op, even for a string the dictionary knows.
  assert.equal(translateFeatureName('Dock', 'en'), 'Dock');
  // A string absent from the dictionary (e.g. a raw Tuya code used as a
  // fallback name) passes through unchanged in any language.
  assert.equal(translateFeatureName('switch_1', 'fr'), 'switch_1');
  // An unconfigured/unknown language is a no-op too, not an error.
  assert.equal(translateFeatureName('Dock', 'de'), 'Dock');
  assert.equal(translateFeatureName('Dock', undefined), 'Dock');
});
