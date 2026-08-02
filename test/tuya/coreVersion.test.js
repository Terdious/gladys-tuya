import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseVersion,
  compareVersions,
  coreSupportsFirstClassFeatureTypes,
  FIRST_CLASS_TYPES_MIN_CORE_VERSION,
} from '../../src/tuya/utils/tuya.coreVersion.js';

test('parseVersion tolerates a leading v and a suffix', () => {
  assert.deepEqual(parseVersion('4.84.2'), { major: 4, minor: 84, patch: 2 });
  assert.deepEqual(parseVersion('v4.84.2'), { major: 4, minor: 84, patch: 2 });
  assert.deepEqual(parseVersion('4.84.2-beta.1'), { major: 4, minor: 84, patch: 2 });
  assert.equal(parseVersion('not a version'), null);
  assert.equal(parseVersion(undefined), null);
});

test('compareVersions orders major/minor/patch', () => {
  assert.equal(compareVersions('4.84.2', '4.84.1'), 1);
  assert.equal(compareVersions('4.84.1', '4.84.2'), -1);
  assert.equal(compareVersions('4.84.2', '4.84.2'), 0);
  assert.equal(compareVersions('5.0.0', '4.99.99'), 1);
  assert.equal(compareVersions('4.9.0', '4.84.0'), -1);
  // An unparseable version compares as lower (safe default).
  assert.equal(compareVersions(undefined, '4.84.2'), -1);
});

test('coreSupportsFirstClassFeatureTypes gates on the 4.84.2 threshold', () => {
  assert.equal(FIRST_CLASS_TYPES_MIN_CORE_VERSION, '4.84.2');
  assert.equal(coreSupportsFirstClassFeatureTypes('4.84.2'), true);
  assert.equal(coreSupportsFirstClassFeatureTypes('4.85.0'), true);
  assert.equal(coreSupportsFirstClassFeatureTypes('5.0.0'), true);
  assert.equal(coreSupportsFirstClassFeatureTypes('4.84.1'), false);
  assert.equal(coreSupportsFirstClassFeatureTypes('4.62.0'), false);
  // Unknown / unreadable version -> treated as unsupported (safe).
  assert.equal(coreSupportsFirstClassFeatureTypes(undefined), false);
  assert.equal(coreSupportsFirstClassFeatureTypes(null), false);
});
