// Ported from server/services/tuya/lib/tuya.loadDeviceDetails.js.
//
// The `tuya_report` payload of the core service (a raw dump of the cloud
// responses consumed by the custom setup UI of the core) is not ported: the
// external integration has no custom UI to display it.

import { createLogger } from '@gladysassistant/integration-sdk';

import { API } from '../constants.js';

const logger = createLogger({ name: 'tuya' });

/**
 * @description Load Tuya device details (specification, details, shadow
 * properties and thing model), merged onto the device list entry.
 * @param {object} tuyaDevice - Tuya device (list entry).
 * @returns {Promise<object>} Device with details.
 * @example
 * await handler.loadDeviceDetails({ id: 'tuyaId' });
 */
export async function loadDeviceDetails(tuyaDevice) {
  const { id: deviceId } = tuyaDevice;
  logger.debug(`Loading ${deviceId} Tuya device specifications`);

  const [specResult, detailsResult, propsResult, modelResult] = await Promise.allSettled([
    this.connector.request({
      method: 'GET',
      path: `${API.VERSION_1_2}/devices/${deviceId}/specification`,
    }),
    this.connector.request({
      method: 'GET',
      path: `${API.VERSION_1_0}/devices/${deviceId}`,
    }),
    this.connector.request({
      method: 'GET',
      path: `${API.VERSION_2_0}/thing/${deviceId}/shadow/properties`,
    }),
    this.connector.request({
      method: 'GET',
      path: `${API.VERSION_2_0}/thing/${deviceId}/model`,
    }),
  ]);

  if (specResult.status === 'rejected') {
    const reason =
      specResult.reason && specResult.reason.message
        ? specResult.reason.message
        : specResult.reason;
    logger.warn(`[Tuya] Failed to load specifications for ${deviceId}: ${reason}`);
  }
  if (detailsResult.status === 'rejected') {
    const reason =
      detailsResult.reason && detailsResult.reason.message
        ? detailsResult.reason.message
        : detailsResult.reason;
    logger.warn(`[Tuya] Failed to load details for ${deviceId}: ${reason}`);
  }
  if (propsResult.status === 'rejected') {
    const reason =
      propsResult.reason && propsResult.reason.message
        ? propsResult.reason.message
        : propsResult.reason;
    logger.warn(`[Tuya] Failed to load properties for ${deviceId}: ${reason}`);
  }
  if (modelResult.status === 'rejected') {
    const reason =
      modelResult.reason && modelResult.reason.message
        ? modelResult.reason.message
        : modelResult.reason;
    logger.warn(`[Tuya] Failed to load thing model for ${deviceId}: ${reason}`);
  }

  const specifications =
    specResult.status === 'fulfilled' ? (specResult.value && specResult.value.result) || {} : {};
  const details =
    detailsResult.status === 'fulfilled'
      ? (detailsResult.value && detailsResult.value.result) || {}
      : {};
  const properties =
    propsResult.status === 'fulfilled' ? (propsResult.value && propsResult.value.result) || {} : {};
  const modelPayload =
    modelResult.status === 'fulfilled'
      ? (modelResult.value && modelResult.value.result) || null
      : null;
  const rawModel =
    modelPayload && Object.prototype.hasOwnProperty.call(modelPayload, 'model')
      ? modelPayload.model
      : modelPayload;
  let thingModel = null;
  if (typeof rawModel === 'string') {
    try {
      thingModel = JSON.parse(rawModel);
    } catch (e) {
      logger.warn(`[Tuya] Invalid thing model JSON for ${deviceId}`, e);
      thingModel = null;
    }
  } else if (rawModel && typeof rawModel === 'object') {
    thingModel = rawModel;
  }

  const category = details.category || tuyaDevice.category;
  const specificationsWithCategory =
    category && !specifications.category ? { ...specifications, category } : specifications;

  return {
    ...tuyaDevice,
    ...details,
    specifications: specificationsWithCategory,
    properties,
    thing_model: thingModel,
  };
}
