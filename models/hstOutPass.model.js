const mongoose = require('mongoose');

const hstOutPassSchema = new mongoose.Schema({
  userId:           { type: mongoose.Schema.Types.ObjectId, ref: 'hstUser', required: true },
  reason:           { type: String, required: true, maxlength: 500 },
  destination:      { type: String, required: true, maxlength: 200 },
  plannedOutTime:   { type: Date, default: null },        // planned departure time (submitted by resident)
  outTime:          { type: Date, default: null },        // actual time resident left (set on approval)
  expectedReturn:   { type: Date, required: true },
  actualReturnTime: { type: Date, default: null },
  status:           { type: String, enum: ['pending', 'approved', 'rejected', 'returned'], default: 'pending' },
  adminNote:        { type: String, default: null },
  reminderSent:     { type: Boolean, default: false },
  overdueSent:      { type: Boolean, default: false },    // tracks whether overdue alert already fired
  // Extension request
  extensionRequested: { type: Boolean, default: false },
  extensionReason:    { type: String, default: null, maxlength: 500 },
  extendedReturn:     { type: Date, default: null },      // proposed new return time
  extensionStatus:    { type: String, enum: ['pending', 'approved', 'rejected', null], default: null },
  extensionAdminNote: { type: String, default: null },
}, { timestamps: true });

module.exports = mongoose.model('hstOutPass', hstOutPassSchema);
