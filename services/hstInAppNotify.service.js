const hstNotification = require('../models/hstNotification.model');

/**
 * Create an in-app notification for one or many users. Fire-and-forget.
 * @param {string|string[]} userIds  — single userId or array
 * @param {object} opts
 */
async function hstNotify(userIds, { type, title, message, relatedId, relatedModel }) {
  try {
    const ids = Array.isArray(userIds) ? userIds : [userIds];
    const docs = ids.map(userId => ({ userId, type, title, message, relatedId: relatedId ? String(relatedId) : null, relatedModel: relatedModel ?? null }));
    await hstNotification.insertMany(docs, { ordered: false });
  } catch (err) {
    console.error('[IN-APP-NOTIFY]', err.message);
  }
}

module.exports = { hstNotify };
