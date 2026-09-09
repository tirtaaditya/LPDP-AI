const db = require('../db');
const { failure } = require('../utils/response');

/** Normalize IPv6-mapped / localhost forms for consistent whitelist matching */
function normalizeIp(ip) {
  if (!ip) return '';
  let value = String(ip).trim().toLowerCase();

  // ::ffff:127.0.0.1 → 127.0.0.1
  if (value.startsWith('::ffff:')) {
    value = value.slice(7);
  }

  // strip brackets [::1]
  if (value.startsWith('[') && value.endsWith(']')) {
    value = value.slice(1, -1);
  }

  // localhost variants → 127.0.0.1
  if (value === '::1' || value === '0:0:0:0:0:0:0:1' || value === 'localhost') {
    return '127.0.0.1';
  }

  return value;
}

function getClientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  let raw = '';
  if (typeof xf === 'string' && xf.length) {
    raw = xf.split(',')[0].trim();
  } else {
    raw = req.ip || req.socket?.remoteAddress || '';
  }
  return normalizeIp(raw);
}

/** Must run AFTER authenticateApi so req.auth.userId is available */
async function ipWhitelist(req, res, next) {
  const ip = getClientIp(req);
  req.clientIp = ip;

  try {
    const userId = req.auth?.userId;
    const allowed = await db.isIpAllowed(ip, userId);
    if (!allowed) {
      return failure(
        res,
        `IP not allowed for this API user: ${ip}. Add this IP in Admin → IP Whitelist for your API user, or disable whitelist in Settings.`,
        403
      );
    }
    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = { ipWhitelist, getClientIp, normalizeIp };
