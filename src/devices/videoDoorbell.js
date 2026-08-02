// -----------------------------------------------------------------------------
// Device type: VIDEO DOORBELL (Tuya Wifi video doorbell, category `sp`).
//
// Backport target: the still-open core doorbell issues (GladysAssistant/Gladys
// #2461, #2493). Codes/DPS from the real i5e3a4qxcsthszin doorbell diagnostics.
//
// A doorbell shares the `sp` camera category, so this type is matched BEFORE
// `camera` (it requires `doorbell_active`, which a plain camera never exposes).
// It carries the doorbell essentials:
//   - the RING (DOORBELL/RING, fired as a 1 -> 0 pulse from a new ring snapshot
//     by the media handler — the ring DP itself never reports a value on the
//     observed device; requires Gladys core >= 4.84.2 / SDK >= 0.10.0);
//   - the SNAPSHOT (CAMERA/IMAGE, fed by the media handler through
//     publishCameraImage from `doorbell_pic`);
//   - motion detection, recording, status LED, image flip, on-screen display.
//
// The media codes (`doorbell_pic`, `movement_detect_pic`) are handled by
// src/tuya/media/tuya.media.js, not by the normal read pipeline: `doorbell_pic`
// is mapped to the CAMERA/IMAGE feature so the feature exists, and its raw value
// is never published as a state (a camera feature has no reader).
// -----------------------------------------------------------------------------

import { DEVICE_FEATURE_CATEGORIES, DEVICE_FEATURE_TYPES } from '@gladysassistant/integration-sdk';

const DOORBELL_CODES = new Set(['doorbell_active']);

const cloudMapping = {
  ignoredCodes: [
    // Enum settings — no published selector feature type yet.
    'basic_nightvision',
    'motion_sensitivity',
    'record_mode',
    'decibel_sensitivity',
    // Not exposed in this first increment.
    'basic_device_volume',
    'basic_anti_flicker',
    'initiative_message',
    'fault',
    'sd_storge',
    'sd_status',
    'sd_format',
    'sd_format_state',
    'motion_area',
    'motion_area_switch',
    'decibel_switch',
    'humanoid_filter',
    'motion_tracking',
    'siren_switch',
    'ptz_control',
    'ptz_stop',
    'ptz_calibration',
  ],
  // First-class doorbell ring (core 4.84.2+): the media handler pulses it
  // 1 -> 0 so every ring is a fresh edge (dedicated scene trigger + dashboard
  // "Ringing" badge in the core).
  doorbell_active: {
    name: 'Doorbell',
    category: DEVICE_FEATURE_CATEGORIES.DOORBELL,
    type: DEVICE_FEATURE_TYPES.DOORBELL.RING,
  },
  doorbell_pic: {
    name: 'Snapshot',
    category: DEVICE_FEATURE_CATEGORIES.CAMERA,
    type: DEVICE_FEATURE_TYPES.CAMERA.IMAGE,
  },
  // Motion detection event: a new movement_detect_pic IS the detection. Exposed
  // as a MOTION_SENSOR (binary): the media handler pulses it 1 -> 0 so every
  // detection is a fresh edge a scene can trigger on, and a motion widget reads
  // it natively. The image itself stays encrypted for now.
  movement_detect_pic: {
    name: 'Motion',
    category: DEVICE_FEATURE_CATEGORIES.MOTION_SENSOR,
    type: DEVICE_FEATURE_TYPES.SENSOR.BINARY,
  },
  motion_switch: {
    name: 'Motion detection',
    category: DEVICE_FEATURE_CATEGORIES.SWITCH,
    type: DEVICE_FEATURE_TYPES.SWITCH.BINARY,
  },
  record_switch: {
    name: 'Recording',
    category: DEVICE_FEATURE_CATEGORIES.SWITCH,
    type: DEVICE_FEATURE_TYPES.SWITCH.BINARY,
  },
  basic_indicator: {
    name: 'Status LED',
    category: DEVICE_FEATURE_CATEGORIES.SWITCH,
    type: DEVICE_FEATURE_TYPES.SWITCH.BINARY,
  },
  basic_flip: {
    name: 'Image flip',
    category: DEVICE_FEATURE_CATEGORIES.SWITCH,
    type: DEVICE_FEATURE_TYPES.SWITCH.BINARY,
  },
  basic_osd: {
    name: 'On-screen display',
    category: DEVICE_FEATURE_CATEGORIES.SWITCH,
    type: DEVICE_FEATURE_TYPES.SWITCH.BINARY,
  },
};

// LAN mapping (strict): the media DPs (115 movement_detect_pic, 154
// doorbell_pic) are handled by the media handler, not read as normal DPS.
const localMapping = {
  strict: true,
  ignoredDps: [
    '106', // motion_sensitivity
    '108', // basic_nightvision
    '109', // sd_storge
    '110', // sd_status
    '111', // sd_format
    '115', // movement_detect_pic (media handler)
    '116', // ptz_stop
    '117', // sd_format_state
    '119', // ptz_control
    '132', // ptz_calibration
    '139', // decibel_switch
    '140', // decibel_sensitivity
    '151', // record_mode
    '154', // doorbell_pic (media handler)
    '159', // siren_switch
    '160', // basic_device_volume
    '161', // motion_tracking
    '168', // motion_area_switch
    '169', // motion_area
    '170', // humanoid_filter
    '185', // alarm_message
  ],
  codeAliases: {},
  dps: {
    basic_indicator: 101,
    basic_flip: 103,
    basic_osd: 104,
    motion_switch: 134,
    doorbell_active: 136,
    record_switch: 150,
  },
};

export const videoDoorbell = {
  DEVICE_TYPE_NAME: 'video-doorbell',
  CATEGORIES: new Set(['sp']),
  PRODUCT_IDS: new Set(['i5e3a4qxcsthszin']),
  KEYWORDS: ['doorbell', 'visiophone', 'sonnette'],
  REQUIRED_CODES: DOORBELL_CODES,
  CLOUD_MAPPINGS: cloudMapping,
  LOCAL_MAPPINGS: localMapping,
};
