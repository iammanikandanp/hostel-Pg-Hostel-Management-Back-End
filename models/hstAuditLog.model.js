const mongoose = require('mongoose');

const hstAuditLogSchema = new mongoose.Schema({
  performedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'hstUser', default: null },
  performedByName: { type: String, default: 'System' },
  role: { type: String, default: 'system' },
  action: {
    type: String,
    enum: ['create', 'update', 'delete', 'approve', 'reject', 'login', 'logout', 'generate', 'mark_paid', 'moveout', 'reallocate'],
    required: true,
  },
  module: {
    type: String,
    enum: ['Auth', 'Resident', 'Room', 'Bill', 'Food', 'Laundry', 'OutPass', 'LateArrive', 'Complaint', 'Settings', 'AuditLog'],
    required: true,
  },
  targetId:    { type: String, default: null },
  targetLabel: { type: String, default: null },
  before: { type: mongoose.Schema.Types.Mixed, default: null },
  after:  { type: mongoose.Schema.Types.Mixed, default: null },
  ipAddress:  { type: String, default: null },
  userAgent:  { type: String, default: null },
}, { timestamps: true });

hstAuditLogSchema.index({ createdAt: -1 });
hstAuditLogSchema.index({ performedBy: 1 });
hstAuditLogSchema.index({ module: 1 });

module.exports = mongoose.model('hstAuditLog', hstAuditLogSchema);
