const Joi = require('joi');
const hstRoom = require('../models/hstRoom.model');
const hstUser = require('../models/hstUser.model');
const { hstAudit } = require('../services/hstAudit.service');

exports.hstGetAllRooms = async (req, res, next) => {
  try {
    const rooms = await hstRoom.find({ isActive: true }).populate('members', 'name phone email');
    res.json({ success: true, rooms });
  } catch (err) { next(err); }
};

exports.hstGetRoom = async (req, res, next) => {
  try {
    const room = await hstRoom.findById(req.params.id).populate('members', 'name phone email moveInDate');
    if (!room) return res.status(404).json({ error: 'Room not found' });
    res.json({ success: true, room });
  } catch (err) { next(err); }
};

exports.hstCreateRoom = async (req, res, next) => {
  try {
    const schema = Joi.object({
      roomNumber: Joi.string().max(10).required(),
      floor:      Joi.number().min(0).max(50).required(),
      capacity:   Joi.number().min(1).max(10).required(),
    });
    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const room = await hstRoom.create(value);
    hstAudit({ user: req.user, action: 'create', module: 'Room', targetId: room._id, targetLabel: `Room ${room.roomNumber}`, req });
    res.status(201).json({ success: true, room });
  } catch (err) { next(err); }
};

exports.hstAssignResident = async (req, res, next) => {
  try {
    const room = await hstRoom.findById(req.params.id);
    if (!room) return res.status(404).json({ error: 'Room not found' });

    if (room.members.length >= room.capacity) {
      return res.status(400).json({ error: `Room ${room.roomNumber} is full (${room.capacity}/${room.capacity})` });
    }

    const { userId } = req.body;
    const user = await hstUser.findById(userId);
    if (!user) return res.status(404).json({ error: 'Resident not found' });
    if (user.roomId) return res.status(400).json({ error: 'Resident already has a room' });

    room.members.push(userId);
    await room.save();

    user.roomId = room._id;
    await user.save();

    hstAudit({ user: req.user, action: 'update', module: 'Room', targetId: room._id, targetLabel: `Assigned ${user.name} to Room ${room.roomNumber}`, req });
    res.json({ success: true, message: `Assigned ${user.name} to Room ${room.roomNumber}` });
  } catch (err) { next(err); }
};

exports.hstUpdateCapacity = async (req, res, next) => {
  try {
    const room = await hstRoom.findById(req.params.id);
    if (!room) return res.status(404).json({ error: 'Room not found' });

    const { capacity } = req.body;
    if (capacity < room.members.length) {
      return res.status(400).json({ error: `Cannot set below current occupants (${room.members.length})` });
    }

    room.capacity = capacity;
    await room.save();
    res.json({ success: true, room });
  } catch (err) { next(err); }
};

exports.hstUpdateMeterReading = async (req, res, next) => {
  try {
    const { roomId, currentReading } = req.body;
    if (currentReading === undefined || currentReading === null) {
      return res.status(400).json({ error: 'currentReading is required' });
    }
    const room = await hstRoom.findById(roomId);
    if (!room) return res.status(404).json({ error: 'Room not found' });

    room.lastMeterReading = room.currentMeterReading;
    room.currentMeterReading = currentReading;
    await room.save();

    hstAudit({ user: req.user, action: 'update', module: 'Room', targetId: room._id, targetLabel: `Room ${room.roomNumber} meter → ${currentReading}`, req });
    res.json({ success: true, message: 'Meter reading updated', room });
  } catch (err) { next(err); }
};

exports.hstDeactivateRoom = async (req, res, next) => {
  try {
    const room = await hstRoom.findById(req.params.id);
    if (!room) return res.status(404).json({ error: 'Room not found' });
    if (room.members.length > 0) {
      return res.status(400).json({ error: 'Cannot deactivate room with residents. Move them out first.' });
    }
    room.isActive = false;
    await room.save();
    hstAudit({ user: req.user, action: 'delete', module: 'Room', targetId: room._id, targetLabel: `Room ${room.roomNumber}`, req });
    res.json({ success: true, message: 'Room deactivated' });
  } catch (err) { next(err); }
};
