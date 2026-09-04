// -----------------------------------------------------------------------------
// Device diagnostic report (issue #37).
//
// A device type is only supported once we know which Tuya codes the model
// really exposes AND what their values look like. The logs carry that
// information, but each diagnostic line is printed once per device per
// container start: a bench user who looks at the logs an hour later never
// finds it (bench: two round-trips with the same user on a pet feeder variant).
//
// This module builds the same report on demand, from the Configuration screen,
// so the user can copy it into a GitHub issue in one gesture.
//
// The report is written to be pasted publicly: it never contains the local
// key, the IP address nor the Tuya device id.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';

import { convertDevice } from './device/tuya.convertDevice.js';
import { getIgnoredCloudCodes, normalizeCode } from './mappings/index.js';
import { CLOUD_STRATEGY } from './cloud/tuya.cloudStrategy.js';
import { readCloudValues, describeDpsSnapshot } from './tuya.poll.js';
import { MEDIA_CODES } from './media/tuya.media.js';

const logger = createLogger({ name: 'tuya' });

const MAX_VALUE_LENGTH = 120;

/**
 * @description Render a raw Tuya value for the report: a media payload is a
 * base64 blob of no diagnostic value, and a long string is truncated.
 * @param {string} code - The Tuya code the value belongs to.
 * @param {*} value - The raw value.
 * @returns {string} A printable value.
 * @example
 * formatValue('feed_report', 3);
 */
export const formatValue = (code, value) => {
  if (MEDIA_CODES.includes(code)) {
    return '<snapshot payload>';
  }
  if (typeof value === 'string') {
    return value.length > MAX_VALUE_LENGTH
      ? `"${value.slice(0, MAX_VALUE_LENGTH)}…" (${value.length} chars)`
      : `"${value}"`;
  }
  return String(value);
};

/**
 * @description Build the human-readable diagnostic report of one device: what
 * the integration makes of it, and every code it reports with its value and
 * whether that code is mapped, deliberately ignored, or unknown.
 * @param {object} self - The TuyaHandler instance.
 * @param {object} rawDevice - The raw discovered Tuya device.
 * @returns {Promise<string>} The report, ready to paste in an issue.
 * @example
 * const report = await buildDeviceDiagnostic(tuya, rawDevice);
 */
export async function buildDeviceDiagnostic(self, rawDevice) {
  const converted = convertDevice(self.gladys, rawDevice);
  const deviceType = converted.device_type || 'unknown';
  const specifications = rawDevice.specifications || {};
  const productId = rawDevice.product_id || 'unknown';
  const category = specifications.category || rawDevice.category || 'unknown';

  // Code -> what the integration does with it.
  const mappedCodes = new Map();
  (converted.features || []).forEach((feature) => {
    const code = feature.external_id.split(':').pop();
    mappedCodes.set(code, `${feature.category}/${feature.type}`);
  });
  const ignoredCodes = new Set(getIgnoredCloudCodes(deviceType, rawDevice.product_id));

  const lines = [
    `Tuya device diagnostic — "${rawDevice.name}"`,
    `model=${rawDevice.product_name || rawDevice.model || 'unknown'} product_id=${productId} category=${category}`,
    `detected type=${deviceType} mapped features=${(converted.features || []).length}`,
  ];

  // Live cloud status: the value SHAPES are what a new mapping needs (is the
  // battery a percentage or millivolts? is the last meal a number or a JSON
  // record?). Both endpoints are tried: a thing-model device answers on one
  // and returns nothing on the other.
  const values = {};
  let cloudRead = false;
  for (const strategy of [CLOUD_STRATEGY.LEGACY, CLOUD_STRATEGY.SHADOW]) {
    try {
      const read = await readCloudValues(self, strategy, rawDevice.id);
      Object.assign(values, read || {});
      cloudRead = true;
    } catch (e) {
      logger.debug(`[Tuya][diagnostic] ${strategy} read failed: ${e.message}`);
    }
  }
  const codes = Object.keys(values).sort();
  if (!cloudRead) {
    lines.push('', 'Cloud status: unreadable (the Tuya cloud refused both endpoints).');
  } else if (codes.length === 0) {
    lines.push('', 'Cloud status: the device reported no code at all (offline?).');
  } else {
    lines.push('', `Cloud status (${codes.length} codes):`);
    codes.forEach((code) => {
      const normalized = normalizeCode(code);
      let verdict = 'UNMANAGED';
      if (mappedCodes.has(code)) {
        verdict = mappedCodes.get(code);
      } else if (ignoredCodes.has(normalized)) {
        verdict = 'ignored on purpose';
      }
      lines.push(`  ${code} = ${formatValue(code, values[code])}  [${verdict}]`);
    });
  }

  // Codes the device declares in its specifications but never reports: they
  // exist on the model and may still be worth mapping.
  const declared = [...(specifications.functions || []), ...(specifications.status || [])]
    .map((entry) => entry && entry.code)
    .filter(Boolean);
  const silent = [...new Set(declared)].filter((code) => !(code in values)).sort();
  if (silent.length > 0) {
    lines.push('', `Declared but not reported: ${silent.join(', ')}`);
  }

  // LAN view, when the device is locally reachable: the DPS indexes are
  // model-specific and are the only way to add local support for it.
  if (rawDevice.ip && rawDevice.local_key && rawDevice.protocol_version) {
    try {
      const localResult = await self.localRead({
        deviceId: rawDevice.id,
        ip: rawDevice.ip,
        localKey: rawDevice.local_key,
        protocolVersion: String(rawDevice.protocol_version),
      });
      const dps = localResult && localResult.dps ? localResult.dps : null;
      if (dps && Object.keys(dps).length > 0) {
        lines.push('', 'LAN DPS snapshot:');
        describeDpsSnapshot(converted, dps).forEach((entry) => lines.push(`  ${entry}`));
      } else {
        lines.push('', 'LAN DPS snapshot: the device answered with no data.');
      }
    } catch (e) {
      lines.push('', `LAN DPS snapshot: unavailable (${e.message}).`);
    }
  } else {
    lines.push('', 'LAN DPS snapshot: not attempted (device not configured for local mode).');
  }

  lines.push(
    '',
    'This report contains no local key, IP address nor Tuya device id: it can be pasted as-is in a GitHub issue.',
  );
  return lines.join('\n');
}
