// Ported from server/services/tuya/lib/utils/tuya.cloudStrategy.js.
//
// A device is read either through the legacy status endpoint or through the
// thing shadow properties endpoint, depending on which one exposes supported
// codes. The strategy chosen at discovery time is stored in the
// CLOUD_READ_STRATEGY device param.

import { DEVICE_PARAM_NAME } from '../constants.js';
import { getParamValue } from '../utils/tuya.deviceParams.js';
import { getFeatureMapping, getIgnoredCloudCodes, normalizeCode } from '../mappings/index.js';

export const CLOUD_STRATEGY = {
  LEGACY: 'legacy',
  SHADOW: 'shadow',
};

const isSupportedCloudCode = (code, deviceType, ignoredCloudCodes) => {
  const normalizedCode = normalizeCode(code);
  if (!normalizedCode) {
    return false;
  }
  if (ignoredCloudCodes.includes(normalizedCode)) {
    return false;
  }
  return Boolean(getFeatureMapping(normalizedCode, deviceType));
};

const getThingModelProperties = (device) => {
  if (!device || !device.thing_model || !Array.isArray(device.thing_model.services)) {
    return [];
  }
  return device.thing_model.services.flatMap((service) =>
    Array.isArray(service && service.properties) ? service.properties : [],
  );
};

export const resolveCloudReadStrategy = (device, deviceType) => {
  const ignoredCloudCodes = getIgnoredCloudCodes(deviceType);
  const status = Array.isArray(device && device.specifications && device.specifications.status)
    ? device.specifications.status
    : [];
  if (
    status.some((entry) => isSupportedCloudCode(entry && entry.code, deviceType, ignoredCloudCodes))
  ) {
    return CLOUD_STRATEGY.LEGACY;
  }
  const thingProperties = getThingModelProperties(device);
  if (
    thingProperties.some((entry) =>
      isSupportedCloudCode(entry && entry.code, deviceType, ignoredCloudCodes),
    )
  ) {
    return CLOUD_STRATEGY.SHADOW;
  }
  return null;
};

const normalizeCloudStrategy = (value) =>
  value === CLOUD_STRATEGY.SHADOW ? CLOUD_STRATEGY.SHADOW : CLOUD_STRATEGY.LEGACY;

export const getConfiguredCloudReadStrategy = (device) =>
  normalizeCloudStrategy(
    getParamValue(device && device.params, DEVICE_PARAM_NAME.CLOUD_READ_STRATEGY),
  );
