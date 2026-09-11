/**
 * Detect HTTPS for the current request (direct TLS or reverse proxy).
 */
function isHttpsRequest(req) {
  if (!req) return false;
  if (req.secure) return true;
  const xf = String(req.headers?.['x-forwarded-proto'] || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  if (xf === 'https') return true;
  if (String(req.protocol || '').toLowerCase() === 'https') return true;
  return false;
}

/**
 * Cookie Secure flag:
 * - COOKIE_SECURE=true|false forces value
 * - otherwise follow request scheme (HTTP → false, HTTPS → true)
 */
function cookieSecureForRequest(req) {
  const forced = String(process.env.COOKIE_SECURE || '').toLowerCase();
  if (forced === 'true') return true;
  if (forced === 'false') return false;
  return isHttpsRequest(req);
}

module.exports = {
  isHttpsRequest,
  cookieSecureForRequest,
};
