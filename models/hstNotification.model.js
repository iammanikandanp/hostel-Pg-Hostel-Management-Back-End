const mongoose = require('mongoose');

const hstNotificationSchema = new mongoose.Schema({
  userId:       { type: mongoose.Schema.Types.ObjectId, ref: 'hstUser', required: true },
  type:         { type: String, required: true }, // 'bill_generated', 'outpass_approved', 'complaint_updated', 'notice_posted', etc.
  title:        { type: String, required: true, maxlength: 150 },
  message:      { type: String, required: true, maxlength: 500 },
  isRead:       { type: Boolean, default: false },
  relatedId:    { type: String, default: null },
  relatedModel: { type: String, default: null }, // 'Bill', 'OutPass', 'Complaint', 'Notice', etc.
  expiresAt:    { type: Date, default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) }, // 30 days
}, { timestamps: true });

hstNotificationSchema.index({ userId: 1, isRead: 1 });
hstNotificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('hstNotification', hstNotificationSchema);
