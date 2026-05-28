const router = require('express').Router();
const { hstProtect, hstAdminOnly } = require('../middleware/hstAuth.middleware');
const hstUpload = require('../middleware/hstUpload.middleware');
const {
  submitComplaint,
  myComplaints,
  allComplaints,
  updateStatus,
  deleteComplaint,
} = require('../controllers/hstComplaint.controller');

const upload = hstUpload.array('complaintPhotos', 5);

// Resident routes
router.post('/',     hstProtect, upload, submitComplaint);
router.get('/mine',  hstProtect, myComplaints);

// Admin routes
router.get('/',          hstProtect, hstAdminOnly, allComplaints);
router.patch('/:id',     hstProtect, hstAdminOnly, updateStatus);
router.delete('/:id',    hstProtect, hstAdminOnly, deleteComplaint);

module.exports = router;
