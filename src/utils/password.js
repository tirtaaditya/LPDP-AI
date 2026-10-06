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

const COMMON_WEAK_PASSWORDS = new Set([
  'password',
  'password1',
  'password123',
  'passw0rd',
  'p@ssw0rd',
  'p@ssword',
  'qwerty123',
  'qwertyuiop',
  'admin123',
  'admin@123',
  'administrator',
  'welcome1',
  'welcome123',
  'letmein1',
  'iloveyou',
  'lpdp2026',
  'lpdp@2026',
]);

/** Returns list of unmet rules (Indonesian messages); empty array = strong */
function getPasswordIssues(plain, { username = '' } = {}) {
  const value = String(plain || '');
  const issues = [];
  if (value.length < MIN_PASSWORD_LENGTH) issues.push(`minimal ${MIN_PASSWORD_LENGTH} karakter`);
  if (!/[a-z]/.test(value)) issues.push('huruf kecil (a-z)');
  if (!/[A-Z]/.test(value)) issues.push('huruf besar (A-Z)');
  if (!/[0-9]/.test(value)) issues.push('angka (0-9)');
  if (!/[^A-Za-z0-9]/.test(value)) issues.push('simbol (mis. !@#$%)');
  if (/\s/.test(value)) issues.push('tanpa spasi');
  if (/(.)\1{3,}/.test(value)) issues.push('tidak boleh 4+ karakter sama berulang');

  const lower = value.toLowerCase();
  if (COMMON_WEAK_PASSWORDS.has(lower)) issues.push('tidak boleh password umum');
  const uname = String(username || '').trim().toLowerCase();
  if (uname.length >= 3 && lower.includes(uname)) issues.push('tidak boleh mengandung username');
  return issues;
}

function validatePassword(plain, { field = 'Password', username = '' } = {}) {
  const value = String(plain || '');
  const issues = getPasswordIssues(value, { username });
  if (issues.length) {
    const err = new Error(`${field} terlalu lemah. Wajib: ${issues.join(', ')}`);
    err.code = 'PASSWORD_WEAK';
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
  getPasswordIssues,
  validatePassword,
};
