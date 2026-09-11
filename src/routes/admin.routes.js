const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const adminController = require('../controllers/admin.controller');
const { requireAdminSession } = require('../middleware/auth');
const { loginLimiter } = require('../middleware/rateLimit');
const config = require('../config');
const fileService = require('../services/file.service');

const router = express.Router();

if (!fs.existsSync(config.uploadsDir)) {
  fs.mkdirSync(config.uploadsDir, { recursive: true });
}

const CHAT_MAX_FILES = 15;

function chatUpload(req, res, next) {
  Promise.all([fileService.getMaxUploadBytes(), fileService.getAllowedExtensions()])
    .then(([max, allowed]) => {
      const mw = multer({
        dest: config.uploadsDir,
        limits: { fileSize: max, files: CHAT_MAX_FILES },
        fileFilter(req, file, cb) {
          const ext = path.extname(file.originalname || '').replace('.', '').toLowerCase();
          if (!allowed.includes(ext)) {
            return cb(
              new Error(
                `File type .${ext || '?'} not allowed. Allowed: ${allowed.join(', ')} (Admin → Settings)`
              )
            );
          }
          return cb(null, true);
        },
      }).array('files', CHAT_MAX_FILES);

      mw(req, res, (err) => {
        if (err) {
          const message =
            err.code === 'LIMIT_FILE_COUNT' || /too many files/i.test(err.message || '')
              ? `Too many files. Max ${CHAT_MAX_FILES} files per chat message.`
              : err.message || 'Upload failed';
          return res.status(400).json({
            status: 'error',
            data: null,
            message,
          });
        }
        return next();
      });
    })
    .catch(next);
}

router.get('/login', adminController.renderLogin);
router.post('/login', loginLimiter, adminController.postLogin);
router.get('/captcha/image', adminController.captchaImage);
router.get('/captcha/audio', adminController.captchaAudio);
router.get('/captcha/refresh', adminController.captchaRefresh);
router.post('/logout', requireAdminSession, adminController.logout);

router.get('/', requireAdminSession, adminController.dashboard);

router.get('/chat', requireAdminSession, adminController.chatPage);
router.post(
  '/chat/message',
  requireAdminSession,
  chatUpload,
  adminController.chatMessage
);

router.get('/users', requireAdminSession, adminController.usersList);
router.get('/users/create', requireAdminSession, adminController.usersCreateForm);
router.post('/users', requireAdminSession, adminController.usersCreate);
router.get('/users/:id/edit', requireAdminSession, adminController.usersEditForm);
router.post('/users/:id', requireAdminSession, adminController.usersUpdate);
router.post('/users/:id/delete', requireAdminSession, adminController.usersDelete);

router.get('/whitelist', requireAdminSession, adminController.whitelistList);
router.get('/whitelist/create', requireAdminSession, adminController.whitelistCreateForm);
router.post('/whitelist', requireAdminSession, adminController.whitelistCreate);
router.get('/whitelist/:id/edit', requireAdminSession, adminController.whitelistEditForm);
router.post('/whitelist/:id', requireAdminSession, adminController.whitelistUpdate);
router.post('/whitelist/:id/delete', requireAdminSession, adminController.whitelistDelete);

router.get('/tokens', requireAdminSession, adminController.tokensList);
router.get('/tokens/create', requireAdminSession, adminController.tokensCreateForm);
router.post('/tokens', requireAdminSession, adminController.tokensCreate);
router.post('/tokens/:id/revoke', requireAdminSession, adminController.tokensRevoke);
router.post('/tokens/:id/delete', requireAdminSession, adminController.tokensDelete);

router.get('/settings', requireAdminSession, adminController.settingsPage);
router.post('/settings', requireAdminSession, adminController.settingsUpdate);

router.get('/account/password', requireAdminSession, adminController.changePasswordPage);
router.post('/account/password', requireAdminSession, adminController.changePassword);

router.get('/logs', requireAdminSession, adminController.logsList);
router.get('/logs/data', requireAdminSession, adminController.logsData);
router.get('/logs/:id', requireAdminSession, adminController.logsDetail);

module.exports = router;
