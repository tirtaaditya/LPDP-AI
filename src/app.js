const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const config = require('./config');
const apiRoutes = require('./routes/api.routes');
const adminRoutes = require('./routes/admin.routes');
const { requestLogger, errorHandler } = require('./middleware/errorHandler');
const { csrfProtection } = require('./middleware/csrf');

function createApp() {
  const app = express();

  app.set('trust proxy', 1);
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));

  app.use('/public', express.static(path.join(__dirname, '../public')));

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: [
            "'self'",
            "'unsafe-inline'",
            'https://cdn.jsdelivr.net',
            'https://cdn.datatables.net',
            'https://code.jquery.com',
          ],
          scriptSrcAttr: ["'unsafe-inline'"],
          styleSrc: [
            "'self'",
            "'unsafe-inline'",
            'https://cdn.jsdelivr.net',
            'https://cdn.datatables.net',
            'https://fonts.googleapis.com',
          ],
          fontSrc: ["'self'", 'https://fonts.gstatic.com', 'https://cdn.jsdelivr.net', 'data:'],
          imgSrc: ["'self'", 'data:', 'blob:'],
          mediaSrc: ["'self'", 'blob:'],
          connectSrc: ["'self'"],
          frameAncestors: ["'none'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
        },
      },
      crossOriginEmbedderPolicy: false,
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    })
  );

  // API CORS: allowlist via CORS_ORIGIN, otherwise reflect request origin (Bearer API)
  const corsOptions = {
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (!config.corsOrigins.length) return callback(null, true);
      if (config.corsOrigins.includes(origin) || config.corsOrigins.includes('*')) {
        return callback(null, true);
      }
      return callback(new Error('Not allowed by CORS'));
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
  };
  app.use('/api', cors(corsOptions));

  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());
  app.use(requestLogger);

  // Security headers extras
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
  });

  app.get('/', (req, res) => res.redirect('/admin'));

  app.use('/api/v1', apiRoutes);
  app.use('/admin', csrfProtection, adminRoutes);

  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
