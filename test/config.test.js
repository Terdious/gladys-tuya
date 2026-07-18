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
    accessKey: 'my-access-key',
    secretKey: 'my-secret-key',
    appAccountId: 'my-uid',
    appUsername: 'user@example.com',
  });
  assert.equal(config.endpoint, 'centralEurope');
  assert.equal(config.accessKey, 'my-access-key');
  assert.equal(config.secretKey, 'my-secret-key');
  assert.equal(config.appAccountId, 'my-uid');
  assert.equal(config.appUsername, 'user@example.com');
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
  const config = normalizeConfig({ accessKey: '  key  ', endpoint: ' centralEurope ' });
  assert.equal(config.accessKey, 'key');
  assert.equal(config.endpoint, 'centralEurope');
  assert.equal(config.baseUrl, TUYA_ENDPOINTS.centralEurope);
});

test('isConfigured requires the cloud credentials and the app account UID', () => {
  assert.equal(isConfigured(normalizeConfig()), false);
  assert.equal(
    isConfigured(normalizeConfig({ endpoint: 'centralEurope', accessKey: 'a', secretKey: 's' })),
    false,
  );
  assert.equal(
    isConfigured(
      normalizeConfig({
        endpoint: 'centralEurope',
        accessKey: 'a',
        secretKey: 's',
        appAccountId: 'u',
      }),
    ),
    true,
  );
});

test('isConfigured does not require the optional Smart Life username', () => {
  const config = normalizeConfig({
    endpoint: 'westernEurope',
    accessKey: 'a',
    secretKey: 's',
    appAccountId: 'u',
  });
  assert.equal(config.appUsername, '');
  assert.equal(isConfigured(config), true);
});
