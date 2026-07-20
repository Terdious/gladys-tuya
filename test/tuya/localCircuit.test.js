import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  isLocalInCooldown,
  localCooldownRemainingMs,
  recordLocalSuccess,
  recordLocalFailure,
  shouldLogIncompleteLocal,
  LOCAL_FAILURE_THRESHOLD,
  LOCAL_COOLDOWN_MS,
  INCOMPLETE_LOG_INTERVAL_MS,
} from '../../src/tuya/local/tuya.localCircuit.js';

test('circuit parks a device only after the failure threshold', () => {
  const map = new Map();
  const t0 = 1_000_000;
  let tripped;
  for (let i = 1; i < LOCAL_FAILURE_THRESHOLD; i += 1) {
    ({ tripped } = recordLocalFailure(map, 'dev1', t0));
    assert.equal(tripped, false, `failure ${i} should not trip`);
    assert.equal(isLocalInCooldown(map, 'dev1', t0), false);
  }
  ({ tripped } = recordLocalFailure(map, 'dev1', t0));
  assert.equal(tripped, true, 'threshold crossing trips once');
  assert.equal(isLocalInCooldown(map, 'dev1', t0), true);
  assert.equal(localCooldownRemainingMs(map, 'dev1', t0), LOCAL_COOLDOWN_MS);
});

test('cooldown expires after LOCAL_COOLDOWN_MS', () => {
  const map = new Map();
  const t0 = 1_000_000;
  for (let i = 0; i < LOCAL_FAILURE_THRESHOLD; i += 1) {
    recordLocalFailure(map, 'dev1', t0);
  }
  assert.equal(isLocalInCooldown(map, 'dev1', t0 + LOCAL_COOLDOWN_MS - 1), true);
  assert.equal(isLocalInCooldown(map, 'dev1', t0 + LOCAL_COOLDOWN_MS + 1), false);
});

test('a re-arm after the threshold is silent (tripped only on the crossing)', () => {
  const map = new Map();
  const t0 = 1_000_000;
  for (let i = 0; i < LOCAL_FAILURE_THRESHOLD; i += 1) {
    recordLocalFailure(map, 'dev1', t0);
  }
  // A further failure (e.g. the one re-probe after cooldown) re-arms silently.
  const later = t0 + LOCAL_COOLDOWN_MS + 10;
  const { tripped } = recordLocalFailure(map, 'dev1', later);
  assert.equal(tripped, false);
  assert.equal(isLocalInCooldown(map, 'dev1', later), true);
});

test('a local success clears the failures and the cooldown', () => {
  const map = new Map();
  const t0 = 1_000_000;
  for (let i = 0; i < LOCAL_FAILURE_THRESHOLD; i += 1) {
    recordLocalFailure(map, 'dev1', t0);
  }
  assert.equal(isLocalInCooldown(map, 'dev1', t0), true);
  recordLocalSuccess(map, 'dev1');
  assert.equal(isLocalInCooldown(map, 'dev1', t0), false);
  // And the counter restarts from zero: one failure must not trip again.
  const { tripped } = recordLocalFailure(map, 'dev1', t0);
  assert.equal(tripped, false);
});

test('incomplete-config notice is throttled to once per interval', () => {
  const map = new Map();
  const t0 = 1_000_000;
  assert.equal(shouldLogIncompleteLocal(map, 'dev1', t0), true);
  assert.equal(shouldLogIncompleteLocal(map, 'dev1', t0 + 1000), false);
  assert.equal(shouldLogIncompleteLocal(map, 'dev1', t0 + INCOMPLETE_LOG_INTERVAL_MS), true);
});
