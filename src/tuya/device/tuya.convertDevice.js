// Ported from server/services/tuya/lib/device/tuya.convertDevice.js.
//
// Differences with the core service:
// - external ids are built with the SDK external-ids factory
//   (`gladys.externalIds`), with a constant type segment so ids stay stable;
// - selector generation and service_id assignment are left to the core;
// - poll_frequency is expressed in milliseconds, matching the core
//   DEVICE_POLL_FREQUENCIES constants the discovered-device validator checks
//   against (see POLL_FREQUENCY_LOCAL / POLL_FREQUENCY_CLOUD below);
// - the tuya_report / tuya_mapping debug payloads consumed by the custom UI
//   of the core are not ported.

import { createLogger } from '@gladysassistant/integration-sdk';

import { DEVICE_PARAM_NAME, DEVICE_EXTERNAL_ID_TYPE } from '../constants.js';
import { normalizeBoolean, normalizeTemperatureUnit } from '../utils/tuya.normalize.js';
import { resolveCloudReadStrategy } from '../cloud/tuya.cloudStrategy.js';
import { buildDeviceSelector } from '../utils/tuya.selector.js';
import { convertFeature } from './tuya.convertFeature.js';
import { getDeviceType, getIgnoredCloudCodes, DEVICE_TYPES } from '../mappings/index.js';

const logger = createLogger({ name: 'tuya' });

// Poll frequencies in milliseconds: the core validates discovered devices
// against its DEVICE_POLL_FREQUENCIES list (ms values), so these are exactly
// the core EVERY_10_SECONDS / EVERY_30_SECONDS constants used by the native
// Tuya service.
const POLL_FREQUENCY_LOCAL = 10 * 1000;
const POLL_FREQUENCY_CLOUD = 30 * 1000;

// The real temperature unit of the device (some report Fahrenheit through the
// temp_unit_convert / unit shadow property).
const getTemperatureUnit = (properties) => {
  const currentProperties = Array.isArray(properties && properties.properties)
    ? properties.properties
    : [];
  const unitProperty = currentProperties.find(
    (property) => property && (property.code === 'temp_unit_convert' || property.code === 'unit'),
  );
  return normalizeTemperatureUnit(unitProperty && unitProperty.value);
};

const parseFeatureValues = (values) => {
  if (!values || typeof values !== 'object') {
    if (typeof values === 'string') {
      try {
        const parsed = JSON.parse(values);
        return parsed && typeof parsed === 'object' ? parsed : null;
      } catch {
        return null;
      }
    }
    return null;
  }
  return values;
};

const mergeFeatureValues = (currentValues, nextValues) => {
  const currentParsed = parseFeatureValues(currentValues);
  const nextParsed = parseFeatureValues(nextValues);

  if (currentParsed && nextParsed) {
    // Keep existing keys first, enrich missing metadata from the new source.
    return {
      ...nextParsed,
      ...currentParsed,
    };
  }
  if (currentParsed) {
    return currentParsed;
  }
  if (nextParsed) {
    return nextParsed;
  }
  if (currentValues !== undefined && currentValues !== null) {
    return currentValues;
  }
  if (nextValues !== undefined && nextValues !== null) {
    return nextValues;
  }
  return {};
};

/**
 * @description Transform Tuya device to Gladys device.
 * @param {object} gladys - GladysIntegration SDK instance.
 * @param {object} tuyaDevice - Tuya device.
 * @returns {object} Gladys device.
 * @example
 * convertDevice(gladys, { id: 'tuyaId', name: 'My socket', specifications: {} });
 */
export function convertDevice(gladys, tuyaDevice) {
  const {
    name,
    product_name: productName,
    model,
    product_id: productId,
    product_key: productKey,
    id,
    local_key: localKey,
    ip,
    cloud_ip: cloudIp,
    protocol_version: protocolVersion,
    local_override: localOverride,
    properties,
    thing_model: thingModel,
    specifications = {},
    status: deviceStatus,
    category,
  } = tuyaDevice;
  const ids = gladys.externalIds(DEVICE_EXTERNAL_ID_TYPE, id);
  const externalId = ids.device;
  const { functions = [], status = [] } = specifications;
  const online = tuyaDevice.online !== undefined ? tuyaDevice.online : tuyaDevice.is_online;
  const normalizedLocalOverride = normalizeBoolean(localOverride);

  logger.debug(`Tuya convert device "${name}, ${productName || model}"`);
  const deviceType = getDeviceType({
    specifications,
    status: deviceStatus,
    model,
    product_name: productName,
    product_id: productId,
    name,
    category: specifications.category || category,
    properties,
    thing_model: thingModel,
  });
  const cloudReadStrategy = resolveCloudReadStrategy(tuyaDevice, deviceType);

  const params = [];
  if (id) {
    params.push({ name: DEVICE_PARAM_NAME.DEVICE_ID, value: id });
  }
  if (localKey) {
    params.push({ name: DEVICE_PARAM_NAME.LOCAL_KEY, value: localKey });
  }
  if (ip) {
    params.push({ name: DEVICE_PARAM_NAME.IP_ADDRESS, value: ip });
  }
  if (cloudIp) {
    params.push({ name: DEVICE_PARAM_NAME.CLOUD_IP, value: cloudIp });
  }
  if (localOverride !== undefined && localOverride !== null) {
    params.push({ name: DEVICE_PARAM_NAME.LOCAL_OVERRIDE, value: normalizedLocalOverride });
  }
  if (protocolVersion) {
    params.push({ name: DEVICE_PARAM_NAME.PROTOCOL_VERSION, value: protocolVersion });
  }
  if (productId) {
    params.push({ name: DEVICE_PARAM_NAME.PRODUCT_ID, value: productId });
  }
  if (productKey) {
    params.push({ name: DEVICE_PARAM_NAME.PRODUCT_KEY, value: productKey });
  }
  if (cloudReadStrategy) {
    params.push({ name: DEVICE_PARAM_NAME.CLOUD_READ_STRATEGY, value: cloudReadStrategy });
  }
  if (deviceType && deviceType !== DEVICE_TYPES.UNKNOWN) {
    // The inferred type is re-read at poll/setValue time (scale restore,
    // variant mappings): persist it so a renamed device or an unlisted
    // product id cannot break the re-inference after a DB reload.
    params.push({ name: DEVICE_PARAM_NAME.DEVICE_TYPE, value: deviceType });
  }
  const safeDeviceLog = {
    id,
    name,
    model: productName || model,
    product_id: productId,
    protocol_version: protocolVersion,
    local_override: normalizedLocalOverride,
    online,
  };
  logger.debug('Tuya convert device specifications');
  logger.debug(JSON.stringify(safeDeviceLog));

  // Build features from specifications first, enrich metadata from thing model, then fallback to status/properties.
  const groups = {};
  status.forEach((stat) => {
    const { code } = stat || {};
    if (!code) {
      return;
    }
    const existingGroup = groups[code] || {};
    groups[code] = {
      ...existingGroup,
      ...stat,
      values: mergeFeatureValues(existingGroup.values, stat && stat.values),
      readOnly: true,
    };
  });
  functions.forEach((func) => {
    const { code } = func || {};
    if (!code) {
      return;
    }
    const existingGroup = groups[code] || {};
    groups[code] = {
      ...existingGroup,
      ...func,
      values: mergeFeatureValues(existingGroup.values, func && func.values),
      readOnly: false,
    };
  });
  const services = Array.isArray(thingModel && thingModel.services) ? thingModel.services : [];
  services.forEach((service) => {
    const thingProperties = Array.isArray(service && service.properties) ? service.properties : [];
    thingProperties.forEach((property) => {
      const { code } = property || {};
      if (!code) {
        return;
      }
      const existingGroup = groups[code] || {};
      groups[code] = {
        ...existingGroup,
        code,
        values: mergeFeatureValues(existingGroup.values, property.typeSpec || {}),
        readOnly:
          existingGroup.readOnly !== undefined && existingGroup.readOnly !== null
            ? existingGroup.readOnly
            : property.accessMode !== 'rw',
      };
    });
  });
  const topLevelStatus = Array.isArray(deviceStatus) ? deviceStatus : [];
  topLevelStatus.forEach((entry) => {
    const { code } = entry || {};
    if (!code || groups[code]) {
      return;
    }
    groups[code] = {
      code,
      name: code,
      values: {},
      readOnly: true,
    };
  });
  const currentProperties = Array.isArray(properties && properties.properties)
    ? properties.properties
    : [];
  currentProperties.forEach((property) => {
    const { code } = property || {};
    if (!code || groups[code]) {
      return;
    }
    groups[code] = {
      code,
      name: property.custom_name || property.name || code,
      values: {},
      readOnly: true,
    };
  });

  const deviceSelector = buildDeviceSelector(name, id);
  const ignoredCloudCodes = getIgnoredCloudCodes(deviceType, productId);
  const temperatureUnit = getTemperatureUnit(properties);
  const features = Object.values(groups).map((group) =>
    convertFeature(group, ids, {
      deviceType,
      ignoredCloudCodes,
      deviceSelector,
      temperatureUnit,
      productId,
    }),
  );
  const filteredFeatures = features.filter((feature) => feature);
  if (filteredFeatures.length === 0 && deviceType !== DEVICE_TYPES.UNKNOWN) {
    logger.debug(
      `[Tuya][convertDevice] inferred type=${deviceType} but no supported feature found (device=${
        id || 'unknown'
      } product_id=${productId || 'unknown'} spec_functions=${functions.length} spec_status=${
        status.length
      } list_status=${topLevelStatus.length} shadow_properties=${currentProperties.length} thing_services=${
        services.length
      })`,
    );
  }

  const device = {
    name,
    selector: deviceSelector,
    features: filteredFeatures,
    device_type: deviceType,
    external_id: externalId,
    model: productName || model,
    product_id: productId,
    product_key: productKey,
    poll_frequency: normalizedLocalOverride ? POLL_FREQUENCY_LOCAL : POLL_FREQUENCY_CLOUD,
    should_poll: true,
    params,
  };
  if (online !== undefined) {
    device.online = online;
  }
  return device;
}
