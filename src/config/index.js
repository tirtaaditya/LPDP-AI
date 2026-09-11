const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

// __dirname = .../src/config → project root is two levels up
const projectRoot = path.resolve(__dirname, '../..');

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return false;

  let buf = fs.readFileSync(filePath);
  // Strip UTF-8 BOM
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    buf = buf.subarray(3);
  }
  // UTF-16 LE (common when edited with Windows Notepad "Unicode")
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    buf = Buffer.from(buf.toString('utf16le').slice(1), 'utf8');
  } else if (buf.includes(0) && !buf.slice(0, 64).toString('utf8').includes('=')) {
    buf = Buffer.from(buf.toString('utf16le'), 'utf8');
  }

  const parsed = dotenv.parse(buf);
  for (const [key, value] of Object.entries(parsed)) {
    process.env[key] = String(value).trim();
  }
  console.log(`[config] Loaded .env from ${filePath}`);
  return true;
}

const envCandidates = [
  path.join(projectRoot, '.env'),
  path.join(process.cwd(), '.env'),
  path.join(__dirname, '../../.env'),
  path.join(__dirname, '../.env'),
];

const envPath = envCandidates.find((p) => fs.existsSync(p)) || envCandidates[0];
if (!loadEnvFile(envPath)) {
  console.warn(`[config] .env not found. Tried:\n  - ${envCandidates.join('\n  - ')}`);
}

function required(name, fallback) {
  const raw = process.env[name] ?? fallback;
  const value = raw == null ? raw : String(raw).trim();
  if (value === undefined || value === '') {
    throw new Error(
      `Missing required env: ${name} (checked ${envPath}; exists=${fs.existsSync(envPath)})`
    );
  }
  return value;
}


const config = {
  port: Number(process.env.PORT || 3000),
  nodeEnv: process.env.NODE_ENV || 'development',
  jwtSecret: required('JWT_SECRET', 'change_this_to_a_long_random_secret'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '1d',
  adminSessionSecret: required('ADMIN_SESSION_SECRET', 'change_this_admin_session_secret'),
  /** Idle timeout: logout after no activity (default 1 hour) */
  adminSessionIdleMs: Number(process.env.ADMIN_SESSION_IDLE_MS || 60 * 60 * 1000),
  /** Absolute max session lifetime (default 8 hours) */
  adminSessionMaxMs: Number(process.env.ADMIN_SESSION_MAX_MS || 8 * 60 * 60 * 1000),
  /** bcrypt cost — salt is generated automatically per hash */
  bcryptRounds: Number(process.env.BCRYPT_ROUNDS || 12),
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB || 10),
  uploadsDir: path.join(projectRoot, 'uploads'),
  projectRoot,
  corsOrigins: String(process.env.CORS_ORIGIN || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  db: {
    server: required('DB_SERVER', '10.44.200.72'),
    user: required('DB_USER', 'sa'),
    password: required('DB_PASSWORD', ''),
    database: required('DB_DATABASE', 'db_lpdp_ai'),
    options: {
      encrypt: String(process.env.DB_ENCRYPT || 'false').toLowerCase() === 'true',
      trustServerCertificate:
        String(process.env.DB_TRUST_SERVER_CERTIFICATE || 'true').toLowerCase() === 'true',
      enableArithAbort: true,
    },
    pool: {
      max: 10,
      min: 0,
      idleTimeoutMillis: 30000,
    },
  },
};

module.exports = config;
