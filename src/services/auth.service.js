const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../db');

async function loginApiUser(username, password) {
  const user = await db.verifyUserCredentials(username, password, 'api');
  if (!user) return null;

  const token = jwt.sign(
    {
      sub: user.username,
      uid: user.id,
      role: 'api',
      typ: 'access',
    },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn }
  );

  return {
    access_token: token,
    token_type: 'Bearer',
    expires_in: config.jwtExpiresIn,
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
    },
  };
}

function verifyAccessToken(token) {
  return jwt.verify(token, config.jwtSecret);
}

async function createStaticApiToken(userId, name) {
  const raw = `lpdp_${crypto.randomBytes(24).toString('hex')}`;
  const tokenHash = crypto.createHash('sha256').update(raw).digest('hex');
  const tokenPrefix = raw.slice(0, 12);
  const id = await db.createApiToken(userId, name, tokenHash, tokenPrefix);
  return { id, user_id: userId, name, token: raw, token_prefix: tokenPrefix };
}

async function verifyStaticApiToken(rawToken) {
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  return db.findActiveTokenByHash(tokenHash);
}

async function loginAdmin(username, password) {
  return db.verifyUserCredentials(username, password, 'admin');
}

/**
 * Admin session JWT with sliding idle timeout (lastActivity)
 * and absolute max lifetime (issuedAtMs).
 */
function signAdminSession(user, opts = {}) {
  const now = Date.now();
  const issuedAtMs = opts.issuedAtMs || now;
  const lastActivity = opts.lastActivity || now;
  const remainingMs = Math.max(
    1000,
    Math.min(
      config.adminSessionIdleMs + 60_000,
      issuedAtMs + config.adminSessionMaxMs - now
    )
  );

  return jwt.sign(
    {
      sub: user.username || user.sub,
      uid: user.id ?? user.uid,
      role: 'admin',
      typ: 'admin_session',
      lastActivity,
      issuedAtMs,
    },
    config.adminSessionSecret,
    { expiresIn: Math.ceil(remainingMs / 1000) }
  );
}

function verifyAdminSession(token) {
  const payload = jwt.verify(token, config.adminSessionSecret);
  if (payload.role !== 'admin' || payload.typ !== 'admin_session') {
    const err = new Error('Invalid admin session');
    err.code = 'SESSION_EXPIRED';
    throw err;
  }

  const now = Date.now();
  const issuedAtMs = Number(payload.issuedAtMs) || (payload.iat ? payload.iat * 1000 : now);
  const lastActivity = Number(payload.lastActivity) || issuedAtMs;

  if (now - issuedAtMs > config.adminSessionMaxMs) {
    const err = new Error('Session expired');
    err.code = 'SESSION_EXPIRED';
    throw err;
  }

  if (now - lastActivity > config.adminSessionIdleMs) {
    const err = new Error('Session idle timeout');
    err.code = 'SESSION_IDLE';
    throw err;
  }

  return { ...payload, issuedAtMs, lastActivity };
}

/** Re-issue cookie JWT with refreshed lastActivity (sliding 1h idle). */
function touchAdminSession(payload) {
  return signAdminSession(payload, {
    issuedAtMs: payload.issuedAtMs,
    lastActivity: Date.now(),
  });
}

module.exports = {
  loginApiUser,
  verifyAccessToken,
  createStaticApiToken,
  verifyStaticApiToken,
  loginAdmin,
  signAdminSession,
  verifyAdminSession,
  touchAdminSession,
};
