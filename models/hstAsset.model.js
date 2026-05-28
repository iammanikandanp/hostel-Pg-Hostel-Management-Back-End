const mongoose = require('mongoose');

const hstAssetSchema = new mongoose.Schema({
  name:         { type: String, required: true, trim: true, maxlength: 200 },
  category:     { type: String, enum: ['furniture', 'electronics', 'appliances', 'fixtures', 'linen', 'other'], required: true },
  roomId:       { type: mongoose.Schema.Types.ObjectId, ref: 'hstRoom', default: null },
  condition:    { type: String, enum: ['good', 'fair', 'poor', 'damaged'], default: 'good' },
  purchaseDate: { type: Date, default: null },
  purchasePrice:{ type: Number, default: null },
  serialNumber: { type: String, default: null },
  notes:        { type: String, default: null },
  isActive:     { type: Boolean, default: true },
  addedBy:      { type: mongoose.Schema.Types.ObjectId, ref: 'hstUser' },
}, { timestamps: true });

hstAssetSchema.index({ roomId: 1 });
hstAssetSchema.index({ category: 1 });
hstAssetSchema.index({ condition: 1, isActive: 1 });

module.exports = mongoose.model('hstAsset', hstAssetSchema);
