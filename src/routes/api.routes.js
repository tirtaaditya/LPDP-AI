const path = require('path');
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const authController = require('../controllers/auth.controller');
const extractController = require('../controllers/extract.controller');
const { authenticateApi } = require('../middleware/auth');
const { ipWhitelist } = require('../middleware/ipWhitelist');
const { apiLimiter, loginLimiter } = require('../middleware/rateLimit');
const config = require('../config');
const fileService = require('../services/file.service');

const router = express.Router();

if (!fs.existsSync(config.uploadsDir)) {
  fs.mkdirSync(config.uploadsDir, { recursive: true });
}

/**
 * Optional multipart parser for file_uploads[] (multiple files).
 * JSON-only requests skip multer.
 */
function extractUpload(req, res, next) {
  const ct = String(req.headers['content-type'] || '');
  if (!ct.includes('multipart/form-data')) {
    return next();
  }

  Promise.all([fileService.getMaxUploadBytes(), fileService.getAllowedExtensions()])
    .then(([max, allowed]) => {
      const mw = multer({
        dest: config.uploadsDir,
        limits: {
          fileSize: max,
          files: fileService.MAX_FILES,
        },
        fileFilter(req, file, cb) {
          const ext = path.extname(file.originalname || '').replace('.', '').toLowerCase();
          if (!allowed.includes(ext)) {
            const err = new Error(
              `File type .${ext || '?'} not allowed. Allowed: ${allowed.join(', ')} (Admin → Settings)`
            );
            err.code = 'FILE_TYPE_NOT_ALLOWED';
            return cb(err);
          }
          return cb(null, true);
        },
      }).array('file_uploads', fileService.MAX_FILES);

      mw(req, res, (err) => {
        if (err) {
          const status = err.code === 'LIMIT_FILE_SIZE' || err.code === 'LIMIT_FILE_COUNT' ? 400 : 400;
          let message = err.message || 'Upload failed';
          if (err.code === 'LIMIT_FILE_SIZE') {
            message = `File too large. Max upload size is configured in Admin → Settings.`;
          }
          if (err.code === 'LIMIT_FILE_COUNT') {
            message = `Too many file_uploads. Max ${fileService.MAX_FILES} files per request`;
          }
          return res.status(status).json({
            status: 'error',
            data: { error_code: err.code || 'UPLOAD_FAILED' },
            message,
          });
        }
        return next();
      });
    })
    .catch(next);
}

router.get('/health', (req, res) => {
  res.json({ status: 'success', data: { ok: true } });
});

router.post('/auth/login', loginLimiter, authController.login);

router.post(
  '/extract',
  apiLimiter,
  authenticateApi,
  ipWhitelist,
  extractUpload,
  extractController.extract
);

module.exports = router;
