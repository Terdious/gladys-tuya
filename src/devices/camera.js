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
//   - (Done in 1.26.0, issue #26: the enum settings as TEXT/SELECT lists and
//     PTZ as a `camera.move` feature, from two LSC diagnostics.)
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

// A writable camera setting shown as a list (TEXT/SELECT).
const cameraSetting = (name, selectLabels) => ({
  name,
  category: DEVICE_FEATURE_CATEGORIES.TEXT,
  type: DEVICE_FEATURE_TYPES.TEXT.SELECT,
  keep_history: false,
  selectOptionsFromRange: true,
  selectLabels,
});

const cloudMapping = {
  ignoredCodes: [
    // PTZ: `ptz_control` is the `move` feature below; `ptz_stop` is sent by
    // it (stop / watchdog), never a feature of its own. The calibration is a
    // one-shot maintenance command, kept in the Tuya app.
    'ptz_stop',
    'ptz_calibration',
    // Raw cloud reference — the motion snapshot is encrypted (movement_detect_pic
    // is mapped below to the Motion event; the image itself is a later increment).
    'alarm_message',
    // Strings / integers / one-shot commands with no clean feature type.
    'sd_storge',
    'sd_status',
    'sd_format',
    'sd_format_state',
    'motion_area',
    'motion_area_switch',
    // Push-message toggle of the Tuya app itself.
    'initiative_message',
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
  basic_osd: {
    name: 'Timestamp overlay',
    category: DEVICE_FEATURE_CATEGORIES.SWITCH,
    type: DEVICE_FEATURE_TYPES.SWITCH.BINARY,
  },
  decibel_switch: {
    name: 'Sound detection',
    category: DEVICE_FEATURE_CATEGORIES.SWITCH,
    type: DEVICE_FEATURE_TYPES.SWITCH.BINARY,
  },
  // Enum settings (issue #26): writable TEXT/SELECT lists (Gladys >= 4.86.1)
  // whose options are the values the camera declares, labelled with the
  // standard `sp` meaning of each value.
  basic_nightvision: cameraSetting('Night vision', { 0: 'Auto', 1: 'Off', 2: 'On' }),
  motion_sensitivity: cameraSetting('Motion sensitivity', { 0: 'Low', 1: 'Medium', 2: 'High' }),
  decibel_sensitivity: cameraSetting('Sound sensitivity', { 0: 'Low', 1: 'High' }),
  record_mode: cameraSetting('Recording mode', { 1: 'Event', 2: 'Continuous' }),
  basic_anti_flicker: cameraSetting('Anti-flicker', { 0: 'Off', 1: '50 Hz', 2: '60 Hz' }),
  // PTZ (issue #26): one `camera.move` command feature (Gladys >= 4.86.0),
  // its options the pan/tilt moves of the declared ptz_control range. The
  // write path (tuya.setValue.js) sends ptz_control, then ptz_stop on STOP or
  // after the watchdog.
  ptz_control: {
    name: 'Pan / tilt',
    category: DEVICE_FEATURE_CATEGORIES.CAMERA,
    type: DEVICE_FEATURE_TYPES.CAMERA.MOVE,
    read_only: false,
    has_feedback: false,
    keep_history: false,
    min: 0,
    max: 6,
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
    '109', // sd_storge
    '110', // sd_status
    '111', // sd_format
    '115', // movement_detect_pic
    '117', // sd_format_state
    '132', // ptz_calibration
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
    basic_osd: 104,
    motion_sensitivity: 106,
    basic_nightvision: 108,
    ptz_stop: 116,
    ptz_control: 119,
    decibel_switch: 139,
    decibel_sensitivity: 140,
    record_mode: 151,
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
