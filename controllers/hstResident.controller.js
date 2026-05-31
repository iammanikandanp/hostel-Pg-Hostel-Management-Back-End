const Joi = require('joi');
const crypto = require('crypto');
const hstUser = require('../models/hstUser.model');
const hstRoom = require('../models/hstRoom.model');
const { hstSendWhatsApp, hstSendEmail } = require('../services/hstNotification.service');
const { hstAudit } = require('../services/hstAudit.service');

exports.hstGetAllResidents = async (req, res, next) => {
  try {
    const residents = await hstUser.find({ role: 'resident' })
      .populate('roomId', 'roomNumber floor')
      .select('-password')
      .sort({ createdAt: -1 });
    res.json({ success: true, residents });
  } catch (err) { next(err); }
};

exports.hstAddResident = async (req, res, next) => {
  try {
    const schema = Joi.object({
      name:          Joi.string().min(2).max(100).required(),
      email:         Joi.string().email().required(),
      phone:         Joi.string().pattern(/^[0-9]{10}$/).required(),
      moveInDate:    Joi.date().required(),
      guardianName:  Joi.string().max(100).allow('', null).optional(),
      guardianPhone: Joi.string().pattern(/^[0-9]{10}$/).allow('', null).optional(),
      aadharNumber:  Joi.string().pattern(/^[0-9]{12}$/).allow('', null).optional(),
      billRent:        Joi.boolean().optional(),
      billElectricity: Joi.boolean().optional(),
      billFood:        Joi.boolean().optional(),
      depositAmount:   Joi.number().min(0).optional(),
    });
    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const tempPassword = crypto.randomBytes(6).toString('base64url');
    const { billRent, billElectricity, billFood, depositAmount, ...residentFields } = value;

    const files = req.files ?? {};
    const resident = await hstUser.create({
      ...residentFields,
      password:        tempPassword,
      role:            'resident',
      profilePhotoUrl: files.profilePhoto?.[0]?.path || null,
      idProofUrl:      files.idProof?.[0]?.path      || null,
      mustChangePassword: true,
      billComponents: {
        rent:        billRent        ?? true,
        electricity: billElectricity ?? true,
        food:        billFood        ?? true,
      },
      ...(depositAmount > 0 && {
        securityDeposit: { amount: depositAmount, status: 'held' },
      }),
    });

    await hstSendWhatsApp(value.phone,
      `Welcome to the hostel, ${value.name}!\nLogin: ${value.email}\nTemp password: ${tempPassword}\nPlease change your password on first login.`
    );

    hstAudit({ user: req.user, action: 'create', module: 'Resident', targetId: resident._id, targetLabel: resident.name, req });
    res.status(201).json({
      success: true,
      resident: { id: resident._id, name: resident.name, email: resident.email },
    });
  } catch (err) { next(err); }
};

exports.hstMoveOut = async (req, res, next) => {
  try {
    const user = await hstUser.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'Resident not found' });

    const now = new Date();

    if (user.roomId) {
      const oldRoom = await hstRoom.findById(user.roomId).select('roomNumber floor');
      if (oldRoom) {
        user.roomHistory.push({
          roomId:     oldRoom._id,
          roomNumber: oldRoom.roomNumber,
          floor:      oldRoom.floor,
          fromDate:   user.moveInDate || user.createdAt,
          toDate:     now,
          movedBy:    req.user._id,
          note:       'Move-out',
        });
      }
      await hstRoom.findByIdAndUpdate(user.roomId, { $pull: { members: user._id } });
      user.roomId = null;
    }
    user.isActive   = false;
    user.moveOutDate = now;

    // Mark deposit as closed only if no deposit was collected
    if (!user.securityDeposit?.amount) {
      user.securityDeposit.status = 'closed';
    }

    await user.save();

    hstAudit({ user: req.user, action: 'moveout', module: 'Resident', targetId: user._id, targetLabel: user.name, req });
    res.json({ success: true, message: `${user.name} moved out and archived` });
  } catch (err) { next(err); }
};

exports.hstGetMyProfile = async (req, res, next) => {
  try {
    const user = await hstUser.findById(req.user._id)
      .populate('roomId', 'roomNumber floor type')
      .select('-password');
    res.json({ success: true, user });
  } catch (err) { next(err); }
};

// PATCH /api/v1/residents/me — resident self-service profile update
exports.hstUpdateMyProfile = async (req, res, next) => {
  try {
    const schema = Joi.object({
      phone:         Joi.string().pattern(/^[0-9]{10}$/).optional(),
      guardianName:  Joi.string().max(100).allow('', null).optional(),
      guardianPhone: Joi.string().pattern(/^[0-9]{10}$/).allow('', null).optional(),
    });
    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const user = await hstUser.findById(req.user._id);

    Object.assign(user, value);
    if (req.file?.path) user.profilePhotoUrl = req.file.path;

    await user.save();
    const updated = await hstUser.findById(user._id).populate('roomId', 'roomNumber floor type').select('-password');
    hstAudit({ user: req.user, action: 'update', module: 'Resident', targetId: user._id, targetLabel: 'Self-profile update', req });
    res.json({ success: true, user: updated });
  } catch (err) { next(err); }
};

exports.hstGetResident = async (req, res, next) => {
  try {
    const resident = await hstUser.findById(req.params.id)
      .populate('roomId', 'roomNumber floor capacity')
      .select('-password');
    if (!resident) return res.status(404).json({ error: 'Resident not found' });
    res.json({ success: true, resident });
  } catch (err) { next(err); }
};

exports.hstUpdateResident = async (req, res, next) => {
  try {
    const schema = Joi.object({
      name:          Joi.string().min(2).max(100).optional(),
      phone:         Joi.string().pattern(/^[0-9]{10}$/).optional(),
      moveInDate:    Joi.date().optional(),
      guardianName:  Joi.string().max(100).allow('', null).optional(),
      guardianPhone: Joi.string().pattern(/^[0-9]{10}$/).allow('', null).optional(),
      aadharNumber:  Joi.string().pattern(/^[0-9]{12}$/).allow('', null).optional(),
      billRent:        Joi.boolean().optional(),
      billElectricity: Joi.boolean().optional(),
      billFood:        Joi.boolean().optional(),
      depositAmount:   Joi.number().min(0).optional(),
      depositStatus:   Joi.string().valid('held', 'partially_refunded', 'refunded', 'closed').optional(),
      depositRefundedAmount: Joi.number().min(0).optional(),
      depositRefundDate:     Joi.date().allow(null).optional(),
      depositDeductionNotes: Joi.string().max(500).allow('', null).optional(),
    });
    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const user = await hstUser.findById(req.params.id);
    if (!user || user.role !== 'resident') return res.status(404).json({ error: 'Resident not found' });

    const { billRent, billElectricity, billFood, depositAmount, depositStatus, depositRefundedAmount, depositRefundDate, depositDeductionNotes, ...fields } = value;
    const files = req.files ?? {};
    if (files.profilePhoto?.[0]?.path) fields.profilePhotoUrl = files.profilePhoto[0].path;
    if (files.idProof?.[0]?.path)      fields.idProofUrl      = files.idProof[0].path;

    Object.assign(user, fields);
    if (billRent        !== undefined) user.billComponents.rent        = billRent;
    if (billElectricity !== undefined) user.billComponents.electricity = billElectricity;
    if (billFood        !== undefined) user.billComponents.food        = billFood;
    if (depositAmount   !== undefined) user.securityDeposit.amount          = depositAmount;
    if (depositStatus   !== undefined) user.securityDeposit.status          = depositStatus;
    if (depositRefundedAmount !== undefined) user.securityDeposit.refundedAmount = depositRefundedAmount;
    if (depositRefundDate !== undefined)     user.securityDeposit.refundDate     = depositRefundDate;
    if (depositDeductionNotes !== undefined) user.securityDeposit.deductionNotes = depositDeductionNotes;
    await user.save();

    const updated = await hstUser.findById(user._id)
      .populate('roomId', 'roomNumber floor')
      .select('-password');
    res.json({ success: true, resident: updated });
  } catch (err) { next(err); }
};

exports.hstReallocateResident = async (req, res, next) => {
  try {
    const { toRoomId } = req.body;
    if (!toRoomId) return res.status(400).json({ error: 'toRoomId is required' });

    const user = await hstUser.findById(req.params.id);
    if (!user || user.role !== 'resident') return res.status(404).json({ error: 'Resident not found' });

    const newRoom = await hstRoom.findById(toRoomId);
    if (!newRoom || !newRoom.isActive) return res.status(404).json({ error: 'Target room not found' });

    if (user.roomId && user.roomId.toString() === toRoomId) {
      return res.status(400).json({ error: 'Resident is already in that room' });
    }

    if (newRoom.members.length >= newRoom.capacity) {
      return res.status(400).json({ error: `Room ${newRoom.roomNumber} is full (${newRoom.capacity}/${newRoom.capacity})` });
    }

    // Record current room in history before moving
    if (user.roomId) {
      const oldRoom = await hstRoom.findById(user.roomId).select('roomNumber floor');
      if (oldRoom) {
        user.roomHistory.push({
          roomId:     oldRoom._id,
          roomNumber: oldRoom.roomNumber,
          floor:      oldRoom.floor,
          fromDate:   user.moveInDate || user.createdAt,
          toDate:     new Date(),
          movedBy:    req.user._id,
        });
      }
      await hstRoom.findByIdAndUpdate(user.roomId, { $pull: { members: user._id } });
    }

    // Add to new room
    newRoom.members.push(user._id);
    await newRoom.save();

    user.roomId = newRoom._id;
    await user.save();

    hstAudit({ user: req.user, action: 'reallocate', module: 'Resident', targetId: user._id, targetLabel: `${user.name} → Room ${newRoom.roomNumber}`, req });
    res.json({ success: true, message: `${user.name} moved to Room ${newRoom.roomNumber}` });
  } catch (err) { next(err); }
};
