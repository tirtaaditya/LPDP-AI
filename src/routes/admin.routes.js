const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const adminController = require('../controllers/admin.controller');
const { requireAdminSession } = require('../middleware/auth');
const config = require('../config');
const fileService = require('../services/file.service');

const router = express.Router();

if (!fs.existsSync(config.uploadsDir)) {
  fs.mkdirSync(config.uploadsDir, { recursive: true });
}

function chatUpload(req, res, next) {
  fileService
    .getMaxUploadBytes()
    .then((max) => {
      const mw = multer({
        dest: config.uploadsDir,
        limits: { fileSize: max, files: 5 },
        fileFilter(req, file, cb) {
          const ext = path.extname(file.originalname || '').replace('.', '').toLowerCase();
          const ok = ['pdf', 'docx', 'txt'].includes(ext);
          if (!ok) {
            return cb(new Error('Only pdf, docx, txt are allowed'));
          }
          return cb(null, true);
        },
      }).array('files', 5);

      mw(req, res, (err) => {
        if (err) {
          return res.status(400).json({
            status: 'error',
            data: null,
            message: err.message || 'Upload failed',
          });
        }
        return next();
      });
    })
    .catch(next);
}

router.get('/login', adminController.renderLogin);
router.post('/login', adminController.postLogin);
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
