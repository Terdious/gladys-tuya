// -----------------------------------------------------------------------------
// Device type inference and mapping lookups, ported from
// server/services/tuya/lib/mappings/index.js.
//
// The per-type definitions live in src/devices/ (one file per device type).
// -----------------------------------------------------------------------------

import {
  DEVICE_TYPE_DEFINITIONS,
  globalCloudMapping,
  globalLocalMapping,
} from '../../devices/index.js';
import { DEVICE_PARAM_NAME } from '../constants.js';

export const DEVICE_TYPES = {
  AIR_CONDITIONER: 'air-conditioner',
  PILOT_THERMOSTAT: 'pilot-thermostat',
  SMART_METER: 'smart-meter',
  SMART_SOCKET: 'smart-socket',
  UNKNOWN: 'unknown',
};

export const normalizeCode = (code) => {
  if (!code) {
    return null;
  }
  return String(code).trim().toLowerCase();
};

const normalizeStringSet = (setLike) =>
  new Set(
    Array.from(setLike || [])
      .map((value) => normalizeCode(value))
      .filter((value) => Boolean(value)),
  );

const DEVICE_TYPE_INDEX = DEVICE_TYPE_DEFINITIONS.reduce((acc, definition) => {
  const typeName = normalizeCode(definition && definition.DEVICE_TYPE_NAME);
  acc[typeName] = {
    ...definition,
    CATEGORIES: normalizeStringSet(definition.CATEGORIES),
    PRODUCT_IDS: normalizeStringSet(definition.PRODUCT_IDS),
    KEYWORDS: Array.isArray(definition.KEYWORDS)
      ? definition.KEYWORDS.map((keyword) => String(keyword).toLowerCase())
      : [],
    REQUIRED_CODES: normalizeStringSet(definition.REQUIRED_CODES),
    VARIANTS: (Array.isArray(definition.VARIANTS) ? definition.VARIANTS : []).map((variant) => ({
      ...variant,
      PRODUCT_IDS: normalizeStringSet(variant.PRODUCT_IDS),
    })),
  };
  return acc;
}, {});

// A per-product variant of a device family (e.g. the Konyks eCosy pilot
// thermostat): its mappings fully replace the family default ones.
const getVariantDefinition = (deviceType, productId) => {
  const normalizedProductId = normalizeCode(productId);
  if (!normalizedProductId) {
    return null;
  }
  const definition = DEVICE_TYPE_INDEX[normalizeCode(deviceType)];
  if (!definition) {
    return null;
  }
  return (
    definition.VARIANTS.find((variant) => variant.PRODUCT_IDS.has(normalizedProductId)) || null
  );
};

export const getProductIdFromDevice = (device) => {
  if (!device || typeof device !== 'object') {
    return null;
  }
  if (device.product_id) {
    return device.product_id;
  }
  // Devices loaded from the Gladys DB only carry the product id as a param.
  const params = Array.isArray(device.params) ? device.params : [];
  const productIdParam = params.find(
    (param) => param && param.name === DEVICE_PARAM_NAME.PRODUCT_ID,
  );
  return productIdParam && productIdParam.value ? productIdParam.value : null;
};

const matchDeviceType = (typeDefinition, context) => {
  const { category, productId, modelName, codes } = context;
  if (productId && typeDefinition.PRODUCT_IDS.has(productId)) {
    return true;
  }
  if (productId && typeDefinition.VARIANTS.some((variant) => variant.PRODUCT_IDS.has(productId))) {
    return true;
  }

  const requiredCodes = typeDefinition.REQUIRED_CODES;
  const keywords = typeDefinition.KEYWORDS;
  const hasRequiredCode =
    requiredCodes.size === 0 || Array.from(requiredCodes).some((code) => codes.has(code));

  if (category && typeDefinition.CATEGORIES.has(category) && hasRequiredCode) {
    return true;
  }

  if (!hasRequiredCode || !modelName || keywords.length === 0) {
    return false;
  }

  return keywords.some((keyword) => modelName.includes(keyword));
};

export const getCloudMapping = (deviceType, productId) => {
  if (!deviceType || deviceType === DEVICE_TYPES.UNKNOWN) {
    return { ...globalCloudMapping };
  }
  const variant = getVariantDefinition(deviceType, productId);
  if (variant && variant.CLOUD_MAPPINGS) {
    return { ...variant.CLOUD_MAPPINGS };
  }
  const definition = DEVICE_TYPE_INDEX[normalizeCode(deviceType)];
  if (definition && definition.CLOUD_MAPPINGS) {
    return { ...definition.CLOUD_MAPPINGS };
  }
  return { ...globalCloudMapping };
};

export const getLocalMapping = (deviceType, productId) => {
  const normalizeLocalMapping = (mapping) => {
    const current = mapping && typeof mapping === 'object' ? mapping : {};
    return {
      strict: current.strict === true,
      codeAliases: { ...(current.codeAliases || {}) },
      dps: { ...(current.dps || {}) },
      ignoredDps: Array.from(
        new Set(
          (Array.isArray(current.ignoredDps) ? current.ignoredDps : []).map((value) =>
            String(value),
          ),
        ),
      ),
    };
  };

  if (!deviceType || deviceType === DEVICE_TYPES.UNKNOWN) {
    return normalizeLocalMapping(globalLocalMapping);
  }
  const variant = getVariantDefinition(deviceType, productId);
  if (variant && variant.LOCAL_MAPPINGS) {
    return normalizeLocalMapping(variant.LOCAL_MAPPINGS);
  }
  const definition = DEVICE_TYPE_INDEX[normalizeCode(deviceType)];
  if (definition && definition.LOCAL_MAPPINGS) {
    return normalizeLocalMapping(definition.LOCAL_MAPPINGS);
  }
  return normalizeLocalMapping(globalLocalMapping);
};

export const getIgnoredLocalDps = (deviceType, productId) => {
  const { ignoredDps } = getLocalMapping(deviceType, productId);
  return Array.isArray(ignoredDps) ? ignoredDps : [];
};

export const extractCodesFromSpecifications = (specifications) => {
  const codes = new Set();
  if (!specifications || typeof specifications !== 'object') {
    return codes;
  }
  const functions = Array.isArray(specifications.functions) ? specifications.functions : [];
  const status = Array.isArray(specifications.status) ? specifications.status : [];
  const properties = Array.isArray(specifications.properties) ? specifications.properties : [];

  [...functions, ...status, ...properties].forEach((item) => {
    if (!item || !item.code) {
      return;
    }
    codes.add(normalizeCode(item.code));
  });

  return codes;
};

export const extractCodesFromFeatures = (features) => {
  const codes = new Set();
  if (!Array.isArray(features)) {
    return codes;
  }

  features.forEach((feature) => {
    if (!feature || !feature.external_id) {
      return;
    }
    const parts = String(feature.external_id).split(':');
    if (parts.length >= 2) {
      const code = normalizeCode(parts[parts.length - 1]);
      if (code) {
        codes.add(code);
      }
    }
  });

  return codes;
};

const extractCodesFromThingModel = (thingModel) => {
  const codes = new Set();
  const services = Array.isArray(thingModel && thingModel.services) ? thingModel.services : [];

  services.forEach((service) => {
    const properties = Array.isArray(service && service.properties) ? service.properties : [];
    properties.forEach((property) => {
      if (!property || !property.code) {
        return;
      }
      codes.add(normalizeCode(property.code));
    });
  });

  return codes;
};

const extractCodesFromProperties = (propertiesPayload) => {
  const codes = new Set();
  let properties = [];
  if (Array.isArray(propertiesPayload)) {
    properties = propertiesPayload;
  } else if (Array.isArray(propertiesPayload && propertiesPayload.properties)) {
    properties = propertiesPayload.properties;
  }

  properties.forEach((property) => {
    if (!property || !property.code) {
      return;
    }
    codes.add(normalizeCode(property.code));
  });

  return codes;
};

export const extractCodesFromStatusList = (statusList) => {
  const codes = new Set();
  if (!Array.isArray(statusList)) {
    return codes;
  }

  statusList.forEach((entry) => {
    if (!entry || !entry.code) {
      return;
    }
    codes.add(normalizeCode(entry.code));
  });

  return codes;
};

export const getDeviceType = (device) => {
  if (!device || typeof device !== 'object') {
    return DEVICE_TYPES.UNKNOWN;
  }

  const specifications = device.specifications || {};
  const codes = new Set([
    ...extractCodesFromSpecifications(specifications),
    ...extractCodesFromThingModel(device.thing_model),
    ...extractCodesFromProperties(device.properties),
    ...extractCodesFromStatusList(device.status),
    ...extractCodesFromFeatures(device.features),
  ]);

  const modelName = [device.model, device.product_name, device.name]
    .filter((value) => typeof value === 'string' && value.length > 0)
    .join(' ')
    .toLowerCase();
  const category = normalizeCode(specifications.category || device.category);
  // The product id may only live in the PRODUCT_ID param on a device loaded
  // back from the Gladys DB.
  const productId = normalizeCode(getProductIdFromDevice(device));
  const context = {
    codes,
    modelName,
    category,
    productId,
  };

  const matchedType = Object.values(DEVICE_TYPE_INDEX).find((typeDefinition) =>
    matchDeviceType(typeDefinition, context),
  );
  if (matchedType && matchedType.DEVICE_TYPE_NAME) {
    return matchedType.DEVICE_TYPE_NAME;
  }

  return DEVICE_TYPES.UNKNOWN;
};

export const getFeatureMapping = (code, deviceType, productId) => {
  const normalized = normalizeCode(code);
  if (!normalized) {
    return null;
  }
  const mapping = getCloudMapping(deviceType, productId);
  const candidate = mapping[normalized];

  if (!candidate || typeof candidate !== 'object') {
    return null;
  }
  if (!candidate.category || !candidate.type) {
    return null;
  }

  return candidate;
};

export const getIgnoredCloudCodes = (deviceType, productId) => {
  const mapping = getCloudMapping(deviceType, productId);
  const ignored = Array.isArray(mapping.ignoredCodes) ? mapping.ignoredCodes : [];
  const normalized = ignored
    .filter((value) => value !== null && value !== undefined)
    .map((value) => String(value).toLowerCase());

  return Array.from(new Set(normalized));
};
