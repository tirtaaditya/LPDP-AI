const authService = require('../services/auth.service');
const { failure } = require('../utils/response');

async function authenticateApi(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return failure(res, 'Unauthorized: missing Bearer token', 401);
  }

  try {
    const payload = authService.verifyAccessToken(token);
    if (payload.typ !== 'access' || payload.role !== 'api') {
      return failure(res, 'Unauthorized: invalid token type', 401);
    }
    req.auth = {
      type: 'jwt',
      userId: payload.uid,
      username: payload.sub,
      role: payload.role,
      payload,
    };
    return next();
  } catch {
    try {
      const staticToken = await authService.verifyStaticApiToken(token);
      if (!staticToken) {
        return failure(res, 'Unauthorized: invalid or expired token', 401);
      }
      req.auth = {
        type: 'static',
        userId: staticToken.user_id,
        username: staticToken.username,
        role: staticToken.role,
        token: staticToken,
      };
      return next();
    } catch {
      return failure(res, 'Unauthorized: invalid or expired token', 401);
    }
  }
}

function requireAdminSession(req, res, next) {
  const token = req.cookies?.admin_session;
  if (!token) {
    if (req.accepts('html')) return res.redirect('/admin/login');
    return failure(res, 'Admin session required', 401);
  }

  try {
    req.admin = authService.verifyAdminSession(token);
    return next();
  } catch {
    res.clearCookie('admin_session');
    if (req.accepts('html')) return res.redirect('/admin/login');
    return failure(res, 'Admin session invalid', 401);
  }
}

module.exports = { authenticateApi, requireAdminSession };
