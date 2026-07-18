// Ported from server/services/tuya/lib/tuya.getRefreshToken.js.

import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'tuya' });

/**
 * @description Implements Tuya connector get refresh token method.
 * @returns {Promise<string|undefined>} Tuya refresh token.
 * @example
 * await handler.getRefreshToken();
 * @see https://github.com/tuya/tuya-connector-nodejs#custom-tokenstore
 */
export async function getRefreshToken() {
  logger.debug('Loading Tuya refresh token...');
  return this.tokens.refresh_token;
}
