const express = require('express');
const authController = require('../controllers/auth.controller');
const extractController = require('../controllers/extract.controller');
const { authenticateApi } = require('../middleware/auth');
const { ipWhitelist } = require('../middleware/ipWhitelist');
const { apiLimiter, loginLimiter } = require('../middleware/rateLimit');

const router = express.Router();

router.get('/health', (req, res) => {
  res.json({ status: 'success', data: { ok: true } });
});

router.post('/auth/login', loginLimiter, authController.login);

router.post(
  '/extract',
  apiLimiter,
  authenticateApi,
  ipWhitelist,
  extractController.extract
);

module.exports = router;
