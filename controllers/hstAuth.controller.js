const jwt = require('jsonwebtoken');
const Joi = require('joi');
const crypto = require('crypto');
const hstUser = require('../models/hstUser.model');
const { hstAudit } = require('../services/hstAudit.service');
const { hstSendWhatsApp } = require('../services/hstNotification.service');

const SESSION_LIMIT = 5; // max concurrent sessions per user

const ACCESS_TTL_MS  = 15 * 60 * 1000;          // 15 minutes
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

const cookieOpts = (maxAge) => ({
  httpOnly: true,
  secure:   process.env.NODE_ENV === 'production',
  sameSite: process.env.NODE_ENV === 'production' ? 'Strict' : 'Lax',
  maxAge,
});

const sendTokenCookie = (user, statusCode, res, req) => {
  const sessionId = crypto.randomBytes(16).toString('hex');
  const accessToken = jwt.sign(
    { id: user._id, role: user.role, sid: sessionId },
    process.env.JWT_SECRET,
    { expiresIn: '15m' }
  );
  const refreshToken = jwt.sign(
    { id: user._id, sid: sessionId },
    process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET + '_refresh',
    { expiresIn: '30d' }
  );

  // Maintain session list (trim oldest if over limit)
  if (!user.activeSessions) user.activeSessions = [];
  user.activeSessions.push({
    sessionId,
    userAgent: req?.headers?.['user-agent']?.slice(0, 200) ?? 'unknown',
    ip:        req?.ip ?? 'unknown',
    createdAt: new Date(),
    lastSeen:  new Date(),
  });
  if (user.activeSessions.length > SESSION_LIMIT) {
    user.activeSessions = user.activeSessions.slice(-SESSION_LIMIT);
  }

  res.cookie('hst_token',   accessToken,  cookieOpts(ACCESS_TTL_MS));
  res.cookie('hst_refresh', refreshToken, cookieOpts(REFRESH_TTL_MS));

  res.status(statusCode).json({
    success: true,
    user: {
      id: user._id,
      name: user.name,
      role: user.role,
      mustChangePassword: user.mustChangePassword,
    },
  });
};

exports.hstRegisterAdmin = async (req, res, next) => {
  try {
    const existingAdmin = await hstUser.findOne({ role: 'admin' });
    if (existingAdmin) return res.status(403).json({ error: 'Admin already exists' });

    const schema = Joi.object({
      name:     Joi.string().min(2).max(100).required(),
      email:    Joi.string().email().required(),
      phone:    Joi.string().pattern(/^[0-9]{10}$/).required(),
      password: Joi.string().min(8)
                   .pattern(/^(?=.*[A-Z])(?=.*[0-9])(?=.*[^A-Za-z0-9])/)
                   .required()
                   .messages({ 'string.pattern.base': 'Password needs uppercase, number, and special character' }),
    });
    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const admin = await hstUser.create({ ...value, role: 'admin', mustChangePassword: false });
    await admin.save();
    sendTokenCookie(admin, 201, res, req);
  } catch (err) { next(err); }
};

exports.hstLogin = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const user = await hstUser.findOne({ email: email.toLowerCase() }).select('+password');
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    if (user.lockUntil && user.lockUntil > Date.now()) {
      return res.status(403).json({ error: 'Account locked. Try again in 30 minutes.' });
    }

    const match = await user.comparePassword(password);
    if (!match) {
      await user.incrementLoginAttempts();
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    user.loginAttempts = 0;
    user.lockUntil = null;

    // 2FA: admin/warden/accountant with 2FA enabled → send OTP, hold the cookie
    const rolesRequiring2FA = ['admin', 'warden', 'accountant'];
    if (user.twoFaEnabled && rolesRequiring2FA.includes(user.role)) {
      const otp = String(Math.floor(100000 + Math.random() * 900000));
      user.twoFaOtp       = crypto.createHash('sha256').update(otp).digest('hex');
      user.twoFaOtpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 min
      await user.save();
      await hstSendWhatsApp(user.phone,
        `*HostelMS – Login OTP*\nYour one-time code: *${otp}*\nExpires in 10 minutes. Do not share it.`
      );
      return res.json({ success: true, requires2FA: true, userId: user._id });
    }

    hstAudit({ user, action: 'login', module: 'Auth', targetLabel: user.email, req });
    sendTokenCookie(user, 200, res, req);
    await user.save();
  } catch (err) { next(err); }
};

exports.hstLogout = (req, res) => {
  hstAudit({ user: req.user, action: 'logout', module: 'Auth', targetLabel: req.user?.email, req });
  const clear = { httpOnly: true, expires: new Date(0) };
  res.cookie('hst_token',   '', clear);
  res.cookie('hst_refresh', '', clear);
  res.json({ success: true, message: 'Logged out' });
};

// POST /api/v1/auth/refresh  — issue a new access token using the refresh token
exports.hstRefresh = async (req, res, next) => {
  try {
    const refreshToken = req.cookies?.hst_refresh;
    if (!refreshToken) return res.status(401).json({ error: 'No refresh token' });

    let decoded;
    try {
      decoded = jwt.verify(
        refreshToken,
        process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET + '_refresh'
      );
    } catch {
      return res.status(401).json({ error: 'Refresh token invalid or expired' });
    }

    const user = await hstUser.findById(decoded.id).select('-password');
    if (!user || !user.isActive) return res.status(401).json({ error: 'User not found or inactive' });

    const accessToken = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '15m' }
    );
    res.cookie('hst_token', accessToken, cookieOpts(ACCESS_TTL_MS));
    res.json({ success: true });
  } catch (err) { next(err); }
};

exports.hstChangePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const user = await hstUser.findById(req.user._id).select('+password');

    const match = await user.comparePassword(currentPassword);
    if (!match) return res.status(400).json({ error: 'Current password incorrect' });

    const schema = Joi.string().min(8).pattern(/^(?=.*[A-Z])(?=.*[0-9])(?=.*[^A-Za-z0-9])/);
    const { error } = schema.validate(newPassword);
    if (error) return res.status(400).json({ error: 'Password needs uppercase, number, and special character' });

    user.password = newPassword;
    user.mustChangePassword = false;
    await user.save();

    res.json({ success: true, message: 'Password updated' });
  } catch (err) { next(err); }
};

exports.hstMe = async (req, res) => {
  res.json({ success: true, user: req.user });
};

// POST /api/v1/auth/verify-otp  — step 2 of 2FA login
exports.hstVerifyOtp = async (req, res, next) => {
  try {
    const { userId, otp } = req.body;
    if (!userId || !otp) return res.status(400).json({ error: 'userId and otp are required' });

    const user = await hstUser.findById(userId);
    if (!user) return res.status(401).json({ error: 'Invalid request' });

    if (!user.twoFaOtp || !user.twoFaOtpExpiry) {
      return res.status(400).json({ error: 'No OTP pending. Please log in again.' });
    }
    if (user.twoFaOtpExpiry < new Date()) {
      user.twoFaOtp = null; user.twoFaOtpExpiry = null; await user.save();
      return res.status(400).json({ error: 'OTP expired. Please log in again.' });
    }

    const hashedInput = crypto.createHash('sha256').update(otp).digest('hex');
    if (hashedInput !== user.twoFaOtp) {
      return res.status(401).json({ error: 'Incorrect OTP' });
    }

    user.twoFaOtp = null;
    user.twoFaOtpExpiry = null;
    await user.save();

    hstAudit({ user, action: 'login', module: 'Auth', targetLabel: `${user.email} (2FA)`, req });
    sendTokenCookie(user, 200, res, req);
    await user.save();
  } catch (err) { next(err); }
};

// GET /api/v1/auth/sessions — list active sessions for current user
exports.hstGetSessions = async (req, res, next) => {
  try {
    const user = await hstUser.findById(req.user._id).select('activeSessions');
    res.json({ success: true, sessions: user.activeSessions ?? [] });
  } catch (err) { next(err); }
};

// DELETE /api/v1/auth/sessions/:sessionId — revoke a specific session
exports.hstRevokeSession = async (req, res, next) => {
  try {
    const user = await hstUser.findById(req.user._id);
    user.activeSessions = (user.activeSessions ?? []).filter(s => s.sessionId !== req.params.sessionId);
    await user.save();
    res.json({ success: true, message: 'Session revoked' });
  } catch (err) { next(err); }
};

// DELETE /api/v1/auth/sessions — revoke ALL sessions (force logout everywhere)
exports.hstRevokeAllSessions = async (req, res, next) => {
  try {
    await hstUser.findByIdAndUpdate(req.user._id, { activeSessions: [] });
    const clear = { httpOnly: true, expires: new Date(0) };
    res.cookie('hst_token', '', clear);
    res.cookie('hst_refresh', '', clear);
    res.json({ success: true, message: 'All sessions revoked' });
  } catch (err) { next(err); }
};

// DELETE /api/v1/auth/sessions/user/:userId — admin force-logout a specific user
exports.hstAdminRevokeUserSessions = async (req, res, next) => {
  try {
    const target = await hstUser.findById(req.params.userId);
    if (!target) return res.status(404).json({ error: 'User not found' });
    target.activeSessions = [];
    await target.save();
    hstAudit({ user: req.user, action: 'update', module: 'Auth', targetId: target._id, targetLabel: `Force logout: ${target.name}`, req });
    res.json({ success: true, message: `All sessions revoked for ${target.name}` });
  } catch (err) { next(err); }
};

// PATCH /api/v1/auth/2fa  — toggle 2FA on/off for the current admin/staff user
exports.hstToggle2FA = async (req, res, next) => {
  try {
    const { enable } = req.body;
    if (typeof enable !== 'boolean') return res.status(400).json({ error: '"enable" must be true or false' });

    const staffRoles = ['admin', 'warden', 'accountant'];
    if (!staffRoles.includes(req.user.role)) {
      return res.status(403).json({ error: '2FA is only available for admin and staff accounts' });
    }

    const user = await hstUser.findById(req.user._id);
    user.twoFaEnabled = enable;
    await user.save();

    hstAudit({ user, action: 'update', module: 'Auth', targetLabel: `2FA ${enable ? 'enabled' : 'disabled'}`, req });
    res.json({ success: true, twoFaEnabled: user.twoFaEnabled });
  } catch (err) { next(err); }
};
