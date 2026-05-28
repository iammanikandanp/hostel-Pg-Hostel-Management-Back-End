const router = require('express').Router();
const { hstProtect, hstAdminOnly } = require('../middleware/hstAuth.middleware');
const hstOutPass = require('../models/hstOutPass.model');
const { hstSendWhatsApp } = require('../services/hstNotification.service');
const { hstNotify } = require('../services/hstInAppNotify.service');

const fmt = (date) =>
  new Date(date).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

// ── Resident: submit out-pass request ────────────────────────────────────────
router.post('/', hstProtect, async (req, res, next) => {
  try {
    const { reason, destination, plannedOutTime, expectedReturn } = req.body;
    if (!reason || !destination || !plannedOutTime || !expectedReturn) {
      return res.status(400).json({ error: 'reason, destination, plannedOutTime, and expectedReturn are required' });
    }
    if (new Date(expectedReturn) <= new Date(plannedOutTime)) {
      return res.status(400).json({ error: 'Expected return must be after planned out time' });
    }

    const op = await hstOutPass.create({
      userId: req.user._id, reason, destination, plannedOutTime, expectedReturn,
    });

    await hstSendWhatsApp(process.env.ADMIN_PHONE,
      `🚪 *Out-Pass Request*\n\n` +
      `Resident    : ${req.user.name}\n` +
      `Destination : ${destination}\n` +
      `Planned Out : ${fmt(plannedOutTime)}\n` +
      `Return by   : ${fmt(expectedReturn)}\n` +
      `Reason      : ${reason}\n\n` +
      `Please approve or reject in the admin panel.`
    );

    res.status(201).json({ success: true, outPass: op });
  } catch (err) { next(err); }
});

// ── Admin: approve or reject ─────────────────────────────────────────────────
router.patch('/:id/status', hstProtect, hstAdminOnly, async (req, res, next) => {
  try {
    const { status, adminNote } = req.body;
    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'status must be approved or rejected' });
    }

    const now = new Date();
    const update = { status, adminNote: adminNote || null };
    if (status === 'approved') update.outTime = now; // record actual departure time

    const op = await hstOutPass.findByIdAndUpdate(req.params.id, update, { returnDocument: 'after' })
      .populate('userId', 'name phone');
    if (!op) return res.status(404).json({ error: 'Out-pass not found' });

    let msg = '';
    if (status === 'approved') {
      msg =
        `✅ *Out-Pass Approved!*\n\n` +
        `Hi ${op.userId.name},\n` +
        `Your out-pass has been approved.\n\n` +
        `Destination : ${op.destination}\n` +
        `Out Time    : ${fmt(now)}\n` +
        `Return by   : ${fmt(op.expectedReturn)}\n` +
        (adminNote ? `Note        : ${adminNote}\n` : '') +
        `\nPlease return on time. 🙏`;
    } else {
      msg =
        `❌ *Out-Pass Rejected*\n\n` +
        `Hi ${op.userId.name},\n` +
        `Your out-pass request has been rejected.\n\n` +
        `Destination : ${op.destination}\n` +
        (adminNote ? `Reason      : ${adminNote}\n` : '') +
        `\nContact admin for more information.`;
    }

    await hstSendWhatsApp(op.userId.phone, msg);
    hstNotify(op.userId._id, {
      type: status === 'approved' ? 'outpass_approved' : 'outpass_rejected',
      title: status === 'approved' ? 'Out-Pass Approved' : 'Out-Pass Rejected',
      message: status === 'approved'
        ? `Your out-pass to ${op.destination} has been approved. Return by ${fmt(op.expectedReturn)}.`
        : `Your out-pass to ${op.destination} was rejected.${adminNote ? ` Reason: ${adminNote}` : ''}`,
      relatedId: op._id,
      relatedModel: 'OutPass',
    });
    res.json({ success: true, outPass: op });
  } catch (err) { next(err); }
});

// ── Resident: mark returned ──────────────────────────────────────────────────
router.patch('/:id/return', hstProtect, async (req, res, next) => {
  try {
    const op = await hstOutPass.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      { actualReturnTime: new Date(), status: 'returned' },
      { returnDocument: 'after' }
    ).populate('userId', 'name phone');
    if (!op) return res.status(404).json({ error: 'Out-pass not found' });

    // Notify admin that resident returned
    await hstSendWhatsApp(process.env.ADMIN_PHONE,
      `✅ *Returned*\n\n` +
      `${op.userId.name} has returned to the hostel.\n` +
      `Destination : ${op.destination}\n` +
      `Returned at : ${fmt(op.actualReturnTime)}\n` +
      `Expected was: ${fmt(op.expectedReturn)}`
    );

    res.json({ success: true, outPass: op });
  } catch (err) { next(err); }
});

// ── Resident: request extension ──────────────────────────────────────────────
router.post('/:id/extension', hstProtect, async (req, res, next) => {
  try {
    const { extendedReturn, extensionReason } = req.body;
    if (!extendedReturn || !extensionReason) {
      return res.status(400).json({ error: 'extendedReturn and extensionReason are required' });
    }

    const op = await hstOutPass.findOne({ _id: req.params.id, userId: req.user._id })
      .populate('userId', 'name phone');
    if (!op) return res.status(404).json({ error: 'Out-pass not found' });
    if (op.status !== 'approved') return res.status(400).json({ error: 'Can only extend an approved out-pass' });
    if (new Date(extendedReturn) <= new Date(op.expectedReturn)) {
      return res.status(400).json({ error: 'New return time must be later than current expected return' });
    }

    op.extensionRequested  = true;
    op.extensionReason     = extensionReason;
    op.extendedReturn      = new Date(extendedReturn);
    op.extensionStatus     = 'pending';
    op.extensionAdminNote  = null;
    await op.save();

    // Notify admin
    await hstSendWhatsApp(process.env.ADMIN_PHONE,
      `⏰ *Extension Request*\n\n` +
      `Resident    : ${op.userId.name}\n` +
      `Destination : ${op.destination}\n` +
      `Current return : ${fmt(op.expectedReturn)}\n` +
      `Wants to extend to : ${fmt(extendedReturn)}\n` +
      `Reason      : ${extensionReason}\n\n` +
      `Please approve or reject in the admin panel.`
    );

    res.json({ success: true, outPass: op });
  } catch (err) { next(err); }
});

// ── Admin: approve or reject extension ──────────────────────────────────────
router.patch('/:id/extension/status', hstProtect, hstAdminOnly, async (req, res, next) => {
  try {
    const { status, adminNote } = req.body;
    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'status must be approved or rejected' });
    }

    const op = await hstOutPass.findById(req.params.id).populate('userId', 'name phone');
    if (!op) return res.status(404).json({ error: 'Out-pass not found' });
    if (!op.extensionRequested || op.extensionStatus !== 'pending') {
      return res.status(400).json({ error: 'No pending extension request' });
    }

    op.extensionStatus    = status;
    op.extensionAdminNote = adminNote || null;
    if (status === 'approved') {
      op.expectedReturn = op.extendedReturn; // update the return deadline
      op.overdueSent    = false;             // reset overdue flag for new time
      op.reminderSent   = false;
    }
    await op.save();

    let msg = '';
    if (status === 'approved') {
      msg =
        `✅ *Extension Approved!*\n\n` +
        `Hi ${op.userId.name},\n` +
        `Your return time has been extended.\n\n` +
        `New return by : ${fmt(op.expectedReturn)}\n` +
        (adminNote ? `Note          : ${adminNote}\n` : '') +
        `\nPlease return by the new time. 🙏`;
    } else {
      msg =
        `❌ *Extension Rejected*\n\n` +
        `Hi ${op.userId.name},\n` +
        `Your extension request was not approved.\n\n` +
        `You must return by : ${fmt(op.expectedReturn)}\n` +
        (adminNote ? `Reason         : ${adminNote}\n` : '') +
        `\nPlease return immediately.`;
    }

    await hstSendWhatsApp(op.userId.phone, msg);
    hstNotify(op.userId._id, {
      type: status === 'approved' ? 'extension_approved' : 'extension_rejected',
      title: status === 'approved' ? 'Extension Approved' : 'Extension Rejected',
      message: status === 'approved'
        ? `Your return extension has been approved. New deadline: ${fmt(op.expectedReturn)}.`
        : `Your extension request was rejected.${adminNote ? ` Reason: ${adminNote}` : ''} Return by original time.`,
      relatedId: op._id,
      relatedModel: 'OutPass',
    });
    res.json({ success: true, outPass: op });
  } catch (err) { next(err); }
});

// ── List: admin sees all, resident sees own ──────────────────────────────────
router.get('/', hstProtect, async (req, res, next) => {
  try {
    const filter = req.user.role === 'admin' ? {} : { userId: req.user._id };
    const passes = await hstOutPass.find(filter)
      .populate('userId', 'name phone roomId')
      .sort('-createdAt');
    res.json({ success: true, passes });
  } catch (err) { next(err); }
});

// ── Admin: pending count ─────────────────────────────────────────────────────
router.get('/pending/count', hstProtect, hstAdminOnly, async (req, res, next) => {
  try {
    const count = await hstOutPass.countDocuments({ status: 'pending' });
    res.json({ success: true, count });
  } catch (err) { next(err); }
});

module.exports = router;
