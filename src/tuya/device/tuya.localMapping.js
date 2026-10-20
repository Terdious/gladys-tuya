// Ported from server/services/tuya/lib/device/tuya.localMapping.js.

import { convertFeature } from './tuya.convertFeature.js';
import {
  getCloudMapping,
  getDeviceType,
  getLocalMapping,
  getProductIdFromDevice,
  normalizeCode,
} from '../mappings/index.js';
import { DEVICE_PARAM_NAME } from '../constants.js';
import { getParamValue } from '../utils/tuya.deviceParams.js';

const getSubDeviceDpsMap = (device) => {
  const params = (device && device.params) || [];
  if (!getParamValue(params, DEVICE_PARAM_NAME.NODE_ID)) {
    return null;
  }
  const raw = getParamValue(params, DEVICE_PARAM_NAME.DPS_MAP);
  if (!raw) {
    return null;
  }
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
};

export const getLocalDpsFromCode = (code, device) => {
  if (!code) {
    return null;
  }

  const normalized = normalizeCode(code);

  const deviceType = device && device.device_type ? device.device_type : getDeviceType(device);

  // A gateway sub-device (#78) answers on the DP ids its own cloud model
  // declares: they win over the type mapping, which was read on Wi-Fi models.
  const dpsMap = getSubDeviceDpsMap(device);
  if (dpsMap) {
    const dpsOf = (wanted) => {
      const match = Object.keys(dpsMap).find((key) => normalizeCode(key) === wanted);
      return match ? dpsMap[match] : undefined;
    };
    // The model can name a DP after its other spelling: the field motion
    // sensor's model declares DP 1 as `pir_state` while the feature reads
    // `pir`, the temperature sensor `temp_current` for `va_temperature`. The
    // mapping's `duplicateOf` pairs are those spellings, both ways.
    const cloudMapping = getCloudMapping(deviceType, getProductIdFromDevice(device));
    const ownEntry = cloudMapping[normalized];
    const twins = [
      ...(ownEntry && ownEntry.duplicateOf ? [normalizeCode(ownEntry.duplicateOf)] : []),
      ...Object.keys(cloudMapping).filter((key) => {
        const entry = cloudMapping[key];
        return entry && entry.duplicateOf && normalizeCode(entry.duplicateOf) === normalized;
      }),
    ];
    for (const candidate of [normalized, ...twins]) {
      const dps = dpsOf(candidate);
      if (dps !== undefined) {
        return dps;
      }
    }
  }

  const localMapping = getLocalMapping(deviceType, getProductIdFromDevice(device));

  if (localMapping.dps && localMapping.dps[normalized] !== undefined) {
    return localMapping.dps[normalized];
  }

  const aliases = localMapping.codeAliases && localMapping.codeAliases[normalized];
  if (Array.isArray(aliases)) {
    const matchedAlias = aliases
      .map((alias) => normalizeCode(alias))
      .find(
        (aliasCode) => aliasCode && localMapping.dps && localMapping.dps[aliasCode] !== undefined,
      );

    if (matchedAlias) {
      return localMapping.dps[matchedAlias];
    }
  }

  if (localMapping.strict) {
    return null;
  }

  // Generic fallback for devices without a dedicated local mapping: most
  // Tuya switch/socket devices expose `switch`/`power` on DPS 1 and
  // `switch_N` (e.g. `switch_2`) on DPS N. This is a read-only inference
  // used to bootstrap unsupported devices in local mode; dedicated device
  // types should opt out by setting `strict: true` in their local mapping.
  if (normalized === 'switch' || normalized === 'power') {
    return 1;
  }

  const match = normalized.match(/_(\d+)$/);
  if (match) {
    return parseInt(match[1], 10);
  }

  return null;
};

export const hasDpsKey = (dps, key) => {
  if (!dps || typeof dps !== 'object') {
    return false;
  }
  const stringKey = String(key);
  return (
    Object.prototype.hasOwnProperty.call(dps, stringKey) ||
    Object.prototype.hasOwnProperty.call(dps, key)
  );
};

/**
 * @description Add a generic on/off feature to a device discovered locally
 * without any feature, when its DPS map exposes DPS 1.
 * @param {object} device - Gladys device (with external_id and externalIds factory info).
 * @param {object} dps - DPS map returned by a local poll.
 * @param {object} ids - Device external ids factory (gladys.externalIds result).
 * @returns {object} Device, possibly with a fallback switch feature.
 * @example
 * addFallbackBinaryFeature(device, { 1: true }, ids);
 */
export const addFallbackBinaryFeature = (device, dps, ids) => {
  if (!device || !device.external_id) {
    return device;
  }

  const hasFeatures = Array.isArray(device.features) && device.features.length > 0;
  if (hasFeatures || !hasDpsKey(dps, 1)) {
    return device;
  }

  const fallbackFeature = convertFeature(
    {
      code: 'switch_1',
      values: '{}',
      name: 'Switch',
      readOnly: false,
    },
    ids,
    {
      deviceType: device.device_type,
    },
  );

  if (fallbackFeature) {
    device.features = [fallbackFeature];
  }

  return device;
};
