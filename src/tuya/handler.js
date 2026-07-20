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
import { poll } from './tuya.poll.js';
import { setValue } from './tuya.setValue.js';
import { getStatus } from './tuya.getStatus.js';
import { disconnect } from './tuya.disconnect.js';
import { manualDisconnect } from './tuya.manualDisconnect.js';
import { localPoll } from './local/tuya.localPoll.js';
import { localScan } from './local/tuya.localScan.js';
import { detectProtocol } from './local/tuya.detectProtocol.js';
import {
  tryReconnect,
  scheduleQuickReconnects,
  clearQuickReconnects,
  startReconnect,
  stopReconnect,
} from './tuya.reconnect.js';

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
    this.manualDisconnectEnabled = false;
    this.autoReconnectAllowed = false;
    this.lastConnectedConfigHash = null;

    // Last emitted value per feature external_id (poll same-value throttling).
    this.featureStates = new Map();
    // Per-device local health / circuit breaker (see tuya.localCircuit.js).
    this.localCircuit = new Map();
    // Last published transport badge per device external_id (publish on change).
    this.lastTransports = new Map();
    // In-flight publishState promises of the current poll cycle.
    this.pendingStates = [];

    // Reconnect manager state.
    this.reconnectInterval = null;
    this.quickReconnectTimeouts = [];
    this.quickReconnectInProgress = false;

    // Injected so tests can substitute the local (LAN) API classes.
    this.localApiClasses = null;
  }
}

TuyaHandler.prototype.connect = connect;
TuyaHandler.prototype.setTokens = setTokens;
TuyaHandler.prototype.getAccessToken = getAccessToken;
TuyaHandler.prototype.getRefreshToken = getRefreshToken;
TuyaHandler.prototype.discoverDevices = discoverDevices;
TuyaHandler.prototype.loadDevices = loadDevices;
TuyaHandler.prototype.loadDeviceDetails = loadDeviceDetails;
TuyaHandler.prototype.poll = poll;
TuyaHandler.prototype.setValue = setValue;
TuyaHandler.prototype.getStatus = getStatus;
TuyaHandler.prototype.disconnect = disconnect;
TuyaHandler.prototype.manualDisconnect = manualDisconnect;
TuyaHandler.prototype.localPoll = localPoll;
TuyaHandler.prototype.localScan = localScan;
TuyaHandler.prototype.detectProtocol = detectProtocol;
TuyaHandler.prototype.tryReconnect = tryReconnect;
TuyaHandler.prototype.scheduleQuickReconnects = scheduleQuickReconnects;
TuyaHandler.prototype.clearQuickReconnects = clearQuickReconnects;
TuyaHandler.prototype.startReconnect = startReconnect;
TuyaHandler.prototype.stopReconnect = stopReconnect;
