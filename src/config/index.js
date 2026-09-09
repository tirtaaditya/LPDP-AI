const path = require('path');
const dotenv = require('dotenv');

// Always load .env from project root (works with PM2 even if cwd is wrong)
const projectRoot = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(projectRoot, '.env') });

function required(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

const config = {
  port: Number(process.env.PORT || 3000),
  nodeEnv: process.env.NODE_ENV || 'development',
  jwtSecret: required('JWT_SECRET', 'change_this_to_a_long_random_secret'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '1d',
  adminSessionSecret: required('ADMIN_SESSION_SECRET', 'change_this_admin_session_secret'),
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB || 10),
  uploadsDir: path.join(projectRoot, 'uploads'),
  projectRoot,
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
