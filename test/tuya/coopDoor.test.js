import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DEVICE_FEATURE_CATEGORIES, DEVICE_FEATURE_TYPES } from '@gladysassistant/integration-sdk';

import { TuyaHandler } from '../../src/tuya/handler.js';
import { convertDevice } from '../../src/tuya/device/tuya.convertDevice.js';
import { COVER_STATE } from '../../src/tuya/device/tuya.deviceMapping.js';
import { getDeviceType, DEVICE_TYPES } from '../../src/tuya/mappings/index.js';
import { DEVICE_PARAM_NAME } from '../../src/tuya/constants.js';
import { createFakeGladys } from '../helpers/fakeGladys.js';

// The "Chicken Coop Door 2" of @elfedagger (forum), from its 1.31.2
// diagnostic: a thing model only, category `qt`.
const bool = (code, accessMode = 'rw') => ({ code, accessMode, typeSpec: { type: 'bool' } });
const value = (code, max, unit, accessMode = 'ro') => ({
  code,
  accessMode,
  typeSpec: { type: 'value', min: 0, max, scale: 0, step: 1, unit },
});
const DOOR = {
  id: 'door1',
  name: 'Porte Poulailler 2',
  product_name: 'Chicken Coop Door 2',
  model: 'Chicken Coop Door 2',
  product_id: '1gl0ngxpfnchat5a',
  online: true,
  specifications: { category: 'qt', functions: [], status: [] },
  thing_model: {
    services: [
      {
        properties: [
          bool('gate_state', 'ro'),
          bool('open'),
          bool('close'),
          bool('open_time_switch'),
          bool('close_time_switch'),
          bool('light_sensation_switch'),
          bool('factory_reset'),
          value('open_time_set', 1439, 'min', 'rw'),
          value('close_set_time', 1439, 'min', 'rw'),
          value('battery_percentage', 100, '%'),
          value('signal_strength', 100, '%'),
        ],
      },
    ],
  },
};

const CLOUD_STATUS = (gateState) => [
  { code: 'battery_percentage', value: 75 },
  { code: 'close', value: false },
  { code: 'close_set_time', value: 1110 },
  { code: 'close_time_switch', value: false },
  { code: 'factory_reset', value: false },
  { code: 'gate_state', value: gateState },
  { code: 'light_sensation_switch', value: false },
  { code: 'open', value: false },
  { code: 'open_time_set', value: 330 },
  { code: 'open_time_switch', value: false },
  { code: 'signal_strength', value: 100 },
];

const byCode = (device) =>
  Object.fromEntries(device.features.map((f) => [f.external_id.split(':').pop(), f]));

function createHandler(fake = createFakeGladys()) {
  const handler = new TuyaHandler(fake);
  const converted = convertDevice(fake, DOOR);
  const device = {
    external_id: converted.external_id,
    device_type: converted.device_type,
    features: converted.features,
    params: [
      { name: DEVICE_PARAM_NAME.DEVICE_ID, value: 'door1' },
      { name: DEVICE_PARAM_NAME.DEVICE_TYPE, value: converted.device_type },
    ],
  };
  return { fake, handler, device };
}

test('the coop door is detected from its product id or its name', () => {
  assert.equal(getDeviceType(DOOR), DEVICE_TYPES.COOP_DOOR);
  assert.equal(getDeviceType({ product_id: '1gl0ngxpfnchat5a' }), DEVICE_TYPES.COOP_DOOR);
  assert.equal(
    getDeviceType({ name: 'Porte poulailler', status: [{ code: 'gate_state' }] }),
    DEVICE_TYPES.COOP_DOOR,
  );
});

test('the door is one controllable feature, plus the schedule, light mode, battery and signal', () => {
  const features = byCode(convertDevice(createFakeGladys(), DOOR));
  assert.deepEqual(Object.keys(features).sort(), [
    'battery_percentage',
    'close_time_switch',
    'gate_state',
    'light_sensation_switch',
    'open_time_switch',
    'signal_strength',
  ]);
  const door = features.gate_state;
  assert.equal(door.category, DEVICE_FEATURE_CATEGORIES.CURTAIN);
  assert.equal(door.type, DEVICE_FEATURE_TYPES.CURTAIN.STATE);
  assert.equal(door.name, 'Door');
  // gate_state is read-only on the device, the door feature drives open/close.
  assert.equal(door.read_only, false);
  assert.equal(door.coverCommands, undefined, 'mapping-only hint never persisted');
  assert.equal(features.signal_strength.category, DEVICE_FEATURE_CATEGORIES.SIGNAL);
  assert.equal(features.open_time_switch.type, DEVICE_FEATURE_TYPES.SWITCH.BINARY);
  assert.equal(features.open_time_switch.read_only, false);
});

test('poll publishes the door position (true = open), battery and signal', async () => {
  const { fake, handler, device } = createHandler();
  let status = CLOUD_STATUS(false);
  handler.connector = { request: async () => ({ success: true, result: status }) };
  await handler.poll(device);
  const published = () =>
    Object.fromEntries(fake.published.map((p) => [p.featureExternalId.split(':').pop(), p.state]));
  assert.equal(published().gate_state, COVER_STATE.CLOSE);
  assert.equal(published().battery_percentage, 75);
  assert.equal(published().signal_strength, 100);
  assert.equal(published().open_time_switch, 0);

  status = CLOUD_STATUS(true);
  await handler.poll(device);
  assert.equal(published().gate_state, COVER_STATE.OPEN);
});

test('opening / closing the door sends true to the open / close command', async () => {
  const { handler, device } = createHandler();
  const commands = [];
  handler.connector = {
    request: async ({ body }) => {
      if (body) {
        commands.push(body.commands[0]);
      }
      return { success: true, result: [] };
    },
  };
  handler.feedbackPollDelayMs = 0;
  handler.poll = async () => {};
  const door = device.features.find((f) => f.external_id.endsWith(':gate_state'));
  await handler.setValue(device, door, COVER_STATE.OPEN);
  await handler.setValue(device, door, COVER_STATE.CLOSE);
  assert.deepEqual(commands, [
    { code: 'open', value: true },
    { code: 'close', value: true },
  ]);
  // The door has no stop command.
  await assert.rejects(handler.setValue(device, door, COVER_STATE.STOP), /not supported/);
});
