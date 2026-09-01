// -----------------------------------------------------------------------------
// Debug-only helper: some Tuya DPS (seen on the Honiture Q6 Pro's map/path
// DPS, 123-127) carry a base64-encoded JSON blob instead of a plain
// boolean/enum/integer. `debug_device_status` truncates every raw string for
// the log (see MAX_DPS_VALUE_LOG_LENGTH in tuya.poll.js) so a mapping DP
// number to Gladys code stays readable — but that same truncation hides
// whatever structured data those blobs carry (e.g. a room id). This decodes
// them on demand, for that one debug action only.
// -----------------------------------------------------------------------------

const MAX_ARRAY_ITEMS = 5;
const MAX_DEPTH = 4;

/**
 * @description Base64-decode a string and JSON.parse the result, or return
 * null if it is not a base64-encoded JSON object/array.
 * @param {*} raw - The raw DPS value.
 * @returns {*} The parsed value, or null.
 * @example
 * tryDecodeBase64Json('eyJhIjoxfQ=='); // { a: 1 }
 */
export function tryDecodeBase64Json(raw) {
  if (typeof raw !== 'string' || raw.length < 8) {
    return null;
  }
  // A cheap pre-filter: reject strings that are not plausibly base64 before
  // paying for a Buffer round-trip + JSON.parse.
  if (!/^[A-Za-z0-9+/]+=*$/.test(raw)) {
    return null;
  }
  try {
    const decoded = Buffer.from(raw, 'base64').toString('utf8');
    const parsed = JSON.parse(decoded);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * @description Deep-clone a decoded value for display, truncating long
 * arrays/deep nesting so a point-cloud-sized payload stays readable.
 * @param {*} value - The value to truncate.
 * @param {number} depth - Current recursion depth (internal).
 * @returns {*} The truncated value.
 * @example
 * truncateForDisplay({ points: [1, 2, 3, 4, 5, 6, 7] });
 */
export function truncateForDisplay(value, depth = 0) {
  if (Array.isArray(value)) {
    if (depth >= MAX_DEPTH) {
      return `[array len=${value.length}]`;
    }
    const shown = value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => truncateForDisplay(item, depth + 1));
    return value.length > MAX_ARRAY_ITEMS
      ? [...shown, `...(+${value.length - MAX_ARRAY_ITEMS} more)`]
      : shown;
  }
  if (value && typeof value === 'object') {
    if (depth >= MAX_DEPTH) {
      return '[object]';
    }
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, truncateForDisplay(item, depth + 1)]),
    );
  }
  return value;
}
