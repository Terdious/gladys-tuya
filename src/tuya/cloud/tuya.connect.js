// Ported from server/services/tuya/lib/tuya.connect.js.
//
// Differences with the core service:
// - the websocket status/error broadcasts of the core are replaced by logs
//   (the external integration has no custom UI to notify);
// - the MANUAL_DISCONNECT / LAST_CONNECTED_CONFIG_HASH variables are kept in
//   memory on the handler instead of the Gladys variable store.

import { createLogger } from '@gladysassistant/integration-sdk';

import { STATUS, API } from '../constants.js';
import { buildConfigHash } from '../utils/tuya.config.js';

const logger = createLogger({ name: 'tuya' });

/**
 * @description Map Tuya errors to user-facing error keys and retry policy.
 *
 * `key` is the core i18n key (kept for parity with the core service), and
 * `message` is the multi-language text actually shown in the Configuration
 * screen: an external integration cannot resolve a core i18n key, so without it
 * the user would read a raw "integration.tuya.setup.errorX" string.
 * @param {Error} error - Error thrown during connection.
 * @returns {object|null} Mapping info or null when unknown.
 * @example
 * const mapped = mapConnectionError(new Error('GET_TOKEN_FAILED 2009, clientId is invalid'));
 */
export const mapConnectionError = (error) => {
  const rawMessage = error && error.message ? error.message : '';
  const message = rawMessage.toLowerCase();
  const code = error && error.code ? String(error.code).toLowerCase() : '';

  if (
    code === '2009' ||
    message.includes('clientid is invalid') ||
    message.includes('get_token_failed 2009')
  ) {
    return {
      key: 'integration.tuya.setup.errorInvalidClientId',
      message: {
        en: 'Invalid Access ID / Client ID: copy it again from the Overview tab of your Tuya cloud project.',
        fr: "Access ID / Client ID invalide : recopiez-le depuis l'onglet Overview de votre projet Tuya cloud.",
      },
      disableAutoReconnect: true,
    };
  }

  if (
    code === '1004' ||
    message.includes('sign invalid') ||
    message.includes('get_token_failed 1004')
  ) {
    return {
      key: 'integration.tuya.setup.errorInvalidClientSecret',
      message: {
        en: 'Invalid Access Secret / Client Secret: copy it again from the Overview tab of your Tuya cloud project.',
        fr: "Access Secret / Client Secret invalide : recopiez-le depuis l'onglet Overview de votre projet Tuya cloud.",
      },
      disableAutoReconnect: true,
    };
  }

  if (
    code === '28841107' ||
    message.includes('data center is suspended') ||
    message.includes('data center')
  ) {
    return {
      key: 'integration.tuya.setup.errorInvalidEndpoint',
      message: {
        en: 'Wrong data center: pick the region your Tuya cloud project was created in.',
        fr: 'Mauvais data center : choisissez la région dans laquelle votre projet Tuya cloud a été créé.',
      },
      disableAutoReconnect: true,
    };
  }

  // The IoT Core service of the Tuya cloud project runs on a free trial (one
  // month, renewable for six more at no cost). Once it lapses Tuya rejects
  // EVERY API call of the project, so the raw message alone leaves the user
  // stuck: spell out the fix.
  if (code === '28841002' || message.includes('subscription has expired')) {
    return {
      key: 'integration.tuya.setup.errorSubscriptionExpired',
      message: {
        en:
          'The free trial of the Tuya "IoT Core" service has expired: every API call of your cloud project is rejected. ' +
          'Renew it for free on iot.tuya.com (Cloud > Development > your project > Service API, or Cloud > Cloud Services > IoT Core), then restart the integration.',
        fr:
          "L'essai gratuit du service Tuya « IoT Core » a expiré : tous les appels API de votre projet cloud sont rejetés. " +
          "Prolongez-le gratuitement sur iot.tuya.com (Cloud > Development > votre projet > Service API, ou Cloud > Cloud Services > IoT Core), puis redémarrez l'intégration.",
      },
      disableAutoReconnect: true,
    };
  }

  if (
    code === '1106' ||
    message.includes('permission deny') ||
    code === 'tuya_app_account_uid_missing' ||
    code === 'tuya_app_account_uid_invalid'
  ) {
    return {
      key: 'integration.tuya.setup.errorInvalidAppAccountUid',
      message: {
        en: 'Invalid app account UID, or the account is not linked: link your Smart Life / Tuya app account to the cloud project (Devices > Link Tuya App Account), then copy its UID.',
        fr: 'UID de compte applicatif invalide, ou compte non lié : liez votre compte Smart Life / Tuya au projet cloud (Devices > Link Tuya App Account), puis recopiez son UID.',
      },
      disableAutoReconnect: true,
    };
  }

  return null;
};

/**
 * @description Validate Tuya app account UID by calling the devices endpoint.
 * @param {object} connector - Tuya connector instance.
 * @param {string} appAccountId - Tuya app account UID.
 * @returns {Promise<void>} Resolves when valid.
 * @example
 * await validateAppAccount(connector, 'uid');
 */
export const validateAppAccount = async (connector, appAccountId) => {
  if (!appAccountId) {
    const error = new Error('TUYA_APP_ACCOUNT_UID_MISSING');
    error.code = 'TUYA_APP_ACCOUNT_UID_MISSING';
    throw error;
  }
  const response = await connector.request({
    method: 'GET',
    path: `${API.PUBLIC_VERSION_1_0}/users/${appAccountId}/devices`,
    query: {
      page_no: 1,
      page_size: 1,
    },
  });
  if (!response) {
    const error = new Error('TUYA_APP_ACCOUNT_UID_INVALID');
    error.code = 'TUYA_APP_ACCOUNT_UID_INVALID';
    throw error;
  }
  if (response.success === false) {
    const error = new Error(response.msg || response.message || 'TUYA_APP_ACCOUNT_UID_INVALID');
    error.code = response.code || 'TUYA_APP_ACCOUNT_UID_INVALID';
    throw error;
  }
};

/**
 * @description Connect to Tuya cloud.
 * @param {object} configuration - Normalized Tuya configuration (see src/config.js).
 * @example
 * await handler.connect({ baseUrl, accessKey, secretKey, appAccountId });
 */
export async function connect(configuration) {
  const { baseUrl, accessKey, secretKey, appAccountId } = configuration;

  if (!baseUrl || !accessKey || !secretKey || !appAccountId) {
    this.status = STATUS.NOT_INITIALIZED;
    throw new Error('Tuya is not configured.');
  }

  this.status = STATUS.CONNECTING;
  this.lastError = null;
  this.lastErrorMessage = null;
  logger.info('Connecting to Tuya...');

  this.connector = new this.TuyaContext({
    baseUrl,
    accessKey,
    secretKey,
    store: this,
  });

  try {
    await this.connector.client.init();
    await validateAppAccount(this.connector, appAccountId);
    this.manualDisconnectEnabled = false;
    this.lastConnectedConfigHash = buildConfigHash(configuration);
    this.autoReconnectAllowed = true;
    this.status = STATUS.CONNECTED;
    logger.info('Connected to Tuya');
  } catch (e) {
    this.status = STATUS.ERROR;
    const mapped = mapConnectionError(e);
    let message = 'Unknown error';
    if (mapped) {
      message = mapped.key;
    } else if (e && e.message) {
      message = e.message;
    }
    this.lastError = message;
    // The readable, multi-language reason shown in the Configuration screen:
    // the i18n key above cannot be resolved by an external integration, and the
    // raw Tuya message rarely says what to do. Unknown errors keep the raw
    // message (better than nothing).
    this.lastErrorMessage =
      mapped && mapped.message ? mapped.message : { en: message, fr: message };
    if (mapped && mapped.disableAutoReconnect) {
      this.autoReconnectAllowed = false;
    }
    logger.error(`Error connecting to Tuya: ${message}`, e);
  }
}
