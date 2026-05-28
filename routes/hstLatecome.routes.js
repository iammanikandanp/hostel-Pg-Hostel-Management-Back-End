const router = require('express').Router();
const { hstProtect, hstAdminOnly } = require('../middleware/hstAuth.middleware');
const hstLatecome = require('../models/hstLatecome.model');
const { hstSendWhatsApp } = require('../services/hstNotification.service');

const fmt = (d) => new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

// ── Resident: submit late come request ───────────────────────────────────────
router.post('/', hstProtect, async (req, res, next) => {
  try {
    const { reason, expectedArrival } = req.body;
    if (!reason || !expectedArrival) {
      return res.status(400).json({ error: 'reason and expectedArrival are required' });
    }
    if (new Date(expectedArrival) <= new Date()) {
      return res.status(400).json({ error: 'Expected arrival must be in the future' });
    }

    const lc = await hstLatecome.create({
      userId: req.user._id, reason, expectedArrival,
    });

    await hstSendWhatsApp(process.env.ADMIN_PHONE,
      `🌙 *Late Come Request*\n\n` +
      `Resident         : ${req.user.name}\n` +
      `Expected Arrival : ${fmt(expectedArrival)}\n` +
      `Reason           : ${reason}\n\n` +
      `Please approve or reject in the admin panel.`
    );

    res.status(201).json({ success: true, latecome: lc });
  } catch (err) { next(err); }
});

// ── Admin: approve or reject ─────────────────────────────────────────────────
router.patch('/:id/status', hstProtect, hstAdminOnly, async (req, res, next) => {
  try {
    const { status, adminNote } = req.body;
    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'status must be approved or rejected' });
    }

    const lc = await hstLatecome.findByIdAndUpdate(
      req.params.id,
      { status, adminNote: adminNote || null },
      { returnDocument: 'after' }
    ).populate('userId', 'name phone');
    if (!lc) return res.status(404).json({ error: 'Request not found' });

    let msg = '';
    if (status === 'approved') {
      msg =
        `✅ *Late Come Approved!*\n\n` +
        `Hi ${lc.userId.name},\n` +
        `Your late come request has been approved.\n\n` +
        `Expected Arrival : ${fmt(lc.expectedArrival)}\n` +
        (adminNote ? `Note             : ${adminNote}\n` : '') +
        `\nPlease arrive by the requested time and mark your arrival in the app. 🙏`;
    } else {
      msg =
        `❌ *Late Come Rejected*\n\n` +
        `Hi ${lc.userId.name},\n` +
        `Your late come request has not been approved.\n\n` +
        (adminNote ? `Reason : ${adminNote}\n` : '') +
        `\nPlease return before closing time. Contact admin if urgent.`;
    }

    await hstSendWhatsApp(lc.userId.phone, msg);
    res.json({ success: true, latecome: lc });
  } catch (err) { next(err); }
});

// ── Resident: mark arrived ───────────────────────────────────────────────────
router.patch('/:id/arrived', hstProtect, async (req, res, next) => {
  try {
    const lc = await hstLatecome.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id, status: 'approved' },
      { actualArrival: new Date(), status: 'arrived' },
      { returnDocument: 'after' }
    ).populate('userId', 'name phone');
    if (!lc) return res.status(404).json({ error: 'Request not found or not approved' });

    await hstSendWhatsApp(process.env.ADMIN_PHONE,
      `✅ *Resident Arrived*\n\n` +
      `${lc.userId.name} has arrived at the hostel.\n` +
      `Arrived at       : ${fmt(lc.actualArrival)}\n` +
      `Expected Arrival : ${fmt(lc.expectedArrival)}`
    );

    res.json({ success: true, latecome: lc });
  } catch (err) { next(err); }
});

// ── List: admin sees all, resident sees own ──────────────────────────────────
router.get('/', hstProtect, async (req, res, next) => {
  try {
    const filter = req.user.role === 'admin' ? {} : { userId: req.user._id };
    const requests = await hstLatecome.find(filter)
      .populate('userId', 'name phone roomId')
      .sort('-createdAt');
    res.json({ success: true, requests });
  } catch (err) { next(err); }
});

// ── Admin: pending count (for navbar badge) ──────────────────────────────────
router.get('/pending/count', hstProtect, hstAdminOnly, async (req, res, next) => {
  try {
    const count = await hstLatecome.countDocuments({ status: 'pending' });
    res.json({ success: true, count });
  } catch (err) { next(err); }
});

module.exports = router;
