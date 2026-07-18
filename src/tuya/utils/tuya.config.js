// Ported from server/services/tuya/lib/utils/tuya.config.js.

import crypto from 'node:crypto';

/**
 * @description Build a stable hash for the Tuya configuration.
 * @param {object} config - Tuya configuration.
 * @returns {string} SHA-256 hash.
 * @example
 * const hash = buildConfigHash({ endpoint: 'eu', accessKey: 'key', secretKey: 'secret', appAccountId: 'uid' });
 */
export const buildConfigHash = (config = {}) => {
  const payload = JSON.stringify({
    endpoint: config.endpoint || '',
    accessKey: config.accessKey || '',
    secretKey: config.secretKey || '',
    appAccountId: config.appAccountId || '',
  });
  return crypto.createHash('sha256').update(payload).digest('hex');
};
