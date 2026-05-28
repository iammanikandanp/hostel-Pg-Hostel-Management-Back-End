const mongoose = require('mongoose');

const hstExpenseSchema = new mongoose.Schema({
  category:    { type: String, enum: ['maintenance', 'salary', 'utilities', 'supplies', 'other'], required: true },
  amount:      { type: Number, required: true, min: 0 },
  date:        { type: Date, required: true },
  description: { type: String, required: true, trim: true, maxlength: 500 },
  receiptUrl:  { type: String, default: null },
  addedBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'hstUser', required: true },
}, { timestamps: true });

hstExpenseSchema.index({ date: -1 });
hstExpenseSchema.index({ category: 1, date: -1 });

module.exports = mongoose.model('hstExpense', hstExpenseSchema);
