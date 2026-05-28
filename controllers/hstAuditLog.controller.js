const hstAuditLog = require('../models/hstAuditLog.model');

exports.hstGetAuditLogs = async (req, res, next) => {
  try {
    const { module, action, userId, page = 1, limit = 30, startDate, endDate } = req.query;

    const filter = {};
    if (module)    filter.module = module;
    if (action)    filter.action = action;
    if (userId)    filter.performedBy = userId;
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate)   filter.createdAt.$lte = new Date(new Date(endDate).setHours(23, 59, 59, 999));
    }

    const skip  = (parseInt(page) - 1) * parseInt(limit);
    const total = await hstAuditLog.countDocuments(filter);
    const logs  = await hstAuditLog
      .find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate('performedBy', 'name email role');

    res.json({ success: true, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)), logs });
  } catch (err) { next(err); }
};
