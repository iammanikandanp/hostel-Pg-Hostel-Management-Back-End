const mongoose = require('mongoose');

const completionSchema = new mongoose.Schema({
  completedAt: { type: Date, default: Date.now },
  completedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'hstUser' },
  note:        { type: String, default: null },
}, { _id: false });

const hstMaintenanceTaskSchema = new mongoose.Schema({
  taskName:    { type: String, required: true, trim: true, maxlength: 200 },
  description: { type: String, default: null },
  frequency:   { type: String, enum: ['daily', 'weekly', 'monthly', 'quarterly', 'yearly'], required: true },
  nextDueDate: { type: Date, required: true },
  assignedTo:  { type: String, default: null },     // free-text staff name or role
  isActive:    { type: Boolean, default: true },
  completionHistory: [completionSchema],
  reminderSent:{ type: Boolean, default: false },
}, { timestamps: true });

hstMaintenanceTaskSchema.index({ nextDueDate: 1, isActive: 1 });

module.exports = mongoose.model('hstMaintenanceTask', hstMaintenanceTaskSchema);
