import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DEVICE_FEATURE_CATEGORIES, DEVICE_FEATURE_TYPES } from '@gladysassistant/integration-sdk';

import { DEVICE_TYPE_DEFINITIONS, globalCloudMapping } from '../../src/devices/index.js';
import { readValues, writeValues } from '../../src/tuya/device/tuya.deviceMapping.js';
import { EVENT_DRIVEN_CATEGORIES } from '../../src/tuya/tuya.poll.js';

// Every category/type pair declared by a cloud mapping, with where it comes
// from (for a readable assertion message).
const collectMappedPairs = () => {
  const pairs = new Map();
  const visit = (origin, mapping) => {
    for (const [code, entry] of Object.entries(mapping || {})) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        continue; // ignoredCodes and friends
      }
      if (entry.category && entry.type) {
        const key = `${entry.category}/${entry.type}`;
        const origins = pairs.get(key) || [];
        origins.push(`${origin}:${code}`);
        pairs.set(key, origins);
      }
    }
  };
  visit('global', globalCloudMapping);
  for (const definition of DEVICE_TYPE_DEFINITIONS) {
    visit(definition.DEVICE_TYPE_NAME, definition.CLOUD_MAPPINGS);
    for (const variant of definition.VARIANTS || []) {
      visit(`${definition.DEVICE_TYPE_NAME}/${variant.VARIANT_NAME}`, variant.CLOUD_MAPPINGS);
    }
  }
  return pairs;
};

test('every mapped category/type has a reader, unless the category is event-driven', () => {
  // Guard against the 1.12.0 regression: a mapping can declare a feature
  // (e.g. COUNTER_SENSOR for the feeder, BATTERY for the vacuum) that the poll
  // then silently skips because readValues has no entry for it. The feature is
  // created in Gladys and never updated.
  const missing = [];
  for (const [key, origins] of collectMappedPairs()) {
    const [category, type] = key.split('/');
    if (EVENT_DRIVEN_CATEGORIES.has(category)) {
      continue;
    }
    const reader = readValues[category] && readValues[category][type];
    if (typeof reader !== 'function') {
      missing.push(`${key} (${origins.join(', ')})`);
    }
  }
  assert.deepEqual(
    missing,
    [],
    `mapped features without a readValues entry (add a reader, or add the category to EVENT_DRIVEN_CATEGORIES if it is fired by the media handler):\n${missing.join('\n')}`,
  );
});

test('EVENT_DRIVEN_CATEGORIES only lists categories actually fed outside the poll', () => {
  assert.deepEqual(
    [...EVENT_DRIVEN_CATEGORIES].sort(),
    [
      DEVICE_FEATURE_CATEGORIES.BUTTON,
      DEVICE_FEATURE_CATEGORIES.CAMERA,
      DEVICE_FEATURE_CATEGORIES.DOORBELL,
      DEVICE_FEATURE_CATEGORIES.MOTION_SENSOR,
    ].sort(),
  );
});

test('SIREN.BINARY reads a boolean DP as 1/0 and writes a Gladys 1/0 as a boolean', () => {
  const read = readValues[DEVICE_FEATURE_CATEGORIES.SIREN][DEVICE_FEATURE_TYPES.SIREN.BINARY];
  const write = writeValues[DEVICE_FEATURE_CATEGORIES.SIREN][DEVICE_FEATURE_TYPES.SIREN.BINARY];
  assert.equal(read(true), 1);
  assert.equal(read(false), 0);
  assert.equal(read('true'), 1);
  // Before this reader/writer existed, the camera siren was never polled and
  // setValue sent the raw integer 1 to a boolean DP.
  assert.equal(write(1), true);
  assert.equal(write(0), false);
});

test('COUNTER_SENSOR reads an integer DP, honouring the feature scale', () => {
  const read =
    readValues[DEVICE_FEATURE_CATEGORIES.COUNTER_SENSOR][DEVICE_FEATURE_TYPES.SENSOR.INTEGER];
  assert.equal(read(3, { scale: 0 }), 3);
  assert.equal(read(3, {}), 3);
  assert.equal(read(25, { scale: 1 }), 2.5);
});
