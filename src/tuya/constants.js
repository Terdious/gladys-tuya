// -----------------------------------------------------------------------------
// Tuya constants, ported from the Gladys core service
// (server/services/tuya/lib/utils/tuya.constants.js).
// -----------------------------------------------------------------------------

// Tuya cloud API base URL per data center region.
export const TUYA_ENDPOINTS = {
  china: 'https://openapi.tuyacn.com',
  westernAmerica: 'https://openapi.tuyaus.com',
  easternAmerica: 'https://openapi-ueaz.tuyaus.com',
  centralEurope: 'https://openapi.tuyaeu.com',
  westernEurope: 'https://openapi-weaz.tuyaeu.com',
  india: 'https://openapi.tuyain.com',
};

// Connection status of the integration.
export const STATUS = {
  NOT_INITIALIZED: 'not_initialized',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  ERROR: 'error',
  DISCOVERING_DEVICES: 'discovering',
};

// Tuya cloud API version prefixes.
export const API = {
  PUBLIC_VERSION_1_0: '/v1.0',
  VERSION_1_0: '/v1.0/iot-03',
  VERSION_1_2: '/v1.2/iot-03',
  VERSION_2_0: '/v2.0/cloud',
};

// Names of the params stored on a Gladys device.
export const DEVICE_PARAM_NAME = {
  DEVICE_ID: 'DEVICE_ID',
  LOCAL_KEY: 'LOCAL_KEY',
  IP_ADDRESS: 'IP_ADDRESS',
  PROTOCOL_VERSION: 'PROTOCOL_VERSION',
  CLOUD_IP: 'CLOUD_IP',
  CLOUD_READ_STRATEGY: 'CLOUD_READ_STRATEGY',
  LOCAL_OVERRIDE: 'LOCAL_OVERRIDE',
  PRODUCT_ID: 'PRODUCT_ID',
  PRODUCT_KEY: 'PRODUCT_KEY',
  // Gladys persists neither the feature scale nor the inferred device type:
  // storing the type as a param makes the runtime re-resolution (scale
  // restore, variant mappings) independent of the name/category heuristics.
  DEVICE_TYPE: 'DEVICE_TYPE',
  // Same reason for the scale of the temperature codes: the spec scale is per
  // model (an AC can send 24 or 245 for the same 24.x degrees), so the one
  // read at discovery is stored as JSON ({"temp_current":0,...}) and wins
  // over the device-type default at poll/setValue time (issue #52).
  TEMPERATURE_SCALES: 'TEMPERATURE_SCALES',
  // And for the enum vocabulary of the AC mode / fan speed / swings: firmwares
  // spell the same values differently ("cold" vs "COOL", "low"/"high" vs
  // "1"/"2"), so the range the device declares is stored as JSON
  // ({"mode":["COOL","FAN",...],"windspeed":["1","2"]}) to read AND write
  // its own spelling.
  AC_ENUM_RANGES: 'AC_ENUM_RANGES',
};

// Type segment used to build every device external id:
// `ext:<selector>:<DEVICE_EXTERNAL_ID_TYPE>:<tuyaDeviceId>`. A constant segment
// keeps external ids stable even when the detected device type of a Tuya
// device changes (the platformId part is the stable Tuya device id).
export const DEVICE_EXTERNAL_ID_TYPE = 'device';
