const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const hstUserSchema = new mongoose.Schema({
  name:          { type: String, required: true, trim: true, maxlength: 100 },
  email:         { type: String, required: true, unique: true, lowercase: true, trim: true },
  phone:         { type: String, required: true, trim: true, maxlength: 15 },
  password:      { type: String, required: true, select: false },
  role:          { type: String, enum: ['admin', 'resident', 'warden', 'accountant', 'security'], default: 'resident' },
  roomId:        { type: mongoose.Schema.Types.ObjectId, ref: 'hstRoom', default: null },
  moveInDate:      { type: Date },
  guardianName:    { type: String, trim: true, maxlength: 100, default: null },
  guardianPhone:   { type: String, trim: true, maxlength: 15,  default: null },
  aadharNumber:    { type: String, trim: true, maxlength: 12,  default: null },
  profilePhotoUrl: { type: String, default: null },
  idProofUrl:      { type: String, default: null },
  billComponents: {
    rent:        { type: Boolean, default: true },
    electricity: { type: Boolean, default: true },
    food:        { type: Boolean, default: true },
  },
  securityDeposit: {
    amount:         { type: Number, default: 0 },
    status:         { type: String, enum: ['held', 'partially_refunded', 'refunded', 'closed'], default: 'held' },
    refundedAmount: { type: Number, default: 0 },
    refundDate:     { type: Date,   default: null },
    deductionNotes: { type: String, default: null },
  },
  moveOutDate: { type: Date, default: null },
  isVerified:      { type: Boolean, default: false },
  isActive:      { type: Boolean, default: true },
  mustChangePassword: { type: Boolean, default: true },
  loginAttempts: { type: Number, default: 0 },
  lockUntil:     { type: Date, default: null },
  twoFaOtp:      { type: String, default: null },
  twoFaOtpExpiry:{ type: Date,   default: null },
  twoFaEnabled:  { type: Boolean, default: false },
  roomHistory: [{
    roomId:     { type: mongoose.Schema.Types.ObjectId, ref: 'hstRoom' },
    roomNumber: { type: String },
    floor:      { type: String },
    fromDate:   { type: Date },
    toDate:     { type: Date },
    movedBy:    { type: mongoose.Schema.Types.ObjectId, ref: 'hstUser' },
    note:       { type: String, default: null },
  }],
  activeSessions: [{
    sessionId:  { type: String },
    userAgent:  { type: String },
    ip:         { type: String },
    createdAt:  { type: Date, default: Date.now },
    lastSeen:   { type: Date, default: Date.now },
  }],
}, { timestamps: true });

hstUserSchema.pre('save', async function () {
  if (!this.isModified('password')) return;
  this.password = await bcrypt.hash(this.password, 12);
});

hstUserSchema.methods.comparePassword = async function (plainText) {
  return await bcrypt.compare(plainText, this.password);
};

hstUserSchema.methods.incrementLoginAttempts = async function () {
  if (this.lockUntil && this.lockUntil > Date.now()) return;
  this.loginAttempts += 1;
  if (this.loginAttempts >= 5) {
    this.lockUntil = new Date(Date.now() + 30 * 60 * 1000);
    this.loginAttempts = 0;
  }
  await this.save();
};

module.exports = mongoose.model('hstUser', hstUserSchema);
