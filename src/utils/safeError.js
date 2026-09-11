/**
 * Map internal errors to safe client-facing messages (no SQL / stack leaks).
 */
function safeClientMessage(err, fallback = 'Request failed') {
  if (!err) return fallback;
  const code = err.code || '';
  const status = err.status || err.statusCode;

  const byCode = {
    PASSWORD_TOO_SHORT: err.message,
    SESSION_IDLE: 'Session expired due to inactivity. Please login again.',
    SESSION_EXPIRED: 'Session expired. Please login again.',
    ELOGIN: 'Database connection error',
    ETIMEOUT: 'Database timeout',
    ERREQUEST: 'Database request failed',
  };

  if (byCode[code]) return byCode[code];

  if (status && status < 500 && err.message && !/sql|mssql|constraint|violation|deadlock/i.test(err.message)) {
    return err.message;
  }

  if (process.env.NODE_ENV === 'production' || (status && status >= 500)) {
    return fallback;
  }

  return err.message || fallback;
}

module.exports = { safeClientMessage };
