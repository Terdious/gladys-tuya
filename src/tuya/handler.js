// -----------------------------------------------------------------------------
// Tuya handler: holds the connection state and wires the ported modules,
// mirroring server/services/tuya/lib/index.js of the Gladys core service.
//
// State kept in memory (the core service stored it in the Gladys variable
// store, which does not exist for an external integration):
// - tokens: Tuya cloud tokens (renegotiated at every start);
// - manualDisconnect: true after an explicit disconnect;
// - lastConnectedConfigHash: hash of the last successfully connected config.
// -----------------------------------------------------------------------------

import { TuyaContext } from '@tuya/tuya-connector-nodejs';

import { STATUS } from './constants.js';
import { connect } from './cloud/tuya.connect.js';
import { setTokens } from './cloud/tuya.setTokens.js';
import { getAccessToken } from './cloud/tuya.getAccessToken.js';
import { getRefreshToken } from './cloud/tuya.getRefreshToken.js';
import { discoverDevices } from './cloud/tuya.discoverDevices.js';
import { loadDevices } from './cloud/tuya.loadDevices.js';
import { loadDeviceDetails } from './cloud/tuya.loadDeviceDetails.js';

export class TuyaHandler {
  /**
   * @param {object} gladys - GladysIntegration SDK instance.
   */
  constructor(gladys) {
    this.gladys = gladys;

    // Injected so tests can substitute a fake Tuya cloud context.
    this.TuyaContext = TuyaContext;

    this.connector = null;
    this.status = STATUS.NOT_INITIALIZED;
    this.lastError = null;
    this.config = null;
    this.tokens = {};
    this.discoveredDevices = [];
    this.manualDisconnect = false;
    this.autoReconnectAllowed = false;
    this.lastConnectedConfigHash = null;
  }
}

TuyaHandler.prototype.connect = connect;
TuyaHandler.prototype.setTokens = setTokens;
TuyaHandler.prototype.getAccessToken = getAccessToken;
TuyaHandler.prototype.getRefreshToken = getRefreshToken;
TuyaHandler.prototype.discoverDevices = discoverDevices;
TuyaHandler.prototype.loadDevices = loadDevices;
TuyaHandler.prototype.loadDeviceDetails = loadDeviceDetails;
