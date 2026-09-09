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

function signAdminSession(user) {
  return jwt.sign(
    {
      sub: user.username,
      uid: user.id,
      role: 'admin',
      typ: 'admin_session',
    },
    config.adminSessionSecret,
    { expiresIn: '8h' }
  );
}

function verifyAdminSession(token) {
  const payload = jwt.verify(token, config.adminSessionSecret);
  if (payload.role !== 'admin') throw new Error('Invalid admin session');
  return payload;
}

module.exports = {
  loginApiUser,
  verifyAccessToken,
  createStaticApiToken,
  verifyStaticApiToken,
  loginAdmin,
  signAdminSession,
  verifyAdminSession,
};
