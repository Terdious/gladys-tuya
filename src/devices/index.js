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
//   - LOCAL_MAPPINGS   : Tuya code -> DPS index mapping (local/LAN mode)
//
// The type inference and mapping lookups live in src/tuya/mappings/index.js.
// -----------------------------------------------------------------------------

import { airConditioner } from './airConditioner.js';
import { videoDoorbell } from './videoDoorbell.js';
import { camera } from './camera.js';
import { pilotThermostat } from './pilotThermostat.js';
import { petFeeder } from './petFeeder.js';
import { smartSocket } from './smartSocket.js';
import { smartMeter } from './smartMeter.js';

export { globalCloudMapping, globalLocalMapping } from './global.js';

// Matching order matters: the video doorbell shares the `sp` camera category,
// so it must be tried BEFORE `camera` (it requires the `doorbell_active` code a
// plain camera never exposes).
export const DEVICE_TYPE_DEFINITIONS = [
  airConditioner,
  videoDoorbell,
  camera,
  pilotThermostat,
  petFeeder,
  smartSocket,
  smartMeter,
];
