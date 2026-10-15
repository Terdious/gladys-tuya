import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DEVICE_TYPE_DEFINITIONS, globalCloudMapping } from '../../src/devices/index.js';
import {
  PILOT_WIRE_MODE_LABELS,
  AC_SUPPORTED_OPTION_SOURCES,
} from '../../src/tuya/device/tuya.deviceMapping.js';
import { DICTIONARIES, translateFeatureName } from '../../src/i18n/translateFeatureName.js';
import { SUPPORTED_FEATURE_NAMES_LANGS } from '../../src/config.js';

// Collect every `name`, `selectOptions[].label` and curated `selectLabels`
// value a CLOUD_MAPPINGS object (a device type's, a variant's, or the global
// one) can produce.
function collectFromCloudMapping(cloudMapping, collected, optionLists = []) {
  Object.values(cloudMapping || {}).forEach((entry) => {
    if (!entry || typeof entry !== 'object') {
      // Skip non-entry keys like `ignoredCodes` (a plain array).
      return;
    }
    if (typeof entry.name === 'string') {
      collected.add(entry.name);
    }
    if (Array.isArray(entry.selectOptions)) {
      optionLists.push(entry.selectOptions.map((option) => option && option.label));
      entry.selectOptions.forEach((option) => {
        if (option && typeof option.label === 'string') {
          collected.add(option.label);
        }
      });
    }
    // `selectOptionsFromRange` entries draw their labels from `selectLabels`
    // (e.g. the dehumidifier's dynamic lists). Only the curated values are
    // kept here; a value with no curated label falls back to a humanized form
    // ("level_2" -> "Level 2") and is left untranslated on purpose.
    if (entry.selectLabels && typeof entry.selectLabels === 'object') {
      optionLists.push(Object.values(entry.selectLabels));
      Object.values(entry.selectLabels).forEach((label) => {
        if (typeof label === 'string') {
          collected.add(label);
        }
      });
    }
  });
}

// Every English name/label this repo's mappings can currently produce, from
// every source convertFeature.js draws one from (see the comment above the
// translation step at the end of convertFeature).
// `optionLists` (optional) receives every list of labels shown together in
// one select, to check a translation never merges two options into one.
function collectAllFeatureNames(optionLists = []) {
  const collected = new Set();

  DEVICE_TYPE_DEFINITIONS.forEach((definition) => {
    collectFromCloudMapping(definition.CLOUD_MAPPINGS, collected, optionLists);
    (Array.isArray(definition.VARIANTS) ? definition.VARIANTS : []).forEach((variant) => {
      collectFromCloudMapping(variant.CLOUD_MAPPINGS, collected, optionLists);
    });
  });
  collectFromCloudMapping(globalCloudMapping, collected, optionLists);

  // Pilot-wire mode: English fallback labels for the first-class
  // HEATER.PILOT_WIRE_MODE type (see tuya.deviceMapping.js).
  Object.values(PILOT_WIRE_MODE_LABELS).forEach((label) => collected.add(label));
  optionLists.push(Object.values(PILOT_WIRE_MODE_LABELS));

  // AC mode/fan-speed/swing: same idea, one labels object per feature type.
  Object.values(AC_SUPPORTED_OPTION_SOURCES).forEach((source) => {
    Object.values(source.labels).forEach((label) => collected.add(label));
    optionLists.push(Object.values(source.labels));
  });

  // The doorbell-downgrade BUTTON option (pre-4.84.2 core) — see the
  // "Ring" literal in convertFeature.js.
  collected.add('Ring');

  return collected;
}

// Every non-English `feature_names` language, with its dictionary. English
// needs none: the mappings are written in English.
const TRANSLATED_LANGS = SUPPORTED_FEATURE_NAMES_LANGS.filter((lang) => lang !== 'en');

test('every supported feature_names language has a dictionary, and only those', () => {
  assert.deepEqual(Object.keys(DICTIONARIES).sort(), [...TRANSLATED_LANGS].sort());
});

TRANSLATED_LANGS.forEach((lang) => {
  const file = `src/i18n/featureNames.${lang}.js`;

  test(`[${lang}] every name/label the repo mappings can produce has an entry (fails on a new untranslated string)`, () => {
    const allNames = collectAllFeatureNames();
    const missing = [...allNames].filter((name) => DICTIONARIES[lang][name] === undefined).sort();
    assert.deepEqual(missing, [], `Add an entry in ${file} for: ${missing.join(', ')}`);
  });

  test(`[${lang}] the dictionary has no stale entry (every key still matches a real name/label)`, () => {
    // The reverse check: a dictionary entry for a name/label removed from a
    // mapping is dead weight, not a correctness bug — kept as its own test so
    // it can never block the exhaustiveness check above.
    const allNames = collectAllFeatureNames();
    const stale = Object.keys(DICTIONARIES[lang])
      .filter((key) => !allNames.has(key))
      .sort();
    assert.deepEqual(stale, [], `Remove now-unused entries from ${file}: ${stale.join(', ')}`);
  });

  test(`[${lang}] every value is a non-empty string`, () => {
    const invalid = Object.entries(DICTIONARIES[lang])
      .filter(([, value]) => typeof value !== 'string' || value.trim() === '')
      .map(([key]) => key);
    assert.deepEqual(invalid, [], `Empty/invalid translations in ${file}: ${invalid.join(', ')}`);
  });

  test(`[${lang}] two options of the same select never get the same translated label`, () => {
    // Two distinct English labels translated to the same word would make
    // two options indistinguishable in the Gladys select.
    const optionLists = [];
    collectAllFeatureNames(optionLists);
    const collisions = [];
    optionLists.forEach((labels) => {
      const english = [...new Set(labels.filter((label) => typeof label === 'string'))];
      const seen = new Map();
      english.forEach((label) => {
        const translated = translateFeatureName(label, lang);
        if (seen.has(translated)) {
          collisions.push(`${seen.get(translated)} / ${label} -> ${translated}`);
        } else {
          seen.set(translated, label);
        }
      });
    });
    assert.deepEqual(
      [...new Set(collisions)],
      [],
      `Same translated label for two options in ${file}`,
    );
  });
});

test('translateFeatureName translates a known string, passes through elsewhere', () => {
  assert.equal(translateFeatureName('Dock', 'fr'), 'Retour à la base');
  assert.equal(translateFeatureName('Dock', 'de'), 'Zur Ladestation');
  assert.equal(translateFeatureName('Switch', 'es'), 'Interruptor');
  // 'en' (the default) is a no-op, even for a string the dictionary knows.
  assert.equal(translateFeatureName('Dock', 'en'), 'Dock');
  // A string absent from the dictionary (e.g. a raw Tuya code used as a
  // fallback name) passes through unchanged in any language.
  assert.equal(translateFeatureName('switch_1', 'fr'), 'switch_1');
  // An unconfigured/unknown language is a no-op too, not an error.
  assert.equal(translateFeatureName('Dock', 'it'), 'Dock');
  assert.equal(translateFeatureName('Dock', undefined), 'Dock');
});
