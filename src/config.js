// -----------------------------------------------------------------------------
// Integration configuration.
//
// The configuration is filled in by the user in Gladys, from the `config_schema`
// declared in `gladys-assistant-integration.json`. The SDK fetches it for you
// (`gladys.getConfig()`) and notifies you of every change through
// `gladys.onConfigUpdated()`.
//
// The fields mirror the configuration of the Gladys core Tuya service
// (server/services/tuya/lib/tuya.getConfiguration.js): cloud project
// credentials, data center region and the Smart Life app account.
// -----------------------------------------------------------------------------

import { TUYA_ENDPOINTS } from './tuya/constants.js';

// Defaults, keyed by the normalized (internal) names. The `config_schema`
// keys of the manifest are snake_case (the manifest schema only allows
// [a-z0-9_] keys): normalizeConfig maps them to these internal names.
export const DEFAULT_CONFIG = {
  endpoint: '', // Tuya data center region key (see TUYA_ENDPOINTS)
  accessKey: '', // Tuya cloud project Access ID / Client ID
  secretKey: '', // Tuya cloud project Access Secret / Client Secret
  appAccountId: '', // Smart Life / Tuya app account UID
  appUsername: '', // Smart Life account email or phone (optional)
  localMode: false, // poll/control over the LAN when reachable, cloud otherwise
};

const asTrimmedString = (value, fallback) => {
  if (value === undefined || value === null) {
    return fallback;
  }
  return String(value).trim();
};

const asBoolean = (value) => value === true || value === 'true' || value === 1 || value === '1';

/**
 * Normalize the user config (snake_case `config_schema` keys) into the
 * internal shape and derive the cloud base URL. Like the core service, an
 * unknown region falls back to the China endpoint.
 * @param {Record<string, unknown>} raw config returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const endpoint = asTrimmedString(raw.endpoint, DEFAULT_CONFIG.endpoint);
  return {
    ...DEFAULT_CONFIG,
    endpoint,
    accessKey: asTrimmedString(raw.access_key, DEFAULT_CONFIG.accessKey),
    secretKey: asTrimmedString(raw.secret_key, DEFAULT_CONFIG.secretKey),
    appAccountId: asTrimmedString(raw.app_account_id, DEFAULT_CONFIG.appAccountId),
    appUsername: asTrimmedString(raw.app_username, DEFAULT_CONFIG.appUsername),
    localMode: asBoolean(raw.local_mode),
    // Same fallback as the core service: unknown region -> China endpoint.
    baseUrl: TUYA_ENDPOINTS[endpoint] || TUYA_ENDPOINTS.china,
  };
}

/**
 * True when every mandatory cloud field is filled in
 * (same required fields as the core service init/connect guard).
 * @param {ReturnType<typeof normalizeConfig>} config normalized configuration
 */
export function isConfigured(config) {
  return Boolean(config.baseUrl && config.accessKey && config.secretKey && config.appAccountId);
}
