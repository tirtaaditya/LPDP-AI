const rateLimit = require('express-rate-limit');

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: 'error',
    data: null,
    message: 'Too many requests, please try again later',
  },
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler(req, res) {
    const message = 'Too many login attempts, please try again later';
    if (req.accepts('html') && !String(req.headers.accept || '').includes('application/json')) {
      const {
        createCaptcha,
        CAPTCHA_COOKIE,
        captchaCookieOptions,
      } = require('../utils/captcha');
      const captcha = createCaptcha();
      res.cookie(CAPTCHA_COOKIE, captcha.token, captchaCookieOptions(req));
      return res.status(429).render('admin/login', {
        error: message,
        csrfToken: res.locals.csrfToken || null,
        captchaSvg: String(captcha.svg).replace(/^<\?xml[^>]*>\s*/i, ''),
      });
    }
    return res.status(429).json({
      status: 'error',
      data: null,
      message,
    });
  },
});

module.exports = { apiLimiter, loginLimiter };
