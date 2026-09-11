const crypto = require('crypto');
const db = require('../db');
const { safeClientMessage } = require('../utils/safeError');

function requestLogger(req, res, next) {
  const started = Date.now();
  const requestId = crypto.randomBytes(8).toString('hex');
  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);

  res.on('finish', () => {
    const durationMs = Date.now() - started;
    const ip = req.clientIp || req.ip;
    console.log(
      `[${requestId}] ${req.method} ${req.originalUrl} ${res.statusCode} ${durationMs}ms ip=${ip}`
    );
    db.logRequest({
      requestId,
      method: req.method,
      pathName: req.originalUrl,
      statusCode: res.statusCode,
      ip,
      durationMs,
      message: null,
    }).catch((err) => {
      console.error('Failed to persist request log:', err.message);
    });
  });

  next();
}

function errorHandler(err, req, res, next) {
  console.error(`[${req.requestId || '-'}]`, err);

  if (res.headersSent) return next(err);

  const status = err.status || err.statusCode || 500;
  const safeMessage = safeClientMessage(
    { ...err, status },
    status >= 500 ? 'Internal server error' : 'Request failed'
  );

  const wantsHtml =
    req.accepts('html') &&
    !String(req.headers.accept || '').includes('application/json') &&
    !req.xhr &&
    String(req.originalUrl || '').startsWith('/admin');

  if (wantsHtml) {
    return res.status(status).render('admin/error', {
      pageTitle: status >= 500 ? 'Server Error' : 'Error',
      status,
      message: safeMessage,
      admin: req.admin || null,
      csrfToken: res.locals.csrfToken || null,
      activeMenu: '',
      flash: null,
      error: null,
    });
  }

  return res.status(status).json({
    status: 'error',
    data: null,
    message: safeMessage,
  });
}

module.exports = { requestLogger, errorHandler };
