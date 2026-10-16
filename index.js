// -----------------------------------------------------------------------------
// Entry point of the Gladys external integration.
//
// Role of this file: build the SDK client and the Tuya handler, register the
// integration handlers (src/app.js, where all the wiring lives and is
// tested), install the last-resort error guards, and connect. It holds NO
// hardware logic: all the Tuya "work" lives in the handler modules
// (src/tuya/).
//
// Environment variables provided by the Gladys supervisor to the container:
//   - GLADYS_HOST_API_URL         (host API URL)
//   - GLADYS_INTEGRATION_TOKEN    (integration-scoped JWT)
//   - GLADYS_INTEGRATION_SELECTOR (integration identifier)
// The SDK reads them automatically: `new GladysIntegration()` is enough.
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { TuyaHandler } from './src/tuya/handler.js';
import { createTuyaIntegration } from './src/app.js';

const gladys = new GladysIntegration();
const tuya = new TuyaHandler(gladys);
createTuyaIntegration(gladys, tuya);

// --- Last-resort error containment -------------------------------------------
// In the external-integration model an unhandled error kills the whole
// container (there is no core supervisor to catch it): log and keep running.
// Anything reaching these guards is a bug to fix upstream of them.
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection (bug: should be caught upstream)', reason);
});
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception (bug: should be caught upstream)', err);
});

// --- Startup -----------------------------------------------------------------
logger.info('Starting the Tuya integration...');
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
