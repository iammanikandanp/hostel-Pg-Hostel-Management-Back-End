const mongoose = require('mongoose');

const hstSettingsSchema = new mongoose.Schema({
  hostelName:      { type: String, default: 'My Hostel' },
  rentPerRoom:     { type: Number, default: 5000 },
  electricityRate: { type: Number, default: 8 },
  foodPrices: {
    breakfast: { type: Number, default: 50 },
    lunch:     { type: Number, default: 80 },
    dinner:    { type: Number, default: 70 },
  },
  laundryDays:      { type: [Number], default: [1,2,3,4,5,6,0] }, // 0=Sun … 6=Sat
  laundryStartTime: { type: String,   default: '06:00' },
  laundryEndTime:   { type: String,   default: '21:00' },
  machineCount:     { type: Number,   default: 2 },
  dueDateDay:        { type: Number, default: 10 },
  foodTrackingMode:  { type: String, enum: ['qr', 'staff', 'self'], default: 'staff' },
}, { timestamps: true });

module.exports = mongoose.model('hstSettings', hstSettingsSchema);
