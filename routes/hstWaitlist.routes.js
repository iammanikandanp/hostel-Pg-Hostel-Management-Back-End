const router = require('express').Router();
const Joi = require('joi');
const { hstProtect, hstAdminOnly } = require('../middleware/hstAuth.middleware');
const hstWaitlist = require('../models/hstWaitlist.model');
const { hstAudit } = require('../services/hstAudit.service');

// GET / — list all waitlist entries (filtered by status)
router.get('/', hstProtect, hstAdminOnly, async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    const list = await hstWaitlist.find(filter).sort({ createdAt: 1 });
    res.json({ success: true, waitlist: list });
  } catch (err) { next(err); }
});

// POST / — add to waitlist
router.post('/', hstProtect, hstAdminOnly, async (req, res, next) => {
  try {
    const schema = Joi.object({
      name:     Joi.string().min(2).max(100).required(),
      email:    Joi.string().email().required(),
      phone:    Joi.string().pattern(/^[0-9]{10}$/).required(),
      roomType: Joi.string().valid('single', 'double', 'triple', 'any').default('any'),
      notes:    Joi.string().max(500).allow('', null).optional(),
    });
    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const entry = await hstWaitlist.create({ ...value, addedBy: req.user._id });
    hstAudit({ user: req.user, action: 'create', module: 'Waitlist', targetId: entry._id, targetLabel: entry.name, req });
    res.status(201).json({ success: true, entry });
  } catch (err) { next(err); }
});

// PATCH /:id — update status or notes
router.patch('/:id', hstProtect, hstAdminOnly, async (req, res, next) => {
  try {
    const schema = Joi.object({
      status:   Joi.string().valid('waiting', 'offered', 'converted', 'cancelled').optional(),
      notes:    Joi.string().max(500).allow('', null).optional(),
      roomType: Joi.string().valid('single', 'double', 'triple', 'any').optional(),
    });
    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const entry = await hstWaitlist.findById(req.params.id);
    if (!entry) return res.status(404).json({ error: 'Entry not found' });

    if (value.status === 'offered' && entry.status !== 'offered') value.offeredAt = new Date();
    Object.assign(entry, value);
    await entry.save();

    hstAudit({ user: req.user, action: 'update', module: 'Waitlist', targetId: entry._id, targetLabel: entry.name, req });
    res.json({ success: true, entry });
  } catch (err) { next(err); }
});

// DELETE /:id
router.delete('/:id', hstProtect, hstAdminOnly, async (req, res, next) => {
  try {
    const entry = await hstWaitlist.findByIdAndDelete(req.params.id);
    if (!entry) return res.status(404).json({ error: 'Entry not found' });
    hstAudit({ user: req.user, action: 'delete', module: 'Waitlist', targetId: entry._id, targetLabel: entry.name, req });
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
