const router = require('express').Router();
const Joi = require('joi');
const { hstProtect, hstAdminOnly } = require('../middleware/hstAuth.middleware');
const hstMaintenanceTask = require('../models/hstMaintenanceTask.model');
const { hstAudit } = require('../services/hstAudit.service');

const hstStaffOrAdmin = (req, res, next) => {
  if (!['admin', 'warden'].includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
  next();
};

function nextDueFromFrequency(frequency, from = new Date()) {
  const d = new Date(from);
  switch (frequency) {
    case 'daily':     d.setDate(d.getDate() + 1); break;
    case 'weekly':    d.setDate(d.getDate() + 7); break;
    case 'monthly':   d.setMonth(d.getMonth() + 1); break;
    case 'quarterly': d.setMonth(d.getMonth() + 3); break;
    case 'yearly':    d.setFullYear(d.getFullYear() + 1); break;
  }
  return d;
}

// GET / — list tasks (upcoming + overdue)
router.get('/', hstProtect, hstStaffOrAdmin, async (req, res, next) => {
  try {
    const filter = { isActive: true };
    if (req.query.overdue === 'true') filter.nextDueDate = { $lt: new Date() };
    const tasks = await hstMaintenanceTask.find(filter).sort({ nextDueDate: 1 });
    res.json({ success: true, tasks });
  } catch (err) { next(err); }
});

// POST / — create task
router.post('/', hstProtect, hstAdminOnly, async (req, res, next) => {
  try {
    const schema = Joi.object({
      taskName:    Joi.string().min(2).max(200).required(),
      description: Joi.string().max(500).allow('', null).optional(),
      frequency:   Joi.string().valid('daily', 'weekly', 'monthly', 'quarterly', 'yearly').required(),
      nextDueDate: Joi.date().required(),
      assignedTo:  Joi.string().max(100).allow('', null).optional(),
    });
    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const task = await hstMaintenanceTask.create(value);
    hstAudit({ user: req.user, action: 'create', module: 'Maintenance', targetId: task._id, targetLabel: task.taskName, req });
    res.status(201).json({ success: true, task });
  } catch (err) { next(err); }
});

// PATCH /:id — update task info
router.patch('/:id', hstProtect, hstAdminOnly, async (req, res, next) => {
  try {
    const schema = Joi.object({
      taskName:    Joi.string().min(2).max(200).optional(),
      description: Joi.string().max(500).allow('', null).optional(),
      frequency:   Joi.string().valid('daily', 'weekly', 'monthly', 'quarterly', 'yearly').optional(),
      nextDueDate: Joi.date().optional(),
      assignedTo:  Joi.string().max(100).allow('', null).optional(),
      isActive:    Joi.boolean().optional(),
    });
    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const task = await hstMaintenanceTask.findByIdAndUpdate(req.params.id, value, { returnDocument: 'after', runValidators: true });
    if (!task) return res.status(404).json({ error: 'Task not found' });
    res.json({ success: true, task });
  } catch (err) { next(err); }
});

// POST /:id/complete — mark completed, advance nextDueDate
router.post('/:id/complete', hstProtect, hstStaffOrAdmin, async (req, res, next) => {
  try {
    const task = await hstMaintenanceTask.findById(req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found' });

    task.completionHistory.push({
      completedAt: new Date(),
      completedBy: req.user._id,
      note:        req.body.note ?? null,
    });
    task.nextDueDate   = nextDueFromFrequency(task.frequency);
    task.reminderSent  = false;
    await task.save();

    hstAudit({ user: req.user, action: 'update', module: 'Maintenance', targetId: task._id, targetLabel: `${task.taskName} completed`, req });
    res.json({ success: true, task });
  } catch (err) { next(err); }
});

// DELETE /:id — deactivate (soft delete)
router.delete('/:id', hstProtect, hstAdminOnly, async (req, res, next) => {
  try {
    const task = await hstMaintenanceTask.findByIdAndUpdate(req.params.id, { isActive: false }, { returnDocument: 'after' });
    if (!task) return res.status(404).json({ error: 'Task not found' });
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
