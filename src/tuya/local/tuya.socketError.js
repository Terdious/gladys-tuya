// Ported from the core PR6 branch (tuya-follow-up-hardening): human-readable,
// bounded socket error messages for the local (LAN) layer.

// Tuya lib parser errors ("Prefix does not match: <hex>") embed the whole raw
// TCP buffer in the message (kBs per log line): the beginning is enough to
// identify the error.
export const SOCKET_ERROR_MESSAGE_MAX_LENGTH = 160;

const NETWORK_ERROR_CODES = [
  'EHOSTUNREACH',
  'EHOSTDOWN',
  'ENETUNREACH',
  'ECONNREFUSED',
  'ETIMEDOUT',
];

/**
 * @description Format a local socket error into a short, actionable message.
 * @param {Error} err - The socket error.
 * @param {string} ip - The device LAN IP (for unreachable messages).
 * @returns {string} A bounded, human-readable message.
 * @example
 * logger.info(formatSocketError(err, '192.168.1.50'));
 */
export const formatSocketError = (err, ip) => {
  if (!err || !err.message) {
    return 'Local socket error';
  }
  if (NETWORK_ERROR_CODES.includes(err.code)) {
    return `Local device unreachable at ${ip}:6668 (${err.code}). Device may be offline, unplugged, or no longer connected to Wi-Fi.`;
  }
  if (typeof err.message === 'string' && err.message.includes('EHOSTUNREACH')) {
    return `Local device unreachable at ${ip}:6668 (EHOSTUNREACH). Device may be offline, unplugged, or no longer connected to Wi-Fi.`;
  }
  const message = String(err.message);
  const truncatedMessage =
    message.length > SOCKET_ERROR_MESSAGE_MAX_LENGTH
      ? `${message.slice(0, SOCKET_ERROR_MESSAGE_MAX_LENGTH)}... (truncated)`
      : message;
  return `Local socket error: ${truncatedMessage}`;
};
