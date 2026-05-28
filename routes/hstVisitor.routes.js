const router = require('express').Router();
const Joi = require('joi');
const hstVisitor = require('../models/hstVisitor.model');
const hstUser = require('../models/hstUser.model');
const { hstProtect, hstRoleCheck } = require('../middleware/hstAuth.middleware');
const { hstAudit } = require('../services/hstAudit.service');
const { hstSendWhatsApp } = require('../services/hstNotification.service');

const staffAndSecurity = hstRoleCheck(['admin', 'warden', 'security']);

// POST /api/v1/visitors  — log a visitor in
router.post('/', hstProtect, staffAndSecurity, async (req, res, next) => {
  try {
    const schema = Joi.object({
      residentId:   Joi.string().required(),
      visitorName:  Joi.string().min(2).max(100).required(),
      visitorPhone: Joi.string().pattern(/^[0-9]{10}$/).required(),
      idProofType:  Joi.string().valid('Aadhar','PAN','Driving Licence','Passport','Voter ID','Other').optional(),
      idProofNumber:Joi.string().max(30).allow('', null).optional(),
      purpose:      Joi.string().max(200).allow('', null).optional(),
    });
    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const resident = await hstUser.findById(value.residentId).populate('roomId', 'roomNumber');
    if (!resident || !resident.isActive) return res.status(404).json({ error: 'Resident not found' });

    const visitor = await hstVisitor.create({
      ...value,
      residentRoom: resident.roomId?.roomNumber ?? null,
      loggedBy: req.user._id,
    });

    // Notify resident on WhatsApp
    hstSendWhatsApp(resident.phone,
      `👥 *Visitor Logged*\n\n` +
      `Hi ${resident.name}! A visitor has arrived for you.\n\n` +
      `Visitor : ${value.visitorName}\n` +
      `Phone   : ${value.visitorPhone}\n` +
      `Purpose : ${value.purpose || 'Not specified'}\n` +
      `Time    : ${new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}`
    ).catch(() => {});

    hstAudit({ user: req.user, action: 'create', module: 'Resident', targetId: visitor._id, targetLabel: `Visitor ${value.visitorName} for ${resident.name}`, req });
    res.status(201).json({ success: true, visitor });
  } catch (err) { next(err); }
});

// PATCH /api/v1/visitors/:id/exit  — log visitor out
router.patch('/:id/exit', hstProtect, staffAndSecurity, async (req, res, next) => {
  try {
    const visitor = await hstVisitor.findById(req.params.id);
    if (!visitor) return res.status(404).json({ error: 'Visitor log not found' });
    if (visitor.status === 'exited') return res.status(400).json({ error: 'Already marked as exited' });

    visitor.exitTime = new Date();
    visitor.status   = 'exited';
    await visitor.save();

    hstAudit({ user: req.user, action: 'update', module: 'Resident', targetId: visitor._id, targetLabel: `${visitor.visitorName} exited`, req });
    res.json({ success: true, visitor });
  } catch (err) { next(err); }
});

// GET /api/v1/visitors  — list all visitors (admin/warden/security), filterable
router.get('/', hstProtect, staffAndSecurity, async (req, res, next) => {
  try {
    const { status, date, page = 1, limit = 30 } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (date) {
      const d = new Date(date);
      const next = new Date(d); next.setDate(next.getDate() + 1);
      filter.entryTime = { $gte: d, $lt: next };
    }
    const skip  = (parseInt(page) - 1) * parseInt(limit);
    const total = await hstVisitor.countDocuments(filter);
    const visitors = await hstVisitor
      .find(filter)
      .sort({ entryTime: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate('residentId', 'name phone')
      .populate('loggedBy', 'name role');

    res.json({ success: true, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)), visitors });
  } catch (err) { next(err); }
});

// GET /api/v1/visitors/today/inside  — residents currently inside (for gate display)
router.get('/today/inside', hstProtect, staffAndSecurity, async (req, res, next) => {
  try {
    const visitors = await hstVisitor
      .find({ status: 'inside' })
      .sort({ entryTime: -1 })
      .populate('residentId', 'name phone');
    res.json({ success: true, visitors });
  } catch (err) { next(err); }
});

module.exports = router;
