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

/** Admin + API login: tight limit against credential stuffing / bruteforce */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
  handler(req, res) {
    const message =
      'Too many login attempts. Please wait 15 minutes before trying again.';
    if (
      req.accepts('html') &&
      !String(req.headers.accept || '').includes('application/json')
    ) {
      const {
        createCaptcha,
        CAPTCHA_COOKIE,
        captchaCookieOptions,
      } = require('../utils/captcha');
      const captcha = createCaptcha(req.cookies?.[CAPTCHA_COOKIE]);
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

/** Captcha image / audio / refresh — prevent spam generation */
const captchaLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: 'error',
    data: null,
    message: 'Too many captcha requests, please try again later',
  },
});

module.exports = { apiLimiter, loginLimiter, captchaLimiter };
