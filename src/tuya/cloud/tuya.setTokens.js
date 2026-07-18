// Ported from server/services/tuya/lib/tuya.setTokens.js.
//
// The core service persisted the tokens in the Gladys variable store. The
// external integration has no variable store, so the tokens live in memory on
// the handler: they are renegotiated by the Tuya connector at every container
// start (connector.client.init()).

import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'tuya' });

/**
 * @description Implements Tuya connector save token method.
 * @param {object} tokens - Tuya tokens.
 * @example
 * await handler.setTokens({ access_token: '...', refresh_token: '...', expire_time: '...' });
 * @see https://github.com/tuya/tuya-connector-nodejs#custom-tokenstore
 */
export async function setTokens(tokens) {
  logger.debug('Storing Tuya tokens...');
  this.tokens.access_token = tokens.access_token;
  this.tokens.refresh_token = tokens.refresh_token;
  logger.debug('Tuya tokens well stored');
  return true;
}
