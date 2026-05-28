const mongoose = require('mongoose');

const hstWaitlistSchema = new mongoose.Schema({
  name:       { type: String, required: true, trim: true, maxlength: 100 },
  email:      { type: String, required: true, trim: true, lowercase: true },
  phone:      { type: String, required: true, trim: true, maxlength: 15 },
  roomType:   { type: String, enum: ['single', 'double', 'triple', 'any'], default: 'any' },
  status:     { type: String, enum: ['waiting', 'offered', 'converted', 'cancelled'], default: 'waiting' },
  notes:      { type: String, default: null },
  addedBy:    { type: mongoose.Schema.Types.ObjectId, ref: 'hstUser' },
  offeredAt:  { type: Date, default: null },
  convertedResidentId: { type: mongoose.Schema.Types.ObjectId, ref: 'hstUser', default: null },
}, { timestamps: true });

hstWaitlistSchema.index({ status: 1, createdAt: 1 });

module.exports = mongoose.model('hstWaitlist', hstWaitlistSchema);
