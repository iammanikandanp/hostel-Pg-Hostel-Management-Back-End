const router = require('express').Router();
const { hstProtect, hstAdminOnly } = require('../middleware/hstAuth.middleware');
const { hstGetAuditLogs } = require('../controllers/hstAuditLog.controller');

router.get('/', hstProtect, hstAdminOnly, hstGetAuditLogs);

module.exports = router;
