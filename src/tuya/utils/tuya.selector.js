// Selector helpers for discovered devices and features.
//
// Gladys stores a `selector` on every device and feature; it must be globally
// unique. When the discovery payload omits it, the core derives it from the
// display name — so two devices exposing a feature with the same name (e.g.
// two air conditioners each with a "Switch" feature) end up with the SAME
// feature selector and the second device is rejected as a duplicate.
//
// We therefore always provide explicit selectors:
// - the device selector embeds the Tuya device id (globally unique);
// - the feature selector is scoped to the device selector + the Tuya code
//   (unique within a device), so it is unique across the whole installation.

/**
 * @description Slugify a string to a Gladys-safe selector segment ([a-z0-9-]).
 * @param {string} value - Raw string.
 * @returns {string} Slugified value.
 * @example
 * slugify('Clim Salle d\'attente'); // 'clim-salle-d-attente'
 */
export const slugify = (value) =>
  String(value === undefined || value === null ? '' : value)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/**
 * @description Build the device selector: `<slug(name)>-<slug(tuyaId)>`, or just
 * the id slug when the name is empty. The Tuya id guarantees global uniqueness
 * even when two devices share a display name.
 * @param {string} name - Device display name.
 * @param {string} tuyaId - Tuya device id.
 * @returns {string} Device selector.
 * @example
 * buildDeviceSelector('Clim Salle d\'attente', 'bfxxxx'); // 'clim-salle-d-attente-bfxxxx'
 */
export const buildDeviceSelector = (name, tuyaId) => {
  const idSlug = slugify(tuyaId);
  const nameSlug = slugify(name);
  if (!nameSlug) {
    return idSlug || 'tuya-device';
  }
  return idSlug ? `${nameSlug}-${idSlug}` : nameSlug;
};

/**
 * @description Build a feature selector scoped to its device: the Tuya code is
 * unique within a device, so `<deviceSelector>-<slug(code)>` is unique across
 * the whole installation.
 * @param {string} deviceSelector - The owning device selector.
 * @param {string} code - Tuya feature code.
 * @returns {string} Feature selector.
 * @example
 * buildFeatureSelector('clim-...-bfxxxx', 'switch_1'); // 'clim-...-bfxxxx-switch-1'
 */
export const buildFeatureSelector = (deviceSelector, code) => {
  const codeSlug = slugify(code);
  return codeSlug ? `${deviceSelector}-${codeSlug}` : deviceSelector;
};
