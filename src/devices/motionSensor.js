// -----------------------------------------------------------------------------
// Device type: MOTION SENSOR
// Illustrates a PUSH (event-driven) sensor: there is no polling, the device
// pushes its state whenever it changes. We subscribe once on connection.
// -----------------------------------------------------------------------------

import {
  createLogger,
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
} from '@gladysassistant/integration-sdk';

const DEVICE_TYPE = 'motion-sensor';

const logger = createLogger({ name: DEVICE_TYPE });

// Unique id coming from the external platform (simulated here).
const PLATFORM_DEVICE_ID = 'motion-e2b0f9';

const FEATURE = { MOTION: 'motion' };

export const motionSensor = {
  key: DEVICE_TYPE,

  deviceExternalId(gladys) {
    return gladys.externalIds(DEVICE_TYPE, PLATFORM_DEVICE_ID).device;
  },

  buildDevice(gladys) {
    const ids = gladys.externalIds(DEVICE_TYPE, PLATFORM_DEVICE_ID);
    return {
      name: 'Entrance motion sensor',
      external_id: ids.device,
      features: [
        {
          name: 'Motion',
          external_id: ids.feature(FEATURE.MOTION),
          category: DEVICE_FEATURE_CATEGORIES.MOTION_SENSOR,
          type: DEVICE_FEATURE_TYPES.SENSOR.BINARY,
          read_only: true,
          has_feedback: false,
          keep_history: true,
        },
      ],
    };
  },

  // No onPoll: this sensor is event-driven. We subscribe once on connection and
  // publish the state whenever it changes.
  startPush(gladys) {
    const ids = gladys.externalIds(DEVICE_TYPE, PLATFORM_DEVICE_ID);
    logger.info('Subscribing to the motion stream...');

    // ------------------------------------------------------------------ //
    // DO THE WORK: subscribe to your hardware real-time stream.
    // e.g. mqttClient.on('message', (topic, payload) => {
    //        if (topic === 'entrance/motion') {
    //          gladys.publishState(ids.feature(FEATURE.MOTION),
    //                              payload === 'true' ? 1 : 0);
    //        }
    //      });
    //
    // Here we SIMULATE a detection followed by a clear, every ~60 s.
    // ------------------------------------------------------------------ //
    const interval = setInterval(async () => {
      try {
        logger.info('Motion detected -> 1');
        await gladys.publishState(ids.feature(FEATURE.MOTION), 1);
        // Clear the detection after 10 s.
        setTimeout(() => {
          gladys
            .publishState(ids.feature(FEATURE.MOTION), 0)
            .catch((e) => logger.error('publishState 0 failed', e));
        }, 10_000);
      } catch (e) {
        logger.error('publishState 1 failed', e);
      }
    }, 60_000);

    // Return a cleanup function, called on disconnection.
    return () => clearInterval(interval);
  },
};
