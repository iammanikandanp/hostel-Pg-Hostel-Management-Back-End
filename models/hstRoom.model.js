const mongoose = require('mongoose');

const hstRoomSchema = new mongoose.Schema({
  roomNumber:          { type: String, required: true, unique: true, trim: true },
  floor:               { type: Number, required: true },
  capacity:            { type: Number, required: true, min: 1, max: 10 },
  members:             [{ type: mongoose.Schema.Types.ObjectId, ref: 'hstUser' }],
  lastMeterReading:    { type: Number, default: 0 },
  currentMeterReading: { type: Number, default: 0 },
  isActive:            { type: Boolean, default: true },
}, { timestamps: true });

hstRoomSchema.virtual('occupancy').get(function () {
  return this.members.length;
});

hstRoomSchema.virtual('isFull').get(function () {
  return this.members.length >= this.capacity;
});

module.exports = mongoose.model('hstRoom', hstRoomSchema);
