const router = require('express').Router();
const { hstAuthLimiter } = require('../middleware/hstRateLimit.middleware');
const { hstProtect } = require('../middleware/hstAuth.middleware');
const {
  hstRegisterAdmin,
  hstLogin,
  hstLogout,
  hstChangePassword,
  hstMe,
  hstVerifyOtp,
  hstToggle2FA,
  hstRefresh,
  hstGetSessions,
  hstRevokeSession,
  hstRevokeAllSessions,
  hstAdminRevokeUserSessions,
} = require('../controllers/hstAuth.controller');
const { hstAdminOnly } = require('../middleware/hstAuth.middleware');

router.post('/register-admin',   hstAuthLimiter, hstRegisterAdmin);
router.post('/login',            hstAuthLimiter, hstLogin);
router.post('/verify-otp',       hstAuthLimiter, hstVerifyOtp);
router.post('/refresh',          hstAuthLimiter, hstRefresh);
router.post('/logout',           hstProtect,     hstLogout);
router.patch('/change-password', hstProtect,     hstChangePassword);
router.patch('/2fa',             hstProtect,     hstToggle2FA);
router.get('/me',                hstProtect,     hstMe);
router.get('/sessions',          hstProtect,     hstGetSessions);
router.delete('/sessions/all',   hstProtect,     hstRevokeAllSessions);
router.delete('/sessions/user/:userId', hstProtect, hstAdminOnly, hstAdminRevokeUserSessions);
router.delete('/sessions/:sessionId',   hstProtect, hstRevokeSession);

module.exports = router;
