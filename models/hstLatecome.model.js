const mongoose = require('mongoose');

const hstLatecomeSchema = new mongoose.Schema({
  userId:          { type: mongoose.Schema.Types.ObjectId, ref: 'hstUser', required: true },
  reason:          { type: String, required: true, maxlength: 500 },
  expectedArrival: { type: Date, required: true },       // when they expect to reach
  actualArrival:   { type: Date, default: null },        // set when they tap "I'm back"
  status:          { type: String, enum: ['pending', 'approved', 'rejected', 'arrived'], default: 'pending' },
  adminNote:       { type: String, default: null },
  arrivalAlertSent: { type: Boolean, default: false },   // cron: alert if not arrived past expected+15 min
}, { timestamps: true });

module.exports = mongoose.model('hstLatecome', hstLatecomeSchema);
