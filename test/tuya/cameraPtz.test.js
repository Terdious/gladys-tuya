import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DEVICE_FEATURE_CATEGORIES, DEVICE_FEATURE_TYPES } from '@gladysassistant/integration-sdk';

import { TuyaHandler } from '../../src/tuya/handler.js';
import { convertDevice } from '../../src/tuya/device/tuya.convertDevice.js';
import { getLocalDpsFromCode } from '../../src/tuya/device/tuya.localMapping.js';
import { CAMERA_MOVE } from '../../src/tuya/device/tuya.deviceMapping.js';
import { DEVICE_TYPES } from '../../src/tuya/mappings/index.js';
import { DEVICE_PARAM_NAME } from '../../src/tuya/constants.js';
import { createFakeGladys } from '../helpers/fakeGladys.js';

// Issue #26: the two LSC PTZ cameras of @GBoulvin, from their 1.25.0
// diagnostics (codes, declared enum ranges).
const enumSpec = (code, range) => ({
  code,
  type: 'Enum',
  values: JSON.stringify({ range }),
});
const bool = (code) => ({ code, type: 'Boolean', values: '{}' });
const CAMERA_FUNCTIONS = [
  bool('basic_flip'),
  bool('basic_osd'),
  bool('basic_private'),
  enumSpec('basic_nightvision', ['0', '1', '2']),
  enumSpec('motion_sensitivity', ['0', '1', '2']),
  enumSpec('decibel_sensitivity', ['0', '1']),
  bool('decibel_switch'),
  bool('motion_switch'),
  bool('motion_tracking'),
  bool('humanoid_filter'),
  bool('record_switch'),
  enumSpec('record_mode', ['1', '2']),
  bool('siren_switch'),
  enumSpec('ptz_control', ['1', '2', '3', '4', '5', '6', '7', '0']),
  bool('ptz_stop'),
  bool('ptz_calibration'),
  bool('sd_format'),
];
const camera = (id, productId, model, extraFunctions = []) => ({
  id,
  name: model,
  product_name: model,
  model,
  product_id: productId,
  local_key: 'lk',
  online: true,
  specifications: {
    category: 'sp',
    functions: [...CAMERA_FUNCTIONS, ...extraFunctions],
    status: [
      ...CAMERA_FUNCTIONS,
      ...extraFunctions,
      { code: 'movement_detect_pic', type: 'Raw', values: '{}' },
      { code: 'sd_status', type: 'Integer', values: '{"min":1,"max":5}' },
      { code: 'sd_storge', type: 'String', values: '{}' },
      { code: 'sd_format_state', type: 'Integer', values: '{"min":-20000,"max":20000}' },
    ],
  },
});
const DUALBAND = camera('cam2', 'rogprwflblumx2co', 'LSC PTZ Camera Dualband');
const ENTRANCE = camera('cam1', 'n7h0m2x7i2yzol0p', 'LSC PTZ Camera', [
  enumSpec('basic_anti_flicker', ['0', '1', '2']),
]);

const byCode = (device) =>
  Object.fromEntries(device.features.map((f) => [f.external_id.split(':').pop(), f]));
const optionLabels = (feature) => feature.supported_options.map(({ label }) => label);

test('#26: the PTZ camera exposes a camera.move feature with its four pan/tilt moves', () => {
  const device = convertDevice(createFakeGladys(), DUALBAND);
  assert.equal(device.device_type, DEVICE_TYPES.CAMERA);
  const ptz = byCode(device).ptz_control;
  assert.equal(ptz.category, DEVICE_FEATURE_CATEGORIES.CAMERA);
  assert.equal(ptz.type, DEVICE_FEATURE_TYPES.CAMERA.MOVE);
  assert.equal(ptz.read_only, false);
  assert.equal(ptz.has_feedback, false);
  assert.deepEqual(
    ptz.supported_options.map(({ value, label }) => [value, label]),
    [
      [CAMERA_MOVE.PAN_LEFT, 'Pan left'],
      [CAMERA_MOVE.PAN_RIGHT, 'Pan right'],
      [CAMERA_MOVE.TILT_UP, 'Tilt up'],
      [CAMERA_MOVE.TILT_DOWN, 'Tilt down'],
    ],
  );
});

test('#26: the enum settings are lists labelled with their meaning', () => {
  const features = byCode(convertDevice(createFakeGladys(), ENTRANCE));
  assert.equal(features.basic_nightvision.type, DEVICE_FEATURE_TYPES.TEXT.SELECT);
  assert.equal(features.basic_nightvision.read_only, false);
  assert.deepEqual(optionLabels(features.basic_nightvision), ['Auto', 'Off', 'On']);
  assert.deepEqual(optionLabels(features.motion_sensitivity), ['Low', 'Medium', 'High']);
  assert.deepEqual(optionLabels(features.decibel_sensitivity), ['Low', 'High']);
  assert.deepEqual(optionLabels(features.record_mode), ['Event', 'Continuous']);
  assert.deepEqual(optionLabels(features.basic_anti_flicker), ['Off', '50 Hz', '60 Hz']);
  assert.equal(features.decibel_switch.type, DEVICE_FEATURE_TYPES.SWITCH.BINARY);
  assert.equal(features.basic_osd.type, DEVICE_FEATURE_TYPES.SWITCH.BINARY);
  // ptz_stop / ptz_calibration / SD housekeeping stay out.
  ['ptz_stop', 'ptz_calibration', 'sd_format', 'sd_status', 'sd_storge'].forEach((code) =>
    assert.equal(features[code], undefined, code),
  );
});

test('#26: on a core older than 4.86.1 the PTZ and list features are skipped, the rest kept', () => {
  const features = byCode(
    convertDevice(createFakeGladys(), DUALBAND, { coreSupportsTextSelect: false }),
  );
  assert.equal(features.ptz_control, undefined);
  assert.equal(features.basic_nightvision, undefined);
  assert.ok(features.basic_private);
  assert.ok(features.decibel_switch);
});

test('#26: the PTZ and settings DPS of the Dualband LAN layout', () => {
  const device = { device_type: DEVICE_TYPES.CAMERA };
  assert.equal(getLocalDpsFromCode('ptz_control', device), 119);
  assert.equal(getLocalDpsFromCode('ptz_stop', device), 116);
  assert.equal(getLocalDpsFromCode('basic_nightvision', device), 108);
  assert.equal(getLocalDpsFromCode('record_mode', device), 151);
});

function createCloudHandler() {
  const fake = createFakeGladys();
  const handler = new TuyaHandler(fake);
  const converted = convertDevice(fake, DUALBAND);
  const device = {
    external_id: converted.external_id,
    device_type: converted.device_type,
    features: converted.features,
    params: [{ name: DEVICE_PARAM_NAME.DEVICE_ID, value: 'cam2' }],
  };
  const commands = [];
  handler.connector = {
    request: async ({ body }) => {
      commands.push(body.commands[0]);
      return { success: true };
    },
  };
  let polls = 0;
  handler.poll = async () => {
    polls += 1;
  };
  handler.feedbackPollDelayMs = 0;
  const feature = (code) => device.features.find((f) => f.external_id.endsWith(`:${code}`));
  return { handler, device, commands, feature, getPolls: () => polls };
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('#26: a move sends the Tuya direction, STOP sends ptz_stop, no feedback poll', async () => {
  const { handler, device, commands, feature, getPolls } = createCloudHandler();
  handler.ptzWatchdogMs = 10000;
  await handler.setValue(device, feature('ptz_control'), CAMERA_MOVE.PAN_LEFT);
  await handler.setValue(device, feature('ptz_control'), CAMERA_MOVE.STOP);
  await handler.setValue(device, feature('ptz_control'), CAMERA_MOVE.TILT_UP);
  await handler.setValue(device, feature('ptz_control'), CAMERA_MOVE.STOP);
  assert.deepEqual(commands, [
    { code: 'ptz_control', value: '6' },
    { code: 'ptz_stop', value: true },
    { code: 'ptz_control', value: '0' },
    { code: 'ptz_stop', value: true },
  ]);
  await wait(10);
  assert.equal(getPolls(), 0);
});

test('#26: a move without stop is stopped by the watchdog (spec safety rule)', async () => {
  const { handler, device, commands, feature } = createCloudHandler();
  handler.ptzWatchdogMs = 20;
  await handler.setValue(device, feature('ptz_control'), CAMERA_MOVE.PAN_RIGHT);
  // A new move replaces the running one and its watchdog: a single stop.
  await handler.setValue(device, feature('ptz_control'), CAMERA_MOVE.TILT_DOWN);
  await wait(60);
  assert.deepEqual(commands, [
    { code: 'ptz_control', value: '2' },
    { code: 'ptz_control', value: '4' },
    { code: 'ptz_stop', value: true },
  ]);
});

test('#26: a move the camera cannot do (zoom) is refused', async () => {
  const { handler, device, commands, feature } = createCloudHandler();
  await assert.rejects(
    handler.setValue(device, feature('ptz_control'), CAMERA_MOVE.ZOOM_IN),
    /not supported/,
  );
  assert.deepEqual(commands, []);
});

test('#26: a setting list writes the raw value the camera declares', async () => {
  const { handler, device, commands, feature } = createCloudHandler();
  await handler.setValue(device, feature('basic_nightvision'), '2');
  assert.deepEqual(commands, [{ code: 'basic_nightvision', value: '2' }]);
});
