// -----------------------------------------------------------------------------
// Device registry: one file per Tuya device type.
//
// Each definition mirrors the shape used by the core service in
// server/services/tuya/lib/mappings/index.js:
//   - DEVICE_TYPE_NAME : normalized type name (e.g. 'smart-socket')
//   - CATEGORIES       : Tuya categories matching this type
//   - PRODUCT_IDS      : known Tuya product ids of this type
//   - KEYWORDS         : name/model keywords matching this type
//   - REQUIRED_CODES   : at least one of these codes must be exposed
//   - CLOUD_MAPPINGS   : Tuya code -> Gladys feature mapping (cloud mode)
//
// The type inference and mapping lookups live in src/tuya/mappings/index.js.
// -----------------------------------------------------------------------------

import { smartSocket } from './smartSocket.js';
import { smartMeter } from './smartMeter.js';

export { globalCloudMapping } from './global.js';

// Same matching order as the core service.
export const DEVICE_TYPE_DEFINITIONS = [smartSocket, smartMeter];
