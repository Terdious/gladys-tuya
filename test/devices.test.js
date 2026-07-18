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
