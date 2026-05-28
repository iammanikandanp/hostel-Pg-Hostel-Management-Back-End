const mongoose = require('mongoose');

const mealSchema = new mongoose.Schema({
  items: { type: String, default: '' }, // comma-separated e.g. "Idli, Sambar, Chutney"
  note:  { type: String, default: '' },
}, { _id: false });

const daySchema = new mongoose.Schema({
  breakfast: mealSchema,
  lunch:     mealSchema,
  dinner:    mealSchema,
}, { _id: false });

const hstFoodMenuSchema = new mongoose.Schema({
  weekStart: { type: String, required: true, unique: true }, // Monday of the week as YYYY-MM-DD
  monday:    daySchema,
  tuesday:   daySchema,
  wednesday: daySchema,
  thursday:  daySchema,
  friday:    daySchema,
  saturday:  daySchema,
  sunday:    daySchema,
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'hstUser' },
}, { timestamps: true });

module.exports = mongoose.model('hstFoodMenu', hstFoodMenuSchema);
