const router = require('express').Router();
const Joi = require('joi');
const crypto = require('crypto');
const hstUser = require('../models/hstUser.model');
const { hstProtect, hstAdminOnly } = require('../middleware/hstAuth.middleware');
const { hstAudit } = require('../services/hstAudit.service');
const { hstSendWhatsApp } = require('../services/hstNotification.service');

const STAFF_ROLES = ['warden', 'accountant', 'security'];

// GET /api/v1/staff  — list all staff accounts
router.get('/', hstProtect, hstAdminOnly, async (req, res, next) => {
  try {
    const staff = await hstUser.find({ role: { $in: STAFF_ROLES } }).select('-password').sort('role name');
    res.json({ success: true, staff });
  } catch (err) { next(err); }
});

// POST /api/v1/staff  — create a staff account
router.post('/', hstProtect, hstAdminOnly, async (req, res, next) => {
  try {
    const schema = Joi.object({
      name:  Joi.string().min(2).max(100).required(),
      email: Joi.string().email().required(),
      phone: Joi.string().pattern(/^[0-9]{10}$/).required(),
      role:  Joi.string().valid(...STAFF_ROLES).required(),
    });
    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const exists = await hstUser.findOne({ email: value.email.toLowerCase() });
    if (exists) return res.status(409).json({ error: 'Email already registered' });

    const tempPassword = crypto.randomBytes(6).toString('base64url');
    const staff = await hstUser.create({ ...value, password: tempPassword, mustChangePassword: true });

    hstSendWhatsApp(value.phone,
      `Welcome to HostelMS, ${value.name}!\nRole: ${value.role}\nLogin: ${value.email}\nTemp password: ${tempPassword}\nPlease change your password on first login.`
    ).catch(() => {});

    hstAudit({ user: req.user, action: 'create', module: 'Resident', targetId: staff._id, targetLabel: `${staff.name} (${staff.role})`, req });
    res.status(201).json({ success: true, staff: { id: staff._id, name: staff.name, email: staff.email, role: staff.role } });
  } catch (err) { next(err); }
});

// PATCH /api/v1/staff/:id/deactivate — deactivate a staff account
router.patch('/:id/deactivate', hstProtect, hstAdminOnly, async (req, res, next) => {
  try {
    const staff = await hstUser.findById(req.params.id);
    if (!staff || !STAFF_ROLES.includes(staff.role)) return res.status(404).json({ error: 'Staff not found' });
    staff.isActive = false;
    await staff.save();
    hstAudit({ user: req.user, action: 'delete', module: 'Resident', targetId: staff._id, targetLabel: `${staff.name} deactivated`, req });
    res.json({ success: true, message: `${staff.name} deactivated` });
  } catch (err) { next(err); }
});

module.exports = router;
