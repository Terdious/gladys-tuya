// -----------------------------------------------------------------------------
// Device type: SMART PLUG
// Illustrates a MIXED device: a binary actuator (relay) AND a read-only
// measurement (instantaneous power). It is both controlled and polled.
// -----------------------------------------------------------------------------

import {
  createLogger,
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';

const DEVICE_TYPE = 'plug';

const logger = createLogger({ name: DEVICE_TYPE });

// Unique id coming from the external platform (simulated here).
const PLATFORM_DEVICE_ID = 'plug-77c1ab';

const FEATURE = {
  ON_OFF: 'on-off',
  POWER: 'power',
};

// In-memory reflection of the real device state.
let isOn = false;

export const plug = {
  key: DEVICE_TYPE,

  deviceExternalId(gladys) {
    return gladys.externalIds(DEVICE_TYPE, PLATFORM_DEVICE_ID).device;
  },

  buildDevice(gladys, config) {
    const ids = gladys.externalIds(DEVICE_TYPE, PLATFORM_DEVICE_ID);
    return {
      name: 'Office plug',
      external_id: ids.device,
      poll_frequency: config.poll_frequency, // to refresh the power reading
      features: [
        {
          name: 'On/Off',
          external_id: ids.feature(FEATURE.ON_OFF),
          category: DEVICE_FEATURE_CATEGORIES.SWITCH,
          type: DEVICE_FEATURE_TYPES.SWITCH.BINARY,
          read_only: false,
          has_feedback: true,
          keep_history: true,
        },
        {
          name: 'Instantaneous power',
          external_id: ids.feature(FEATURE.POWER),
          category: DEVICE_FEATURE_CATEGORIES.ENERGY_SENSOR,
          type: DEVICE_FEATURE_TYPES.ENERGY_SENSOR.POWER,
          unit: DEVICE_FEATURE_UNITS.WATT,
          min: 0,
          max: 3680,
          read_only: true, // measurement: not controllable
          has_feedback: false,
          keep_history: true,
        },
      ],
    };
  },

  async onSetValue(gladys, { feature, value }) {
    const on = value === 1;
    logger.info(`Relay command: ${on ? 'ON' : 'OFF'}`);
    // ------------------------------------------------------------------ //
    // DO THE WORK: toggle the plug relay.
    // ------------------------------------------------------------------ //
    isOn = on;
    await gladys.publishState(feature.external_id, on ? 1 : 0);
  },

  async onPoll(gladys) {
    const ids = gladys.externalIds(DEVICE_TYPE, PLATFORM_DEVICE_ID);
    // ------------------------------------------------------------------ //
    // DO THE WORK: read the instantaneous power measured by the plug.
    // Here we simulate it: 0 W when off, ~120 W (+ noise) when on.
    // ------------------------------------------------------------------ //
    const power = isOn ? Math.round(120 + Math.random() * 15) : 0;
    logger.info(`Measured power: ${power} W`);
    await gladys.publishState(ids.feature(FEATURE.POWER), power);
  },
};
