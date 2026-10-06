const { INPUT_LIMITS, findLengthViolation } = require('../config/inputLimits');

function redirectTarget(req) {
  if (req.path === '/login') return '/admin/login';
  const referer = req.get('referer');
  if (referer) {
    try {
      const url = new URL(referer);
      if (url.host === req.get('host') && url.pathname.startsWith('/admin')) {
        return url.pathname;
      }
    } catch {
      /* ignore malformed referer */
    }
  }
  return '/admin';
}

/** Rejects admin POSTs whose fields exceed INPUT_LIMITS (multipart bodies are checked in controllers) */
function enforceInputLimits(req, res, next) {
  if (req.method !== 'POST') return next();
  const message = findLengthViolation(req.body);
  if (!message) return next();

  const wantsJson =
    req.xhr || String(req.headers.accept || '').includes('application/json');
  if (wantsJson) {
    return res.status(400).json({ status: 'error', data: null, message });
  }
  return res.redirect(`${redirectTarget(req)}?error=${encodeURIComponent(message)}`);
}

/** Exposes limits to EJS views as `limits` */
function exposeInputLimits(req, res, next) {
  res.locals.limits = INPUT_LIMITS;
  return next();
}

module.exports = { enforceInputLimits, exposeInputLimits };
