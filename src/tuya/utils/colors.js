// Color conversion helpers, ported from server/utils/colors.js of the Gladys
// core (only the functions needed by the Tuya device mapping).

/**
 * @description Converts int color to RGB array.
 * @param {number} intColor - Color between 0 and 16777215.
 * @returns {Array} [red, green, blue] array.
 * @example
 * const rgb = intToRgb(255);
 */
export function intToRgb(intColor) {
  const red = intColor >> 16;
  const green = (intColor - (red << 16)) >> 8;
  const blue = intColor - (red << 16) - (green << 8);

  return [red, green, blue];
}

/**
 * @description Convert hsb color to rgb.
 * @param {Array} hsb - Hue, saturation, brightness.
 * @param {number} maxSB - Max saturation and brightness.
 * @returns {Array} [red, green, blue] array.
 * @example
 * const [r, g, b] = hsbToRgb([1, 2, 3]);
 */
export function hsbToRgb(hsb, maxSB = 100) {
  const h = hsb[0];
  const s = hsb[1];
  const b = hsb[2];
  const sDivided = s / maxSB;
  const bDivided = b / maxSB;
  const k = (n) => (n + h / 60) % 6;
  const f = (n) => bDivided * (1 - sDivided * Math.max(0, Math.min(k(n), 4 - k(n), 1)));
  return [Math.round(255 * f(5)), Math.round(255 * f(3)), Math.round(255 * f(1))];
}

/**
 * @description Convert rgb to hsb.
 * @param {Array} rgb - Rgb color.
 * @param {number} maxSB - Max saturation and brightness.
 * @returns {Array} [h, s, b] array.
 * @example
 * const [h, s, b] = rgbToHsb([1, 2, 3]);
 */
export function rgbToHsb(rgb, maxSB = 100) {
  let r = rgb[0];
  let g = rgb[1];
  let b = rgb[2];
  r /= 255;
  g /= 255;
  b /= 255;
  const v = Math.max(r, g, b);
  const n = v - Math.min(r, g, b);
  const h = n === 0 ? 0 : n && v === r ? (g - b) / n : v === g ? 2 + (b - r) / n : 4 + (r - g) / n;
  return [
    Math.round(60 * (h < 0 ? h + 6 : h)),
    Math.round(v && (n / v) * maxSB),
    Math.round(v * maxSB),
  ];
}

/**
 * @description Converts RGB array color to int.
 * @param {Array} rgb - [red, green, blue] array.
 * @returns {number} Color between 0 and 16777215.
 * @example
 * const int = rgbToInt([255, 0, 0]);
 */
export function rgbToInt(rgb) {
  const [red, green, blue] = rgb;

  return (red << 16) | (green << 8) | blue;
}
