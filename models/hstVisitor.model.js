const mongoose = require('mongoose');

const hstVisitorSchema = new mongoose.Schema({
  residentId:     { type: mongoose.Schema.Types.ObjectId, ref: 'hstUser', required: true },
  residentRoom:   { type: String, default: null },
  visitorName:    { type: String, required: true, trim: true, maxlength: 100 },
  visitorPhone:   { type: String, required: true, trim: true, maxlength: 15 },
  idProofType:    { type: String, enum: ['Aadhar', 'PAN', 'Driving Licence', 'Passport', 'Voter ID', 'Other'], default: 'Aadhar' },
  idProofNumber:  { type: String, trim: true, maxlength: 30, default: null },
  purpose:        { type: String, trim: true, maxlength: 200, default: null },
  entryTime:      { type: Date, default: Date.now },
  exitTime:       { type: Date, default: null },
  loggedBy:       { type: mongoose.Schema.Types.ObjectId, ref: 'hstUser', default: null },
  status:         { type: String, enum: ['inside', 'exited'], default: 'inside' },
}, { timestamps: true });

hstVisitorSchema.index({ residentId: 1 });
hstVisitorSchema.index({ entryTime: -1 });
hstVisitorSchema.index({ status: 1 });

module.exports = mongoose.model('hstVisitor', hstVisitorSchema);
