const cloudinary = require('cloudinary').v2;
const HstComplaint = require('../models/hstComplaint.model');
const HstUser = require('../models/hstUser.model');
const { hstAudit } = require('../services/hstAudit.service');
const { hstNotify } = require('../services/hstInAppNotify.service');

// ── Resident: submit a new complaint ──────────────────────────────────────────
exports.submitComplaint = async (req, res, next) => {
  try {
    const { category, title, description } = req.body;
    if (!category || !title || !description)
      return res.status(400).json({ error: 'category, title, and description are required' });

    const resident = await HstUser.findById(req.user.id).select('roomNumber name');
    if (!resident) return res.status(404).json({ error: 'Resident not found' });

    const photos = (req.files || []).map(f => ({
      url: f.path,
      publicId: f.filename,
    }));

    const complaint = await HstComplaint.create({
      resident: req.user.id,
      roomNumber: resident.roomNumber || 'N/A',
      category,
      title: title.trim(),
      description: description.trim(),
      photos,
      statusHistory: [{ status: 'open', changedBy: req.user.id, note: 'Complaint submitted' }],
    });

    hstAudit({ user: req.user, action: 'create', module: 'Complaint', targetId: complaint._id, targetLabel: complaint.title, req });
    res.status(201).json(complaint);
  } catch (err) {
    next(err);
  }
};

// ── Resident: list own complaints ─────────────────────────────────────────────
exports.myComplaints = async (req, res, next) => {
  try {
    const complaints = await HstComplaint.find({ resident: req.user.id })
      .sort({ createdAt: -1 })
      .lean();
    res.json(complaints);
  } catch (err) {
    next(err);
  }
};

// ── Admin: list all complaints ────────────────────────────────────────────────
exports.allComplaints = async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.category) filter.category = req.query.category;

    const complaints = await HstComplaint.find(filter)
      .populate('resident', 'name email roomNumber')
      .sort({ createdAt: -1 })
      .lean();
    res.json(complaints);
  } catch (err) {
    next(err);
  }
};

// ── Admin: update status ──────────────────────────────────────────────────────
exports.updateStatus = async (req, res, next) => {
  try {
    const { status, adminNote } = req.body;
    const allowed = ['open', 'acknowledged', 'fixed', 'closed'];
    if (!allowed.includes(status))
      return res.status(400).json({ error: 'Invalid status' });

    const complaint = await HstComplaint.findById(req.params.id);
    if (!complaint) return res.status(404).json({ error: 'Complaint not found' });

    complaint.status = status;
    if (adminNote !== undefined) complaint.adminNote = adminNote.trim();
    complaint.statusHistory.push({ status, changedBy: req.user.id, note: adminNote || '' });

    await complaint.save();
    await complaint.populate('resident', 'name email roomNumber');
    hstAudit({ user: req.user, action: 'update', module: 'Complaint', targetId: complaint._id, targetLabel: `${complaint.title} → ${status}`, req });
    hstNotify(complaint.resident._id, {
      type: 'complaint_updated',
      title: 'Complaint Status Updated',
      message: `Your complaint "${complaint.title}" is now ${status}.${adminNote ? ` Note: ${adminNote}` : ''}`,
      relatedId: complaint._id,
      relatedModel: 'Complaint',
    });
    res.json(complaint);
  } catch (err) {
    next(err);
  }
};

// ── Admin: delete a complaint ─────────────────────────────────────────────────
exports.deleteComplaint = async (req, res, next) => {
  try {
    const complaint = await HstComplaint.findById(req.params.id);
    if (!complaint) return res.status(404).json({ error: 'Complaint not found' });

    // Remove photos from Cloudinary
    for (const photo of complaint.photos) {
      if (photo.publicId) {
        await cloudinary.uploader.destroy(photo.publicId).catch(() => {});
      }
    }

    await complaint.deleteOne();
    hstAudit({ user: req.user, action: 'delete', module: 'Complaint', targetLabel: complaint.title, req });
    res.json({ message: 'Complaint deleted' });
  } catch (err) {
    next(err);
  }
};
