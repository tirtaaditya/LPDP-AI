const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const config = require('../config');

const MIN_PASSWORD_LENGTH = 8;
const SALT_BYTES = 32;

/**
 * Generate a unique random salt stored separately in DB (password_salt).
 */
function generateSalt() {
  return crypto.randomBytes(SALT_BYTES).toString('hex');
}

function isLegacyHash(salt) {
  return !salt || !String(salt).trim();
}

/**
 * Hash password with application salt + bcrypt (bcrypt also adds its own internal salt).
 * Returns { hash, salt } — both must be persisted.
 */
async function hashPassword(plain, existingSalt = null) {
  const salt = existingSalt || generateSalt();
  const material = `${String(plain)}:${salt}`;
  const hash = await bcrypt.hash(material, config.bcryptRounds);
  return { hash, salt };
}

/**
 * Verify password.
 * - New accounts: compare(password + ":" + password_salt, password_hash)
 * - Legacy (password_salt NULL/empty): compare(password, password_hash)
 */
async function comparePassword(plain, hash, salt = null) {
  if (!plain || !hash) return false;
  if (!isLegacyHash(salt)) {
    return bcrypt.compare(`${String(plain)}:${salt}`, String(hash));
  }
  return bcrypt.compare(String(plain), String(hash));
}

function validatePassword(plain, { field = 'Password' } = {}) {
  const value = String(plain || '');
  if (value.length < MIN_PASSWORD_LENGTH) {
    const err = new Error(`${field} must be at least ${MIN_PASSWORD_LENGTH} characters`);
    err.code = 'PASSWORD_TOO_SHORT';
    err.status = 400;
    throw err;
  }
  return value;
}

module.exports = {
  MIN_PASSWORD_LENGTH,
  generateSalt,
  isLegacyHash,
  hashPassword,
  comparePassword,
  validatePassword,
};
