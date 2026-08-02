// -----------------------------------------------------------------------------
// Device type: CAMERA (Tuya smart camera / PTZ camera, category `sp`).
//
// Backport target: the still-open core camera issues (GladysAssistant/Gladys
// #2462, #2463, #2489 — LSC PTZ Camera / Dualband). Codes and local DPS taken
// from the #2463 Dualband fixture (protocol 3.3, where the local DPS index
// equals the cloud DP_ID, so the LAN mapping is 1:1).
//
// Scope — increment 1 (this file): the control-plane toggles that map cleanly
// to a published Gladys feature type (privacy, motion detection, siren, motion
// tracking, humanoid filter, recording, image flip), in cloud AND LAN.
//
// Deferred to later increments (kept in ignoredCodes / ignoredDps below so a
// discovered feature carrying them is never rejected by the core validator):
//   - Camera IMAGE widget: `movement_detect_pic` is a cloud snapshot
//     reference. The plan mirrors gladys-netatmo (src/netatmo/camera.js):
//     fetch the snapshot, fit it under the camera-store budget with jpeg-js
//     (~96 KB, no ffmpeg on the read-only rootfs) and push it through
//     `gladys.publishCameraImage`. Tuya exposes no stable local RTSP/ONVIF
//     (only an unmaintained SSH hack), so — unlike Netatmo — there is no
//     CAMERA_URL live stream: snapshot only.
//   - Enum settings (`basic_nightvision`, `motion_sensitivity`,
//     `decibel_sensitivity`, `record_mode`): no generic selector feature type
//     is published in the Gladys constants yet (same limitation that keeps the
//     AC fan-speed/swing out, see airConditioner.js / issue #17).
//   - PTZ commands (`ptz_control`, `ptz_stop`, `ptz_calibration`): write-only,
//     a better fit for manifest actions than for features.
//   - Motion-detected events (`alarm_message`): arrive as encrypted cloud
//     events (Pulsar), decoded separately — the MOTION_SENSOR feature is fed
//     from the `movement_detect_pic` snapshot event instead (see below).
// -----------------------------------------------------------------------------

import { DEVICE_FEATURE_CATEGORIES, DEVICE_FEATURE_TYPES } from '@gladysassistant/integration-sdk';

// Codes that identify a Tuya smart camera (at least one must be exposed).
const CAMERA_CODES = new Set([
  'basic_private',
  'motion_switch',
  'ptz_control',
  'movement_detect_pic',
  'basic_nightvision',
]);

const cloudMapping = {
  ignoredCodes: [
    // Enum settings — no published selector feature type yet.
    'basic_nightvision',
    'motion_sensitivity',
    'decibel_sensitivity',
    'record_mode',
    // PTZ commands — write-only, future manifest actions.
    'ptz_control',
    'ptz_stop',
    'ptz_calibration',
    // Raw cloud reference — the motion snapshot is encrypted (movement_detect_pic
    // is mapped below to the Motion event; the image itself is a later increment).
    'alarm_message',
    // Strings / integers / one-shot commands with no clean feature type.
    'basic_osd',
    'sd_storge',
    'sd_status',
    'sd_format',
    'sd_format_state',
    'motion_area',
    'motion_area_switch',
    'decibel_switch',
  ],
  basic_private: {
    name: 'Privacy mode',
    category: DEVICE_FEATURE_CATEGORIES.SWITCH,
    type: DEVICE_FEATURE_TYPES.SWITCH.BINARY,
  },
  motion_switch: {
    name: 'Motion detection',
    category: DEVICE_FEATURE_CATEGORIES.SWITCH,
    type: DEVICE_FEATURE_TYPES.SWITCH.BINARY,
  },
  siren_switch: {
    name: 'Siren',
    category: DEVICE_FEATURE_CATEGORIES.SIREN,
    type: DEVICE_FEATURE_TYPES.SIREN.BINARY,
  },
  motion_tracking: {
    name: 'Motion tracking',
    category: DEVICE_FEATURE_CATEGORIES.SWITCH,
    type: DEVICE_FEATURE_TYPES.SWITCH.BINARY,
  },
  humanoid_filter: {
    name: 'Human detection filter',
    category: DEVICE_FEATURE_CATEGORIES.SWITCH,
    type: DEVICE_FEATURE_TYPES.SWITCH.BINARY,
  },
  record_switch: {
    name: 'Recording',
    category: DEVICE_FEATURE_CATEGORIES.SWITCH,
    type: DEVICE_FEATURE_TYPES.SWITCH.BINARY,
  },
  basic_flip: {
    name: 'Image flip',
    category: DEVICE_FEATURE_CATEGORIES.SWITCH,
    type: DEVICE_FEATURE_TYPES.SWITCH.BINARY,
  },
  // Motion detection event: a new movement_detect_pic IS the detection. Exposed
  // as a MOTION_SENSOR (binary): the media handler pulses it 1 -> 0 so every
  // detection is a fresh edge a scene can trigger on, and a motion widget reads
  // it natively. On these PTZ cameras the picture itself is encrypted (skipped
  // until decryption lands).
  movement_detect_pic: {
    name: 'Motion',
    category: DEVICE_FEATURE_CATEGORIES.MOTION_SENSOR,
    type: DEVICE_FEATURE_TYPES.SENSOR.BINARY,
  },
};

// LAN mapping (Dualband fixture, protocol 3.3): the local DPS index equals the
// cloud DP_ID. Strict, so only the exposed codes are read/written locally; the
// remaining DPS (enums, PTZ, SD, raw pictures) are declared ignored.
const localMapping = {
  strict: true,
  ignoredDps: [
    '104', // basic_osd
    '106', // motion_sensitivity
    '108', // basic_nightvision
    '109', // sd_storge
    '110', // sd_status
    '111', // sd_format
    '115', // movement_detect_pic
    '116', // ptz_stop
    '117', // sd_format_state
    '119', // ptz_control
    '132', // ptz_calibration
    '139', // decibel_switch
    '140', // decibel_sensitivity
    '151', // record_mode
    '168', // motion_area_switch
    '169', // motion_area
    '185', // alarm_message
  ],
  codeAliases: {},
  dps: {
    basic_flip: 103,
    basic_private: 105,
    record_switch: 150,
    siren_switch: 159,
    motion_switch: 134,
    motion_tracking: 161,
    humanoid_filter: 170,
  },
};

export const camera = {
  DEVICE_TYPE_NAME: 'camera',
  CATEGORIES: new Set(['sp']),
  PRODUCT_IDS: new Set(['n7h0m2x7i2yzol0p', 'rogprwflblumx2co']),
  KEYWORDS: ['camera', 'caméra', 'ptz', 'ipc'],
  REQUIRED_CODES: CAMERA_CODES,
  CLOUD_MAPPINGS: cloudMapping,
  LOCAL_MAPPINGS: localMapping,
};
