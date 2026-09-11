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
    OPENAI_API_ERROR: err.message,
    AI_PROVIDER_ERROR: err.message,
    FILE_DOWNLOAD_FAILED: err.message,
    FILE_URL_INVALID: err.message,
    FILE_TYPE_NOT_ALLOWED: err.message,
    FILE_TOO_LARGE: err.message,
    FILE_EMPTY: err.message,
    FILE_TOO_MANY: err.message,
    OPENAI_NOT_CONFIGURED: err.message,
    OLLAMA_NOT_CONFIGURED: err.message,
    OLLAMA_SCANNED_PDF: err.message,
  };

  if (byCode[code]) return byCode[code];

  // OpenAI SDK errors often expose status + message
  const openaiMsg =
    err.error?.message ||
    err.response?.data?.error?.message ||
    null;
  if (openaiMsg && !/sql|mssql|constraint|violation|deadlock|password|secret|api[_-]?key/i.test(openaiMsg)) {
    return openaiMsg;
  }

  if (err.message && !/sql|mssql|constraint|violation|deadlock|ECONN|password_hash|stack/i.test(err.message)) {
    // Allow provider / validation messages through (even on 502)
    if (
      /openai|ollama|model|token|rate limit|timeout|download|file|vision|pdf|context|quota|billing|insufficient/i.test(
        err.message
      )
    ) {
      return err.message;
    }
  }

  if (status && status < 500 && err.message && !/sql|mssql|constraint|violation|deadlock/i.test(err.message)) {
    return err.message;
  }

  if (process.env.NODE_ENV === 'production' && status && status >= 500) {
    return fallback;
  }

  return err.message || fallback;
}

module.exports = { safeClientMessage };
