const mongoose = require('mongoose');

const hstAttendanceSchema = new mongoose.Schema({
  date:     { type: String, required: true },         // YYYY-MM-DD
  resident: { type: mongoose.Schema.Types.ObjectId, ref: 'hstUser', required: true },
  status:   { type: String, enum: ['present', 'absent', 'on_outpass', 'on_leave'], default: 'absent' },
  markedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'hstUser', default: null },
  note:     { type: String, default: null },
}, { timestamps: true });

hstAttendanceSchema.index({ date: 1, resident: 1 }, { unique: true });
hstAttendanceSchema.index({ resident: 1, date: -1 });

module.exports = mongoose.model('hstAttendance', hstAttendanceSchema);
