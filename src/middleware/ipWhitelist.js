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
    const result = await db.isIpAllowed(ip, userId);
    // Backward-compatible if an old boolean is ever returned
    const allowed = typeof result === 'boolean' ? result : !!result?.allowed;
    const meta = typeof result === 'object' && result ? result : {};

    if (!allowed) {
      const reason = meta.reason || 'ip_not_allowed';
      console.warn(
        `[ipWhitelist] DENY ip=${ip} userId=${userId || '-'} reason=${reason} rows=${meta.rowCount ?? '?'}`
      );
      try {
        await db.recordBlockedIp({
          ip,
          userId: userId || null,
          username: req.auth?.username || null,
          method: req.method,
          path: req.originalUrl || req.url,
          userAgent: req.get('user-agent') || null,
          reason: `IP whitelist deny (${reason})`,
        });
      } catch (logErr) {
        console.error('[ipWhitelist] Failed to record blocked IP:', logErr.message);
      }

      return failure(
        res,
        `IP not allowed for this API user: ${ip}. reason=${reason}; whitelist_rows=${meta.rowCount ?? 0}. Add this IP in Admin → IP Whitelist.`,
        403,
        {
          error_code: 'IP_NOT_WHITELISTED',
          client_ip: ip,
          reason,
          whitelist_enabled: meta.enabled !== false,
          whitelist_rows: meta.rowCount ?? 0,
        }
      );
    }

    return next();
  } catch (err) {
    // Fail closed — never skip whitelist on errors
    console.error('[ipWhitelist] check failed:', err.message);
    return failure(
      res,
      `IP whitelist check failed: ${err.message}`,
      403,
      { error_code: 'IP_WHITELIST_ERROR', client_ip: ip }
    );
  }
}

module.exports = { ipWhitelist, getClientIp, normalizeIp };
