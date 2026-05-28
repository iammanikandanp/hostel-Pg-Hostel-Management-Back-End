const hstAuditLog = require('../models/hstAuditLog.model');

/**
 * Write an audit log entry. Fire-and-forget — never throws.
 * @param {object} opts
 * @param {object|null} opts.user     - req.user (may be null for system events)
 * @param {string} opts.action        - see hstAuditLog enum
 * @param {string} opts.module        - see hstAuditLog enum
 * @param {string} [opts.targetId]
 * @param {string} [opts.targetLabel] - human-readable name of the affected record
 * @param {object} [opts.before]
 * @param {object} [opts.after]
 * @param {object} [opts.req]         - Express req (for IP / UA extraction)
 */
async function hstAudit({ user, action, module, targetId, targetLabel, before, after, req }) {
  try {
    await hstAuditLog.create({
      performedBy:     user?._id   ?? null,
      performedByName: user?.name  ?? 'System',
      role:            user?.role  ?? 'system',
      action,
      module,
      targetId:    targetId    ? String(targetId)    : null,
      targetLabel: targetLabel ?? null,
      before:      before ?? null,
      after:       after  ?? null,
      ipAddress:   req ? (req.ip || req.headers['x-forwarded-for'] || null) : null,
      userAgent:   req ? (req.headers['user-agent'] || null) : null,
    });
  } catch (err) {
    console.error('[AUDIT] Failed to write audit log:', err.message);
  }
}

module.exports = { hstAudit };
