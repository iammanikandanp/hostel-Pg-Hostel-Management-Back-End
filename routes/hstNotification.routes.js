const router = require('express').Router();
const hstNotification = require('../models/hstNotification.model');
const { hstProtect } = require('../middleware/hstAuth.middleware');

// GET /api/v1/notifications  — get current user's notifications
router.get('/', hstProtect, async (req, res, next) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip  = (parseInt(page) - 1) * parseInt(limit);
    const total = await hstNotification.countDocuments({ userId: req.user._id });
    const unread = await hstNotification.countDocuments({ userId: req.user._id, isRead: false });
    const notifications = await hstNotification
      .find({ userId: req.user._id })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    res.json({ success: true, total, unread, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)), notifications });
  } catch (err) { next(err); }
});

// GET /api/v1/notifications/unread-count  — lightweight count for bell badge
router.get('/unread-count', hstProtect, async (req, res, next) => {
  try {
    const count = await hstNotification.countDocuments({ userId: req.user._id, isRead: false });
    res.json({ success: true, count });
  } catch (err) { next(err); }
});

// PATCH /api/v1/notifications/read-all  — mark all as read (must be before /:id/read)
router.patch('/read-all', hstProtect, async (req, res, next) => {
  try {
    await hstNotification.updateMany({ userId: req.user._id, isRead: false }, { isRead: true });
    res.json({ success: true });
  } catch (err) { next(err); }
});

// PATCH /api/v1/notifications/:id/read  — mark one as read
router.patch('/:id/read', hstProtect, async (req, res, next) => {
  try {
    await hstNotification.findOneAndUpdate({ _id: req.params.id, userId: req.user._id }, { isRead: true });
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
