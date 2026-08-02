// Detect whether the running Gladys core is recent enough to accept the
// "first-class" feature types shipped in core 4.84.2 / SDK 0.10.0 (the DOORBELL
// category and the AC fan-speed / swing types).
//
// This matters because the core discovery validator
// (externalIntegration.setDiscoveredDevices) rejects the WHOLE published device
// list as soon as one feature carries an unknown category/type. Publishing a
// doorbell/ring or an air-conditioning/fan-speed feature to an older core would
// therefore make every Tuya device disappear from the Discovery screen. On an
// older core we downgrade those features instead (see tuya.convertFeature.js).

// The core version that first exposes the DOORBELL category and the AC
// fan-speed / swing feature types.
export const FIRST_CLASS_TYPES_MIN_CORE_VERSION = '4.84.2';

/**
 * @description Parse a Gladys version string into { major, minor, patch }.
 * Tolerates a leading `v` and any pre-release / build suffix (`4.84.2-beta`).
 * @param {string} version - The version string (e.g. "4.84.2", "v4.84.2").
 * @returns {object|null} The parsed version, or null when unparseable.
 * @example
 * parseVersion('v4.84.2'); // { major: 4, minor: 84, patch: 2 }
 */
export const parseVersion = (version) => {
  if (typeof version !== 'string') {
    return null;
  }
  const match = version.trim().match(/^v?(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    return null;
  }
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
};

/**
 * @description Compare two version strings (major.minor.patch).
 * @param {string} a - First version.
 * @param {string} b - Second version.
 * @returns {number} 1 if a > b, -1 if a < b, 0 if equal; null-safe (an
 * unparseable version compares as lower).
 * @example
 * compareVersions('4.84.2', '4.84.1'); // 1
 */
export const compareVersions = (a, b) => {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa && !pb) {
    return 0;
  }
  if (!pa) {
    return -1;
  }
  if (!pb) {
    return 1;
  }
  const keys = ['major', 'minor', 'patch'];
  for (let i = 0; i < keys.length; i += 1) {
    if (pa[keys[i]] !== pb[keys[i]]) {
      return pa[keys[i]] > pb[keys[i]] ? 1 : -1;
    }
  }
  return 0;
};

/**
 * @description Whether the given Gladys version accepts the first-class DOORBELL
 * and AC fan-speed / swing feature types (core >= 4.84.2).
 * @param {string} gladysVersion - The running core version.
 * @returns {boolean} True when the new feature types can be published safely.
 * @example
 * coreSupportsFirstClassFeatureTypes('4.84.2'); // true
 */
export const coreSupportsFirstClassFeatureTypes = (gladysVersion) =>
  compareVersions(gladysVersion, FIRST_CLASS_TYPES_MIN_CORE_VERSION) >= 0;
