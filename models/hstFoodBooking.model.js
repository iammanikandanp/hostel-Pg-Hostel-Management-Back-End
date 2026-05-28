const mongoose = require('mongoose');

const hstFoodBookingSchema = new mongoose.Schema({
  userId:       { type: mongoose.Schema.Types.ObjectId, ref: 'hstUser', required: true },
  date:         { type: String, required: true },
  meal:         { type: String, enum: ['breakfast', 'lunch', 'dinner'], required: true },
  status:       { type: String, enum: ['booked', 'cancelled', 'consumed', 'no_show'], default: 'booked' },
  // Consumption tracking
  consumedAt:   { type: Date, default: null },
  consumedBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'hstUser', default: null }, // staff who marked / null = self
  consumeMethod:{ type: String, enum: ['qr', 'staff', 'self', null], default: null },
}, { timestamps: true });

hstFoodBookingSchema.index({ userId: 1, date: 1, meal: 1 }, { unique: true });
hstFoodBookingSchema.index({ date: 1, meal: 1, status: 1 });

module.exports = mongoose.model('hstFoodBooking', hstFoodBookingSchema);
