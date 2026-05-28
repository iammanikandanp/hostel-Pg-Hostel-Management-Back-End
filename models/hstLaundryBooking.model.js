const mongoose = require('mongoose');

const hstLaundryBookingSchema = new mongoose.Schema({
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'hstUser', required: true },
  date:      { type: String, required: true },
  slotTime:  { type: String, required: true },
  machineNo: { type: Number, required: true },
  status:    { type: String, enum: ['booked', 'cancelled', 'done'], default: 'booked' },
  reminderSent: { type: Boolean, default: false },
}, { timestamps: true });

module.exports = mongoose.model('hstLaundryBooking', hstLaundryBookingSchema);
