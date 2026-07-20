import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig, isConfigured, DEFAULT_CONFIG } from '../src/config.js';
import { TUYA_ENDPOINTS } from '../src/tuya/constants.js';

test('normalizeConfig returns the defaults (plus baseUrl) when called with no argument', () => {
  const config = normalizeConfig();
  assert.deepEqual(config, { ...DEFAULT_CONFIG, baseUrl: TUYA_ENDPOINTS.china });
});

test('normalizeConfig keeps user values over the defaults', () => {
  const config = normalizeConfig({
    endpoint: 'centralEurope',
    access_key: 'my-access-key',
    secret_key: 'my-secret-key',
    app_account_id: 'my-uid',
    app_username: 'user@example.com',
  });
  assert.equal(config.endpoint, 'centralEurope');
  assert.equal(config.accessKey, 'my-access-key');
  assert.equal(config.secretKey, 'my-secret-key');
  assert.equal(config.appAccountId, 'my-uid');
  assert.equal(config.appUsername, 'user@example.com');
});

test('normalizeConfig reads GLADYS_PREFER_LOCAL, on by default', () => {
  // The reserved key is injected by the core (manifest transports) with a
  // default of true: only an explicit opt-out turns local mode off.
  assert.equal(normalizeConfig().localMode, true);
  assert.equal(normalizeConfig({ GLADYS_PREFER_LOCAL: true }).localMode, true);
  assert.equal(normalizeConfig({ GLADYS_PREFER_LOCAL: false }).localMode, false);
  assert.equal(normalizeConfig({ GLADYS_PREFER_LOCAL: 'false' }).localMode, false);
});

test('normalizeConfig resolves the base URL from the endpoint region', () => {
  const config = normalizeConfig({ endpoint: 'centralEurope' });
  assert.equal(config.baseUrl, 'https://openapi.tuyaeu.com');
});

test('normalizeConfig falls back to the China endpoint for an unknown region', () => {
  const config = normalizeConfig({ endpoint: 'not-a-region' });
  assert.equal(config.baseUrl, TUYA_ENDPOINTS.china);
});

test('normalizeConfig trims values coming from a form', () => {
  const config = normalizeConfig({ access_key: '  key  ', endpoint: ' centralEurope ' });
  assert.equal(config.accessKey, 'key');
  assert.equal(config.endpoint, 'centralEurope');
  assert.equal(config.baseUrl, TUYA_ENDPOINTS.centralEurope);
});

test('isConfigured requires the cloud credentials and the app account UID', () => {
  assert.equal(isConfigured(normalizeConfig()), false);
  assert.equal(
    isConfigured(normalizeConfig({ endpoint: 'centralEurope', access_key: 'a', secret_key: 's' })),
    false,
  );
  assert.equal(
    isConfigured(
      normalizeConfig({
        endpoint: 'centralEurope',
        access_key: 'a',
        secret_key: 's',
        app_account_id: 'u',
      }),
    ),
    true,
  );
});

test('isConfigured does not require the optional Smart Life username', () => {
  const config = normalizeConfig({
    endpoint: 'westernEurope',
    access_key: 'a',
    secret_key: 's',
    app_account_id: 'u',
  });
  assert.equal(config.appUsername, '');
  assert.equal(isConfigured(config), true);
});
