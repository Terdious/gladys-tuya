import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEVICE_TYPE_DEFINITIONS, globalCloudMapping } from '../src/devices/index.js';

test('every device type definition exposes the required shape', () => {
  for (const definition of DEVICE_TYPE_DEFINITIONS) {
    assert.equal(typeof definition.DEVICE_TYPE_NAME, 'string');
    assert.ok(definition.CATEGORIES instanceof Set);
    assert.ok(definition.PRODUCT_IDS instanceof Set);
    assert.ok(Array.isArray(definition.KEYWORDS));
    assert.ok(definition.REQUIRED_CODES instanceof Set);
    assert.equal(typeof definition.CLOUD_MAPPINGS, 'object');
  }
});

test('device type names are unique', () => {
  const names = DEVICE_TYPE_DEFINITIONS.map((d) => d.DEVICE_TYPE_NAME);
  assert.equal(new Set(names).size, names.length);
});

test('every cloud mapping entry declares a category and a type', () => {
  const allMappings = [globalCloudMapping, ...DEVICE_TYPE_DEFINITIONS.map((d) => d.CLOUD_MAPPINGS)];
  for (const mapping of allMappings) {
    for (const [code, entry] of Object.entries(mapping)) {
      if (code === 'ignoredCodes') {
        assert.ok(Array.isArray(entry));
        continue;
      }
      assert.equal(typeof entry.category, 'string', `${code} has a category`);
      assert.equal(typeof entry.type, 'string', `${code} has a type`);
    }
  }
});

// Cross-definition invariants (issue #20): contradictions a reviewer would
// only spot by reading every device file side by side.

const definitionMappings = (definition) => [
  {
    label: definition.DEVICE_TYPE_NAME,
    cloud: definition.CLOUD_MAPPINGS,
    local: definition.LOCAL_MAPPINGS,
  },
  ...(Array.isArray(definition.VARIANTS) ? definition.VARIANTS : []).map((variant, index) => ({
    label: `${definition.DEVICE_TYPE_NAME} variant ${index}`,
    cloud: variant.CLOUD_MAPPINGS,
    local: variant.LOCAL_MAPPINGS,
  })),
];

test('no code is both mapped and ignored by the same cloud mapping', () => {
  const conflicts = [];
  DEVICE_TYPE_DEFINITIONS.forEach((definition) => {
    definitionMappings(definition).forEach(({ label, cloud }) => {
      const ignored = new Set(((cloud && cloud.ignoredCodes) || []).map((c) => c.toLowerCase()));
      Object.keys(cloud || {})
        .filter((code) => code !== 'ignoredCodes' && ignored.has(code.toLowerCase()))
        .forEach((code) => conflicts.push(`${label}: ${code}`));
    });
  });
  assert.deepEqual(conflicts, []);
});

test('no local DPS is both mapped and ignored by the same local mapping', () => {
  const conflicts = [];
  DEVICE_TYPE_DEFINITIONS.forEach((definition) => {
    definitionMappings(definition).forEach(({ label, local }) => {
      if (!local || !local.dps) {
        return;
      }
      const mapped = new Set(Object.values(local.dps).map(String));
      (local.ignoredDps || [])
        .filter((dps) => mapped.has(String(dps)))
        .forEach((dps) => conflicts.push(`${label}: DPS ${dps}`));
    });
  });
  assert.deepEqual(conflicts, []);
});

// A category shared on purpose, with the registry order that resolves it: a
// Tuya video doorbell IS a smart camera (`sp`), told apart by its doorbell
// codes, so the doorbell type must be tried first.
const SHARED_CATEGORIES = {
  sp: ['video-doorbell', 'camera'],
};

test('a Tuya category is claimed by one device type, unless shared on purpose in registry order', () => {
  const owners = new Map();
  DEVICE_TYPE_DEFINITIONS.forEach((definition) => {
    definition.CATEGORIES.forEach((category) => {
      owners.set(category, [...(owners.get(category) || []), definition.DEVICE_TYPE_NAME]);
    });
  });
  const shared = Object.fromEntries([...owners.entries()].filter(([, names]) => names.length > 1));
  assert.deepEqual(shared, SHARED_CATEGORIES);
});

test('no product id is claimed by two device types', () => {
  const owners = new Map();
  DEVICE_TYPE_DEFINITIONS.forEach((definition) => {
    definition.PRODUCT_IDS.forEach((productId) => {
      owners.set(productId, [...(owners.get(productId) || []), definition.DEVICE_TYPE_NAME]);
    });
  });
  const shared = [...owners.entries()].filter(([, names]) => names.length > 1);
  assert.deepEqual(shared, []);
});
