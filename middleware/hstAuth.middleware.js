const jwt = require('jsonwebtoken');
const hstUser = require('../models/hstUser.model');

exports.hstProtect = async (req, res, next) => {
  try {
    const token = req.cookies?.hst_token;
    if (!token) return res.status(401).json({ error: 'Not authenticated' });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await hstUser.findById(decoded.id).select('-password');
    if (!user || !user.isActive) return res.status(401).json({ error: 'User not found or inactive' });

    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

exports.hstAdminOnly = (req, res, next) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admins only' });
  }
  next();
};

// Allow any combination of roles: hstRoleCheck(['admin','warden'])
exports.hstRoleCheck = (allowedRoles) => (req, res, next) => {
  if (!allowedRoles.includes(req.user?.role)) {
    return res.status(403).json({ error: `Access restricted to: ${allowedRoles.join(', ')}` });
  }
  next();
};

// Staff = admin + warden + accountant (not security, not resident)
exports.hstStaffOnly = (req, res, next) => {
  const staffRoles = ['admin', 'warden', 'accountant'];
  if (!staffRoles.includes(req.user?.role)) {
    return res.status(403).json({ error: 'Staff access required' });
  }
  next();
};
