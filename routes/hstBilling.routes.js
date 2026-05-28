const router = require('express').Router();
const { hstProtect, hstAdminOnly } = require('../middleware/hstAuth.middleware');
const {
  hstGenerateBills,
  hstGetAllBills,
  hstGetMyBills,
  hstMarkPaid,
  hstGetSettings,
  hstUpdateSettings,
  hstRecalculateRoomBills,
  hstSendBillReminders,
  hstSendSingleReminder,
} = require('../controllers/hstBilling.controller');

router.post('/generate',          hstProtect, hstAdminOnly, hstGenerateBills);
router.post('/recalculate-room',  hstProtect, hstAdminOnly, hstRecalculateRoomBills);
router.post('/send-reminders',        hstProtect, hstAdminOnly, hstSendBillReminders);
router.post('/send-reminder-single', hstProtect, hstAdminOnly, hstSendSingleReminder);
router.get('/all',                hstProtect, hstAdminOnly, hstGetAllBills);
router.get('/my',                 hstProtect,               hstGetMyBills);
router.patch('/:id/paid',         hstProtect, hstAdminOnly, hstMarkPaid);
router.get('/settings',           hstProtect,               hstGetSettings);
router.patch('/settings',         hstProtect, hstAdminOnly, hstUpdateSettings);

module.exports = router;
