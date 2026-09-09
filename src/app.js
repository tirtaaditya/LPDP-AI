const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const apiRoutes = require('./routes/api.routes');
const adminRoutes = require('./routes/admin.routes');
const { requestLogger, errorHandler } = require('./middleware/errorHandler');

function createApp() {
  const app = express();

  app.set('trust proxy', 1);
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));

  app.use('/public', express.static(path.join(__dirname, '../public')));
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors());
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());
  app.use(requestLogger);

  app.get('/', (req, res) => res.redirect('/admin'));

  app.use('/api/v1', apiRoutes);
  app.use('/admin', adminRoutes);

  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
