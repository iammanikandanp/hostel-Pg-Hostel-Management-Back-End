const router = require('express').Router();
const Joi = require('joi');
const hstNotice = require('../models/hstNotice.model');
const hstUser = require('../models/hstUser.model');
const { hstProtect, hstRoleCheck } = require('../middleware/hstAuth.middleware');
const { hstAudit } = require('../services/hstAudit.service');
const { hstSendWhatsApp } = require('../services/hstNotification.service');
const { hstNotify } = require('../services/hstInAppNotify.service');

const adminOrWarden = hstRoleCheck(['admin', 'warden']);

// POST /api/v1/notices  — create notice (admin/warden)
router.post('/', hstProtect, adminOrWarden, async (req, res, next) => {
  try {
    const schema = Joi.object({
      title:     Joi.string().min(3).max(150).required(),
      body:      Joi.string().min(5).max(2000).required(),
      priority:  Joi.string().valid('urgent', 'normal', 'info').default('normal'),
      expiresAt: Joi.date().min('now').allow(null).optional(),
      broadcast: Joi.boolean().default(false), // send WhatsApp to all active residents
    });
    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const { broadcast, ...noticeData } = value;
    const notice = await hstNotice.create({ ...noticeData, postedBy: req.user._id });

    const residents = await hstUser.find({ role: 'resident', isActive: true }).select('name phone _id');
    const residentIds = residents.map(r => r._id);

    if (broadcast) {
      const priorityLabel = notice.priority === 'urgent' ? '🚨 URGENT' : notice.priority === 'info' ? 'ℹ️ Info' : '📢 Notice';
      const msg = `*${priorityLabel}: ${notice.title}*\n\n${notice.body}`;
      for (const r of residents) {
        hstSendWhatsApp(r.phone, msg).catch(() => {});
      }
    }

    if (residentIds.length) {
      hstNotify(residentIds, {
        type: 'notice_posted',
        title: `New Notice: ${notice.title}`,
        message: notice.body.length > 100 ? notice.body.slice(0, 100) + '…' : notice.body,
        relatedId: notice._id,
        relatedModel: 'Notice',
      });
    }

    hstAudit({ user: req.user, action: 'create', module: 'Settings', targetId: notice._id, targetLabel: notice.title, req });
    res.status(201).json({ success: true, notice });
  } catch (err) { next(err); }
});

// GET /api/v1/notices  — all active notices (any authenticated user)
router.get('/', hstProtect, async (req, res, next) => {
  try {
    const now = new Date();
    const filter = {
      isActive: true,
      $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
    };
    const notices = await hstNotice.find(filter)
      .sort({ priority: 1, createdAt: -1 }) // urgent first (alphabetically 'u' > 'n' > 'i', but we'll sort by priority weight in frontend)
      .populate('postedBy', 'name role');
    res.json({ success: true, notices });
  } catch (err) { next(err); }
});

// GET /api/v1/notices/all  — all notices including expired (admin/warden only)
router.get('/all', hstProtect, adminOrWarden, async (req, res, next) => {
  try {
    const notices = await hstNotice.find().sort({ createdAt: -1 }).populate('postedBy', 'name role');
    res.json({ success: true, notices });
  } catch (err) { next(err); }
});

// PATCH /api/v1/notices/:id  — update/deactivate (admin/warden)
router.patch('/:id', hstProtect, adminOrWarden, async (req, res, next) => {
  try {
    const allowed = ['title', 'body', 'priority', 'expiresAt', 'isActive'];
    const updates = {};
    allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });

    const notice = await hstNotice.findByIdAndUpdate(req.params.id, updates, { returnDocument: 'after' });
    if (!notice) return res.status(404).json({ error: 'Notice not found' });

    hstAudit({ user: req.user, action: 'update', module: 'Settings', targetId: notice._id, targetLabel: notice.title, req });
    res.json({ success: true, notice });
  } catch (err) { next(err); }
});

// DELETE /api/v1/notices/:id  — delete (admin only)
router.delete('/:id', hstProtect, hstRoleCheck(['admin']), async (req, res, next) => {
  try {
    const notice = await hstNotice.findByIdAndDelete(req.params.id);
    if (!notice) return res.status(404).json({ error: 'Notice not found' });
    hstAudit({ user: req.user, action: 'delete', module: 'Settings', targetLabel: notice.title, req });
    res.json({ success: true, message: 'Notice deleted' });
  } catch (err) { next(err); }
});

module.exports = router;
