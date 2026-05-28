const router = require('express').Router();
const Joi = require('joi');
const { hstProtect, hstAdminOnly } = require('../middleware/hstAuth.middleware');
const hstAsset = require('../models/hstAsset.model');
const { hstAudit } = require('../services/hstAudit.service');

const hstStaffOrAdmin = (req, res, next) => {
  if (!['admin', 'warden'].includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
  next();
};

// GET / — list assets (filter by roomId, category, condition)
router.get('/', hstProtect, hstStaffOrAdmin, async (req, res, next) => {
  try {
    const filter = { isActive: true };
    if (req.query.roomId)   filter.roomId   = req.query.roomId;
    if (req.query.category) filter.category = req.query.category;
    if (req.query.condition)filter.condition = req.query.condition;
    const assets = await hstAsset.find(filter)
      .populate('roomId', 'roomNumber floor')
      .sort({ createdAt: -1 });
    res.json({ success: true, assets });
  } catch (err) { next(err); }
});

// GET /summary — count by category and condition
router.get('/summary', hstProtect, hstStaffOrAdmin, async (req, res, next) => {
  try {
    const [byCategory, byCondition] = await Promise.all([
      hstAsset.aggregate([
        { $match: { isActive: true } },
        { $group: { _id: '$category', count: { $sum: 1 } } },
      ]),
      hstAsset.aggregate([
        { $match: { isActive: true } },
        { $group: { _id: '$condition', count: { $sum: 1 } } },
      ]),
    ]);
    res.json({ success: true, byCategory, byCondition });
  } catch (err) { next(err); }
});

// GET /room/:roomId — assets for a specific room (used during move-out checklist)
router.get('/room/:roomId', hstProtect, hstStaffOrAdmin, async (req, res, next) => {
  try {
    const assets = await hstAsset.find({ roomId: req.params.roomId, isActive: true })
      .sort({ category: 1, name: 1 });
    res.json({ success: true, assets });
  } catch (err) { next(err); }
});

// POST / — add asset
router.post('/', hstProtect, hstAdminOnly, async (req, res, next) => {
  try {
    const schema = Joi.object({
      name:          Joi.string().min(2).max(200).required(),
      category:      Joi.string().valid('furniture', 'electronics', 'appliances', 'fixtures', 'linen', 'other').required(),
      roomId:        Joi.string().allow('', null).optional(),
      condition:     Joi.string().valid('good', 'fair', 'poor', 'damaged').optional(),
      purchaseDate:  Joi.date().allow(null).optional(),
      purchasePrice: Joi.number().min(0).allow(null).optional(),
      serialNumber:  Joi.string().max(100).allow('', null).optional(),
      notes:         Joi.string().max(500).allow('', null).optional(),
    });
    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const asset = await hstAsset.create({ ...value, addedBy: req.user._id, roomId: value.roomId || null });
    hstAudit({ user: req.user, action: 'create', module: 'Asset', targetId: asset._id, targetLabel: asset.name, req });
    res.status(201).json({ success: true, asset });
  } catch (err) { next(err); }
});

// PATCH /:id — update asset (condition, room reassignment, etc.)
router.patch('/:id', hstProtect, hstAdminOnly, async (req, res, next) => {
  try {
    const schema = Joi.object({
      name:          Joi.string().min(2).max(200).optional(),
      category:      Joi.string().valid('furniture', 'electronics', 'appliances', 'fixtures', 'linen', 'other').optional(),
      roomId:        Joi.string().allow('', null).optional(),
      condition:     Joi.string().valid('good', 'fair', 'poor', 'damaged').optional(),
      purchaseDate:  Joi.date().allow(null).optional(),
      purchasePrice: Joi.number().min(0).allow(null).optional(),
      serialNumber:  Joi.string().max(100).allow('', null).optional(),
      notes:         Joi.string().max(500).allow('', null).optional(),
      isActive:      Joi.boolean().optional(),
    });
    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    if (value.roomId === '') value.roomId = null;
    const asset = await hstAsset.findByIdAndUpdate(req.params.id, value, { returnDocument: 'after', runValidators: true })
      .populate('roomId', 'roomNumber floor');
    if (!asset) return res.status(404).json({ error: 'Asset not found' });
    hstAudit({ user: req.user, action: 'update', module: 'Asset', targetId: asset._id, targetLabel: asset.name, req });
    res.json({ success: true, asset });
  } catch (err) { next(err); }
});

// DELETE /:id — soft delete
router.delete('/:id', hstProtect, hstAdminOnly, async (req, res, next) => {
  try {
    const asset = await hstAsset.findByIdAndUpdate(req.params.id, { isActive: false }, { returnDocument: 'after' });
    if (!asset) return res.status(404).json({ error: 'Asset not found' });
    hstAudit({ user: req.user, action: 'delete', module: 'Asset', targetId: asset._id, targetLabel: asset.name, req });
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
