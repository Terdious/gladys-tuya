import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TuyaHandler } from '../../src/tuya/handler.js';
import { PROTOCOL_CANDIDATES } from '../../src/tuya/local/tuya.detectProtocol.js';
import { LOCAL_FAILURE_THRESHOLD } from '../../src/tuya/local/tuya.localCircuit.js';
import { createFakeGladys } from '../helpers/fakeGladys.js';

const PARAMS = { deviceId: 'dev1', ip: '192.168.1.60', localKey: 'lk' };

test('detectProtocol returns the first protocol that answers with a DPS map', async () => {
  const handler = new TuyaHandler(createFakeGladys());
  const attempts = [];
  handler.localPoll = async ({ protocolVersion }) => {
    attempts.push(protocolVersion);
    if (protocolVersion === '3.4') {
      return { dps: { 1: true } };
    }
    throw new Error('Local poll timeout');
  };

  const { version, dps } = await handler.detectProtocol(PARAMS);
  assert.equal(version, '3.4');
  assert.deepEqual(dps, { 1: true });
  // 3.3 tried first (most common), then 3.4 answered: no further probing.
  assert.deepEqual(attempts, ['3.3', '3.4']);
});

test('detectProtocol throws with every failure when no protocol answers', async () => {
  const handler = new TuyaHandler(createFakeGladys());
  handler.localPoll = async () => {
    throw new Error('Local poll timeout');
  };

  await assert.rejects(() => handler.detectProtocol(PARAMS), /No local protocol answered/);
});

test('detectProtocol probes every candidate before giving up', async () => {
  const handler = new TuyaHandler(createFakeGladys());
  const attempts = [];
  handler.localPoll = async ({ protocolVersion }) => {
    attempts.push(protocolVersion);
    throw new Error('nope');
  };

  await assert.rejects(() => handler.detectProtocol(PARAMS));
  assert.deepEqual(attempts, PROTOCOL_CANDIDATES);
});

test('detectProtocol requires deviceId, ip and localKey', async () => {
  const handler = new TuyaHandler(createFakeGladys());
  await assert.rejects(
    () => handler.detectProtocol({ deviceId: 'dev1', ip: '' }),
    /requires deviceId, ip and localKey/,
  );
});

test('a successful detection clears the local circuit-breaker cooldown', async () => {
  const handler = new TuyaHandler(createFakeGladys());
  // Park the device first (as repeated poll timeouts would).
  for (let i = 0; i < LOCAL_FAILURE_THRESHOLD; i += 1) {
    const entry = handler.localCircuit.get('dev1') || { failures: 0, until: 0 };
    entry.failures += 1;
    entry.until = Date.now() + 60_000;
    handler.localCircuit.set('dev1', entry);
  }
  handler.localPoll = async () => ({ dps: { 1: true } });

  await handler.detectProtocol(PARAMS);
  const entry = handler.localCircuit.get('dev1');
  assert.equal(entry.failures, 0);
  assert.equal(entry.until, 0);
});
