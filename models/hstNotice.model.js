const mongoose = require('mongoose');

const hstNoticeSchema = new mongoose.Schema({
  title:     { type: String, required: true, trim: true, maxlength: 150 },
  body:      { type: String, required: true, trim: true, maxlength: 2000 },
  priority:  { type: String, enum: ['urgent', 'normal', 'info'], default: 'normal' },
  postedBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'hstUser', required: true },
  expiresAt: { type: Date, default: null },
  isActive:  { type: Boolean, default: true },
}, { timestamps: true });

hstNoticeSchema.index({ isActive: 1, expiresAt: 1 });

module.exports = mongoose.model('hstNotice', hstNoticeSchema);
