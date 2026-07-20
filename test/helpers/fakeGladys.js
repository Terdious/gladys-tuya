// -----------------------------------------------------------------------------
// Minimal in-memory stand-in for the Gladys SDK object, for unit tests.
//
// It reproduces the only surface the Tuya modules rely on:
//   - externalIds(type, platformId) -> { device, feature(key) } with the same
//     `ext:<selector>:...` shape as the real SDK
//   - publishState / publishStates   -> record calls so tests can assert them
//   - publishDiscoveredDevices       -> record calls
// This lets us test the pure "wiring" logic (discovery payloads, dispatch)
// without a running Gladys server or a real WebSocket.
// -----------------------------------------------------------------------------

const SELECTOR = 'tuya';

export function createFakeGladys() {
  const published = [];
  const discovered = [];
  const transports = [];

  return {
    published,
    discovered,
    transports,

    externalIds(type, platformId) {
      const device = `ext:${SELECTOR}:${type}:${platformId}`;
      return {
        device,
        feature: (key) => `${device}:${key}`,
      };
    },

    async publishState(featureExternalId, state) {
      published.push({ featureExternalId, state });
    },

    async publishStates(states) {
      for (const s of states) {
        published.push({ featureExternalId: s.device_feature_external_id, state: s.state });
      }
    },

    async publishDiscoveredDevices(devices) {
      discovered.push(devices);
      return { success: true, count: devices.length };
    },

    async publishTransports(entries) {
      for (const entry of entries) {
        transports.push(entry);
      }
      return { success: true };
    },
  };
}
