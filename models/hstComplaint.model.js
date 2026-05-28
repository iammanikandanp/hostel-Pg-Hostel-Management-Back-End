const mongoose = require('mongoose');

const hstComplaintSchema = new mongoose.Schema({
  resident: { type: mongoose.Schema.Types.ObjectId, ref: 'HstUser', required: true },
  roomNumber: { type: String, required: true },
  category: {
    type: String,
    enum: ['electrical', 'plumbing', 'cleanliness', 'furniture', 'security', 'other'],
    required: true,
  },
  title: { type: String, required: true, maxlength: 120 },
  description: { type: String, required: true, maxlength: 1000 },
  photos: [{ url: String, publicId: String }],
  status: {
    type: String,
    enum: ['open', 'acknowledged', 'fixed', 'closed'],
    default: 'open',
  },
  adminNote: { type: String, maxlength: 500, default: '' },
  statusHistory: [
    {
      status: String,
      changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'HstUser' },
      note: String,
      at: { type: Date, default: Date.now },
    },
  ],
}, { timestamps: true });

module.exports = mongoose.model('HstComplaint', hstComplaintSchema);
