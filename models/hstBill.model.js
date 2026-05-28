const mongoose = require('mongoose');

const hstBillSchema = new mongoose.Schema({
  userId:           { type: mongoose.Schema.Types.ObjectId, ref: 'hstUser', required: true },
  roomId:           { type: mongoose.Schema.Types.ObjectId, ref: 'hstRoom', required: true },
  month:            { type: Number, required: true },
  year:             { type: Number, required: true },
  rent:             { type: Number, required: true },
  electricityShare: { type: Number, default: 0 },
  foodTotal:        { type: Number, default: 0 },
  total:            { type: Number, required: true },
  isPaid:           { type: Boolean, default: false },
  paidAt:           { type: Date, default: null },
  paymentId:        { type: String, default: null },
  paymentLink:      { type: String, default: null },
  pdfUrl:           { type: String, default: null },
  paidComponents: {
    rent:        { type: Boolean, default: false },
    electricity: { type: Boolean, default: false },
    food:        { type: Boolean, default: false },
  },
  paidAmount:       { type: Number, default: 0 },
}, { timestamps: true });

hstBillSchema.index({ userId: 1, month: 1, year: 1 }, { unique: true });

module.exports = mongoose.model('hstBill', hstBillSchema);
