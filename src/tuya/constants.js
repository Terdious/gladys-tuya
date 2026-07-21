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
  VERSION_1_1: '/v1.1/iot-03',
  VERSION_1_2: '/v1.2/iot-03',
  VERSION_1_3: '/v1.3/iot-03',
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
};

// Type segment used to build every device external id:
// `ext:<selector>:<DEVICE_EXTERNAL_ID_TYPE>:<tuyaDeviceId>`. A constant segment
// keeps external ids stable even when the detected device type of a Tuya
// device changes (the platformId part is the stable Tuya device id).
export const DEVICE_EXTERNAL_ID_TYPE = 'device';
