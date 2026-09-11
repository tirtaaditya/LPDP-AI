const crypto = require('crypto');
const config = require('../config');
const { cookieSecureForRequest } = require('../utils/requestScheme');

const CSRF_COOKIE = 'csrf_token';

/** @deprecated use cookieSecureForRequest(req) — kept for callers without req */
function cookieSecure(req) {
  return cookieSecureForRequest(req);
}

function adminCookieOptions(req, maxAgeMs) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: cookieSecureForRequest(req),
    path: '/',
    maxAge: maxAgeMs,
  };
}

function clearAdminCookie(req, res) {
  res.clearCookie('admin_session', {
    httpOnly: true,
    sameSite: 'lax',
    secure: cookieSecureForRequest(req),
    path: '/',
  });
}

function setAdminCookie(req, res, token) {
  res.cookie('admin_session', token, adminCookieOptions(req, config.adminSessionMaxMs));
}

function createCsrfToken() {
  return crypto.randomBytes(32).toString('hex');
}

function csrfCookieOptions(req) {
  return {
    httpOnly: false, // readable by JS for fetch header
    sameSite: 'strict',
    secure: cookieSecureForRequest(req),
    path: '/',
    maxAge: config.adminSessionMaxMs,
  };
}

function ensureCsrfToken(req, res) {
  let token = req.cookies?.[CSRF_COOKIE];
  if (!token || String(token).length < 32) {
    token = createCsrfToken();
    res.cookie(CSRF_COOKIE, token, csrfCookieOptions(req));
  }
  res.locals.csrfToken = token;
  return token;
}

/**
 * Always expose CSRF token for views; validate on state-changing methods.
 */
function csrfProtection(req, res, next) {
  const token = ensureCsrfToken(req, res);

  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  const submitted =
    req.body?._csrf ||
    req.headers['x-csrf-token'] ||
    req.headers['csrf-token'];

  if (!submitted || String(submitted) !== String(token)) {
    if (req.accepts('html') && !req.xhr && !String(req.headers.accept || '').includes('application/json')) {
      return res.status(403).render('admin/error', {
        pageTitle: 'Forbidden',
        status: 403,
        message: 'Invalid CSRF token. Refresh the page and try again.',
        admin: req.admin || null,
        csrfToken: token,
        activeMenu: '',
        flash: null,
        error: null,
      });
    }
    return res.status(403).json({
      status: 'error',
      data: null,
      message: 'Invalid CSRF token',
    });
  }

  return next();
}

module.exports = {
  CSRF_COOKIE,
  cookieSecure,
  adminCookieOptions,
  clearAdminCookie,
  setAdminCookie,
  ensureCsrfToken,
  csrfProtection,
};
