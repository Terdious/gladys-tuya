// Ported from server/services/tuya/lib/tuya.getAccessToken.js.

import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'tuya' });

/**
 * @description Implements Tuya connector get access token method.
 * @returns {Promise<string|undefined>} Tuya access token.
 * @example
 * await handler.getAccessToken();
 * @see https://github.com/tuya/tuya-connector-nodejs#custom-tokenstore
 */
export async function getAccessToken() {
  logger.debug('Loading Tuya access token...');
  return this.tokens.access_token;
}
