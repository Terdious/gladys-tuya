import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DEVICE_FEATURE_CATEGORIES, DEVICE_FEATURE_TYPES } from '@gladysassistant/integration-sdk';

import { TuyaHandler } from '../../src/tuya/handler.js';
import { convertDevice } from '../../src/tuya/device/tuya.convertDevice.js';
import { getDeviceType, DEVICE_TYPES } from '../../src/tuya/mappings/index.js';
import { DEVICE_PARAM_NAME } from '../../src/tuya/constants.js';
import { createFakeGladys } from '../helpers/fakeGladys.js';

// R2601 "Valve Controller" (issue #28), from the user's 1.23.0 diagnostic:
// the standard specification only lists a few codes, the thing model declares
// the rest (units and scales included).
const value = (code, spec, accessMode = 'ro') => ({
  abilityId: 0,
  accessMode,
  code,
  typeSpec: { type: 'value', step: 1, ...spec },
});
const VALVE = {
  id: 'bf7a93550662670e3agpni',
  name: 'Vanne Brumisateur',
  product_name: 'Valve Controller',
  model: 'Valve Controller',
  product_id: 'p8gyk6h5cdlxboqm',
  local_key: 'lk',
  online: true,
  specifications: {
    category: 'sfkzq',
    functions: [
      { code: 'switch', type: 'Boolean', values: '{}' },
      {
        code: 'smart_weather',
        type: 'Enum',
        values: '{"range":["sunny","clear","cloud","cloudy","rainy","snow","fog"]}',
      },
    ],
    status: [
      { code: 'switch', type: 'Boolean', values: '{}' },
      {
        code: 'battery_percentage',
        type: 'Integer',
        values: '{"unit":"%","min":0,"max":100,"scale":0,"step":1}',
      },
      { code: 'work_state', type: 'Enum', values: '{"range":["auto","manual"]}' },
      {
        code: 'smart_weather',
        type: 'Enum',
        values: '{"range":["sunny","clear","cloud","cloudy","rainy","snow","fog"]}',
      },
    ],
  },
  thing_model: {
    services: [
      {
        code: '',
        properties: [
          { abilityId: 1, accessMode: 'rw', code: 'switch', typeSpec: { type: 'bool' } },
          { abilityId: 2, accessMode: 'ro', code: 'valve_status', typeSpec: { type: 'bool' } },
          { abilityId: 3, accessMode: 'rw', code: 'child_lock', typeSpec: { type: 'bool' } },
          value('battery_percentage', { min: 0, max: 100, scale: 0, unit: '%' }),
          value('manual_irri_time', { min: 0, max: 86400, scale: 0, unit: 'min' }, 'rw'),
          value('irri_instant_flow', { min: 0, max: 2147483647, scale: 2, unit: 'L/min' }),
          value('irri_flow', { min: 0, max: 2147483647, scale: 2, unit: 'L/min' }),
          value('rain_delay', { min: 0, max: 2147483647, scale: 0 }),
          value('program_num', { min: 0, max: 10, scale: 0 }),
          {
            abilityId: 9,
            accessMode: 'ro',
            code: 'work_state',
            typeSpec: { type: 'enum', range: ['auto', 'manual'] },
          },
          { abilityId: 10, accessMode: 'ro', code: 'fault', typeSpec: { type: 'bitmap' } },
          { abilityId: 11, accessMode: 'rw', code: 'quick_rain_delay', typeSpec: { type: 'bool' } },
          { abilityId: 12, accessMode: 'rw', code: 'water_program1', typeSpec: { type: 'raw' } },
          { abilityId: 13, accessMode: 'ro', code: 'soft_ver', typeSpec: { type: 'string' } },
        ],
      },
    ],
  },
};

const byCode = (device) =>
  Object.fromEntries(device.features.map((f) => [f.external_id.split(':').pop(), f]));

test('#28: the R2601 is detected as a water valve', () => {
  assert.equal(getDeviceType(VALVE), DEVICE_TYPES.WATER_VALVE);
});

test('#28: convertDevice maps the valve features, nothing unmanaged', () => {
  const device = convertDevice(createFakeGladys(), VALVE);
  const features = byCode(device);
  assert.deepEqual(Object.keys(features).sort(), [
    'battery_percentage',
    'child_lock',
    'irri_instant_flow',
    'manual_irri_time',
    'switch',
    'valve_status',
    'work_state',
  ]);
  assert.equal(features.switch.name, 'Valve');
  assert.equal(features.switch.read_only, false);
  assert.equal(features.valve_status.category, DEVICE_FEATURE_CATEGORIES.WATER_VALVE);
  assert.equal(features.valve_status.type, DEVICE_FEATURE_TYPES.WATER_VALVE.VALVE_WORK_STATE);
  assert.equal(features.irri_instant_flow.type, DEVICE_FEATURE_TYPES.WATER_VALVE.FLOW);
  assert.equal(features.irri_instant_flow.unit, 'cubic-meter-per-hour');
  // The mapping-only hint never reaches the persisted feature.
  assert.equal(features.irri_instant_flow.litersPerMinute, undefined);
  assert.equal(features.manual_irri_time.unit, 'minutes');
  assert.deepEqual(
    features.work_state.supported_options.map(({ label }) => label),
    ['Auto', 'Manual'],
  );
});

test('#28: on a core older than 4.84.2 the water-valve features are skipped, the rest kept', () => {
  const device = convertDevice(createFakeGladys(), VALVE, { coreSupportsFirstClassTypes: false });
  const codes = Object.keys(byCode(device));
  assert.ok(!codes.includes('valve_status'));
  assert.ok(!codes.includes('irri_instant_flow'));
  assert.ok(codes.includes('switch'));
  assert.ok(codes.includes('battery_percentage'));
});

test('#28: poll publishes the valve states, the flow converted from L/min to m³/h', async () => {
  const fake = createFakeGladys();
  const handler = new TuyaHandler(fake);
  const converted = convertDevice(fake, VALVE);
  const device = {
    external_id: converted.external_id,
    device_type: converted.device_type,
    // As Gladys stores them: no feature scale.
    features: converted.features.map(({ scale: _scale, ...rest }) => rest),
    params: [{ name: DEVICE_PARAM_NAME.DEVICE_ID, value: VALVE.id }],
  };
  handler.connector = {
    request: async () => ({
      success: true,
      result: [
        { code: 'switch', value: true },
        { code: 'valve_status', value: true },
        { code: 'battery_percentage', value: 96 },
        { code: 'child_lock', value: true },
        { code: 'manual_irri_time', value: 10 },
        // 12.50 L/min
        { code: 'irri_instant_flow', value: 1250 },
        { code: 'work_state', value: 'manual' },
      ],
    }),
  };

  await handler.poll(device);

  const states = Object.fromEntries(
    fake.published.map((p) => [p.featureExternalId.split(':').pop(), p.state]),
  );
  assert.equal(states.switch, 1);
  assert.equal(states.valve_status, 1);
  assert.equal(states.battery_percentage, 96);
  assert.equal(states.child_lock, 1);
  assert.equal(states.manual_irri_time, 10);
  assert.equal(states.irri_instant_flow, 0.75);
  assert.deepEqual(states.work_state, { text: 'manual' });
});

test('#28: setValue opens the valve through the cloud', async () => {
  const fake = createFakeGladys();
  const handler = new TuyaHandler(fake);
  const converted = convertDevice(fake, VALVE);
  const device = {
    external_id: converted.external_id,
    device_type: converted.device_type,
    features: converted.features,
    params: [{ name: DEVICE_PARAM_NAME.DEVICE_ID, value: VALVE.id }],
  };
  const commands = [];
  handler.connector = {
    request: async ({ body }) => {
      commands.push(body.commands[0]);
      return { success: true };
    },
  };
  const valve = device.features.find((f) => f.external_id.endsWith(':switch'));
  await handler.setValue(device, valve, 1);
  assert.deepEqual(commands, [{ code: 'switch', value: true }]);
});
