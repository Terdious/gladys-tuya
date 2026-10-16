import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

import {
  tryReconnect,
  scheduleQuickReconnects,
  clearQuickReconnects,
  startReconnect,
  stopReconnect,
} from '../../src/tuya/tuya.reconnect.js';
import { STATUS } from '../../src/tuya/constants.js';

// The reconnect manager (issue #20): quick-reconnect ladder, its re-entrancy
// guard, the timer bookkeeping and the 30-minute interval arm.

function createHandler(results) {
  const handler = {
    status: STATUS.ERROR,
    autoReconnectAllowed: true,
    reconnectInterval: null,
    quickReconnectTimeouts: [],
    quickReconnectInProgress: false,
    attempts: 0,
    async tryReconnect() {
      this.attempts += 1;
      return results[this.attempts - 1] !== undefined ? results[this.attempts - 1] : true;
    },
  };
  handler.scheduleQuickReconnects = scheduleQuickReconnects.bind(handler);
  handler.clearQuickReconnects = clearQuickReconnects.bind(handler);
  handler.startReconnect = startReconnect.bind(handler);
  handler.stopReconnect = stopReconnect.bind(handler);
  return handler;
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

test('the quick-reconnect ladder makes 3 attempts, 3 s apart, then stops', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const handler = createHandler([]);
  await handler.scheduleQuickReconnects();
  assert.equal(handler.attempts, 1);
  t.mock.timers.tick(3000);
  await flush();
  assert.equal(handler.attempts, 2);
  t.mock.timers.tick(3000);
  await flush();
  assert.equal(handler.attempts, 3);
  t.mock.timers.tick(30000);
  await flush();
  assert.equal(handler.attempts, 3);
  assert.equal(handler.quickReconnectInProgress, false);
  // No stale timer id left behind once the ladder is exhausted (was a slow leak).
  assert.deepEqual(handler.quickReconnectTimeouts, []);
});

test('a successful attempt ends the ladder', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const handler = createHandler([true, false]);
  await handler.scheduleQuickReconnects();
  t.mock.timers.tick(3000);
  await flush();
  t.mock.timers.tick(30000);
  await flush();
  assert.equal(handler.attempts, 2);
  assert.equal(handler.quickReconnectInProgress, false);
  assert.deepEqual(handler.quickReconnectTimeouts, []);
});

test('a ladder already running is not started twice', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const handler = createHandler([]);
  await handler.scheduleQuickReconnects();
  await handler.scheduleQuickReconnects();
  assert.equal(handler.attempts, 1);
  handler.clearQuickReconnects();
});

test('startReconnect arms one 30-minute interval that re-runs the ladder; stopReconnect clears it', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const handler = createHandler([false]);
  handler.status = STATUS.CONNECTED;
  handler.startReconnect();
  handler.startReconnect();
  // Connected: no immediate ladder.
  assert.equal(handler.attempts, 0);
  t.mock.timers.tick(30 * 60 * 1000);
  await flush();
  assert.equal(handler.attempts, 1);
  handler.stopReconnect();
  assert.equal(handler.reconnectInterval, null);
  t.mock.timers.tick(30 * 60 * 1000);
  await flush();
  assert.equal(handler.attempts, 1);
});

test('tryReconnect does nothing when auto-reconnect is off, unconfigured or manually disconnected', async () => {
  const base = {
    status: STATUS.ERROR,
    autoReconnectAllowed: true,
    connect: mock.fn(async () => {}),
  };
  assert.equal(await tryReconnect.call({ ...base, autoReconnectAllowed: false }), false);
  assert.equal(
    await tryReconnect.call({ ...base, getStatus: async () => ({ configured: false }) }),
    false,
  );
  assert.equal(
    await tryReconnect.call({
      ...base,
      getStatus: async () => ({ configured: true, manual_disconnect: true }),
    }),
    false,
  );
  assert.equal(base.connect.mock.callCount(), 0);
});
