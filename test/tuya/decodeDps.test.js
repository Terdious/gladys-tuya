import { test } from 'node:test';
import assert from 'node:assert/strict';

import { tryDecodeBase64Json, truncateForDisplay } from '../../src/tuya/utils/tuya.decodeDps.js';

test('tryDecodeBase64Json decodes a base64-encoded JSON object', () => {
  const raw = Buffer.from(JSON.stringify({ roomId: 42, name: 'bureau' })).toString('base64');
  assert.deepEqual(tryDecodeBase64Json(raw), { roomId: 42, name: 'bureau' });
});

test('tryDecodeBase64Json returns null for a plain (non-base64-JSON) DPS value', () => {
  assert.equal(tryDecodeBase64Json('quiet'), null);
  assert.equal(tryDecodeBase64Json('fullcharge'), null);
  assert.equal(tryDecodeBase64Json(true), null);
  assert.equal(tryDecodeBase64Json(100), null);
});

test('tryDecodeBase64Json returns null for base64 that decodes to non-JSON', () => {
  // "hello world" base64-encoded: valid base64, but not JSON once decoded.
  assert.equal(tryDecodeBase64Json(Buffer.from('hello world').toString('base64')), null);
});

test('truncateForDisplay keeps small structures untouched', () => {
  const value = { roomId: 42, points: [1, 2, 3] };
  assert.deepEqual(truncateForDisplay(value), value);
});

test('truncateForDisplay truncates a long array and keeps a count of the rest', () => {
  const value = { points: [1, 2, 3, 4, 5, 6, 7, 8] };
  assert.deepEqual(truncateForDisplay(value), { points: [1, 2, 3, 4, 5, '...(+3 more)'] });
});
