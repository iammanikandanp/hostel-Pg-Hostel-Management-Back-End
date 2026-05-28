const router = require('express').Router();
const hstFoodMenu = require('../models/hstFoodMenu.model');
const { hstProtect, hstRoleCheck } = require('../middleware/hstAuth.middleware');
const { hstAudit } = require('../services/hstAudit.service');

const DAYS = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];

// Returns Monday of the week containing the given YYYY-MM-DD string, as a YYYY-MM-DD string.
// Avoids Date timezone shifts by working with local date parts only.
function getWeekStartStr(dateStr) {
  let y, m, d;
  if (dateStr) {
    [y, m, d] = dateStr.split('-').map(Number);
  } else {
    const now = new Date();
    y = now.getFullYear(); m = now.getMonth() + 1; d = now.getDate();
  }
  const jsDate = new Date(y, m - 1, d); // local, no timezone shift
  const dow = jsDate.getDay(); // 0=Sun
  const diffToMon = dow === 0 ? -6 : 1 - dow;
  jsDate.setDate(jsDate.getDate() + diffToMon);
  const yy = jsDate.getFullYear();
  const mm = String(jsDate.getMonth() + 1).padStart(2, '0');
  const dd = String(jsDate.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

// Returns YYYY-MM-DD day name for a date string (Sun→6 mapped to DAYS index)
function getDayName(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dow = new Date(y, m - 1, d).getDay();
  return DAYS[dow === 0 ? 6 : dow - 1];
}

const adminOrWarden = hstRoleCheck(['admin', 'warden']);

// GET /api/v1/food-menu/current  — current week's menu (all users)
router.get('/current', hstProtect, async (req, res, next) => {
  try {
    const weekStart = getWeekStartStr();
    const menu = await hstFoodMenu.findOne({ weekStart });
    res.json({ success: true, menu, weekStart });
  } catch (err) { next(err); }
});

// GET /api/v1/food-menu/week/:date  — menu for the week containing :date (YYYY-MM-DD)
router.get('/week/:date', hstProtect, async (req, res, next) => {
  try {
    const weekStart = getWeekStartStr(req.params.date);
    const menu = await hstFoodMenu.findOne({ weekStart });
    res.json({ success: true, menu, weekStart });
  } catch (err) { next(err); }
});

// PUT /api/v1/food-menu/week/:date  — create or replace menu for that week (admin/warden)
router.put('/week/:date', hstProtect, adminOrWarden, async (req, res, next) => {
  try {
    const weekStart = getWeekStartStr(req.params.date);
    const update = { weekStart, updatedBy: req.user._id };

    for (const day of DAYS) {
      if (req.body[day]) update[day] = req.body[day];
    }

    const menu = await hstFoodMenu.findOneAndUpdate(
      { weekStart },
      update,
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
    );

    hstAudit({ user: req.user, action: 'update', module: 'Settings', targetLabel: `Food menu week of ${weekStart}`, req });
    res.json({ success: true, menu });
  } catch (err) { next(err); }
});

// PATCH /api/v1/food-menu/day/:date  — update a single day's meals
router.patch('/day/:date', hstProtect, adminOrWarden, async (req, res, next) => {
  try {
    const weekStart = getWeekStartStr(req.params.date);
    const dayName   = getDayName(req.params.date);

    const update = {};
    for (const meal of ['breakfast', 'lunch', 'dinner']) {
      if (req.body[meal] !== undefined) update[`${dayName}.${meal}`] = req.body[meal];
    }

    const menu = await hstFoodMenu.findOneAndUpdate(
      { weekStart },
      { $set: update, $setOnInsert: { weekStart, updatedBy: req.user._id } },
      { upsert: true, returnDocument: 'after' }
    );

    hstAudit({ user: req.user, action: 'update', module: 'Settings', targetLabel: `Food menu ${dayName}`, req });
    res.json({ success: true, menu });
  } catch (err) { next(err); }
});

module.exports = router;
