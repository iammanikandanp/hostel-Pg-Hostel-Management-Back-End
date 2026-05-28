const router = require('express').Router();
const { hstProtect, hstAdminOnly, hstRoleCheck } = require('../middleware/hstAuth.middleware');
const hstFoodBooking = require('../models/hstFoodBooking.model');
const hstSettings    = require('../models/hstSettings.model');

// ── Helpers ───────────────────────────────────────────────────────────────────

const MEAL_CUTOFF_HOUR = { breakfast: 5, lunch: 11, dinner: 18 };
// Window after meal starts during which self-confirm is allowed (minutes)
const SELF_CONFIRM_WINDOW_MIN = { breakfast: 120, lunch: 120, dinner: 120 }; // 2 hrs

function localDateStr(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}

function addDaysToStr(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return localDateStr(new Date(y, m - 1, d + days));
}

function isCutoffPassed(date, meal) {
  const cutoffHour = MEAL_CUTOFF_HOUR[meal];
  if (cutoffHour === undefined) return true;
  const [y, mo, d] = date.split('-').map(Number);
  return new Date() >= new Date(y, mo - 1, d, cutoffHour, 0, 0, 0);
}

function weekRangeOf(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const dow = dt.getDay();
  const diffToMon = dow === 0 ? -6 : 1 - dow;
  const mon = new Date(y, m - 1, d + diffToMon);
  const sun = new Date(y, m - 1, d + diffToMon + 6);
  return { from: localDateStr(mon), to: localDateStr(sun) };
}

function monthRangeOf(dateStr) {
  const [y, m] = dateStr.split('-').map(Number);
  const from = `${y}-${String(m).padStart(2,'0')}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const to = `${y}-${String(m).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`;
  return { from, to };
}

// Is it within the self-confirm window for this meal today?
function isSelfConfirmWindow(meal) {
  const cutoffHour = MEAL_CUTOFF_HOUR[meal];
  if (cutoffHour === undefined) return false;
  const now = new Date();
  const mealStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), cutoffHour, 0, 0, 0);
  const windowEnd = new Date(mealStart.getTime() + SELF_CONFIRM_WINDOW_MIN[meal] * 60 * 1000);
  return now >= mealStart && now <= windowEnd;
}

const staffRoles = hstRoleCheck(['admin', 'warden', 'accountant']);

// Meal serve times (local hour when meal is served)
const MEAL_SERVE_HOUR = { breakfast: 7, lunch: 12, dinner: 19 };

// Returns which meals are within ±1 hour of now (i.e., currently being served)
function currentlyServingMeals() {
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  return Object.entries(MEAL_SERVE_HOUR)
    .filter(([, h]) => {
      const serveMin = h * 60;
      return nowMin >= serveMin - 60 && nowMin <= serveMin + 60;
    })
    .map(([meal]) => meal);
}

// ── Book a meal ───────────────────────────────────────────────────────────────

router.post('/', hstProtect, async (req, res, next) => {
  try {
    const { date, meal } = req.body;
    if (!date || !meal) return res.status(400).json({ error: 'date and meal are required' });

    const CUTOFF_LABEL = { breakfast: '5:00 AM', lunch: '11:00 AM', dinner: '6:00 PM' };
    if (isCutoffPassed(date, meal)) {
      return res.status(400).json({ error: `Booking cutoff passed — ${meal} must be booked before ${CUTOFF_LABEL[meal]}` });
    }

    const existing = await hstFoodBooking.findOne({ userId: req.user._id, date, meal });
    if (existing) {
      if (existing.status === 'booked') return res.status(409).json({ error: 'Already booked for this meal' });
      if (existing.status === 'consumed') return res.status(409).json({ error: 'Already consumed' });
      existing.status = 'booked';
      await existing.save();
      return res.status(200).json({ success: true, booking: existing });
    }

    const booking = await hstFoodBooking.create({ userId: req.user._id, date, meal });
    res.status(201).json({ success: true, booking });
  } catch (err) { next(err); }
});

// ── Get my bookings ───────────────────────────────────────────────────────────

router.get('/my', hstProtect, async (req, res, next) => {
  try {
    const { month } = req.query;
    const filter = { userId: req.user._id };
    if (month) filter.date = { $regex: `^${month}` };
    const bookings = await hstFoodBooking.find(filter).sort('-date');
    res.json({ success: true, bookings });
  } catch (err) { next(err); }
});

// ── Cancel booking ────────────────────────────────────────────────────────────

router.patch('/:id/cancel', hstProtect, async (req, res, next) => {
  try {
    const booking = await hstFoodBooking.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id, status: 'booked' },
      { status: 'cancelled' },
      { returnDocument: 'after' }
    );
    if (!booking) return res.status(404).json({ error: 'Booking not found or already consumed' });
    res.json({ success: true, booking });
  } catch (err) { next(err); }
});

// ── CONSUMPTION TRACKING ──────────────────────────────────────────────────────

// GET /food/tracking-mode  — returns current hostel tracking mode
router.get('/tracking-mode', hstProtect, async (req, res, next) => {
  try {
    const settings = await hstSettings.findOne({});
    res.json({ success: true, mode: settings?.foodTrackingMode ?? 'staff' });
  } catch (err) { next(err); }
});

// PATCH /food/tracking-mode  — admin sets mode (qr | staff | self)
router.patch('/tracking-mode', hstProtect, hstAdminOnly, async (req, res, next) => {
  try {
    const { mode } = req.body;
    if (!['qr', 'staff', 'self'].includes(mode))
      return res.status(400).json({ error: 'mode must be qr, staff, or self' });
    const settings = await hstSettings.findOneAndUpdate(
      {}, { foodTrackingMode: mode }, { upsert: true, returnDocument: 'after' }
    );
    res.json({ success: true, mode: settings.foodTrackingMode });
  } catch (err) { next(err); }
});

// GET /food/consume/:date/:meal  — staff: get full booking list with consumption status
router.get('/consume/:date/:meal', hstProtect, staffRoles, async (req, res, next) => {
  try {
    const { date, meal } = req.params;
    const bookings = await hstFoodBooking.find({
      date, meal, status: { $in: ['booked', 'consumed', 'no_show'] }
    }).populate('userId', 'name phone roomNumber profilePhotoUrl')
      .populate('consumedBy', 'name')
      .sort('createdAt');
    res.json({ success: true, bookings, count: bookings.length });
  } catch (err) { next(err); }
});

// PATCH /food/:id/consume  — staff marks a booking as consumed
router.patch('/:id/consume', hstProtect, staffRoles, async (req, res, next) => {
  try {
    const booking = await hstFoodBooking.findOneAndUpdate(
      { _id: req.params.id, status: 'booked' },
      { status: 'consumed', consumedAt: new Date(), consumedBy: req.user._id, consumeMethod: 'staff' },
      { returnDocument: 'after' }
    );
    if (!booking) return res.status(404).json({ error: 'Booking not found or already marked' });
    res.json({ success: true, booking });
  } catch (err) { next(err); }
});

// PATCH /food/:id/no-show  — staff marks a booking as no_show
router.patch('/:id/no-show', hstProtect, staffRoles, async (req, res, next) => {
  try {
    const booking = await hstFoodBooking.findOneAndUpdate(
      { _id: req.params.id, status: { $in: ['booked', 'consumed'] } },
      { status: 'no_show', consumedAt: null, consumedBy: null, consumeMethod: null },
      { returnDocument: 'after' }
    );
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    res.json({ success: true, booking });
  } catch (err) { next(err); }
});

// POST /food/bulk-no-show  — staff: mark all remaining 'booked' for date+meal as no_show
router.post('/bulk-no-show', hstProtect, staffRoles, async (req, res, next) => {
  try {
    const { date, meal } = req.body;
    if (!date || !meal) return res.status(400).json({ error: 'date and meal required' });
    const result = await hstFoodBooking.updateMany(
      { date, meal, status: 'booked' },
      { status: 'no_show' }
    );
    res.json({ success: true, marked: result.modifiedCount });
  } catch (err) { next(err); }
});

// PATCH /food/qr-consume  — QR scan: verify by userId + date + meal, mark consumed
router.patch('/qr-consume', hstProtect, staffRoles, async (req, res, next) => {
  try {
    const { userId, date, meal } = req.body;
    if (!userId || !date || !meal) return res.status(400).json({ error: 'userId, date and meal required' });

    const booking = await hstFoodBooking.findOneAndUpdate(
      { userId, date, meal, status: 'booked' },
      { status: 'consumed', consumedAt: new Date(), consumedBy: req.user._id, consumeMethod: 'qr' },
      { returnDocument: 'after' }
    ).populate('userId', 'name phone roomNumber profilePhotoUrl');

    if (!booking) {
      // Check why — already consumed or no booking?
      const existing = await hstFoodBooking.findOne({ userId, date, meal });
      if (!existing) return res.status(404).json({ error: 'No booking found for this resident' });
      if (existing.status === 'consumed') return res.status(409).json({ error: 'Already consumed', booking: existing });
      if (existing.status === 'cancelled') return res.status(400).json({ error: 'Booking was cancelled' });
      return res.status(400).json({ error: 'Cannot mark — booking status is ' + existing.status });
    }
    res.json({ success: true, booking });
  } catch (err) { next(err); }
});

// PATCH /food/:id/self-confirm  — resident self-confirms meal collection
router.patch('/:id/self-confirm', hstProtect, async (req, res, next) => {
  try {
    const booking = await hstFoodBooking.findOne({ _id: req.params.id, userId: req.user._id });
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    if (booking.status === 'consumed') return res.status(409).json({ error: 'Already confirmed' });
    if (booking.status !== 'booked') return res.status(400).json({ error: 'Cannot confirm this booking' });

    // Self-confirm only allowed on same day within the meal window
    const today = localDateStr();
    if (booking.date !== today) return res.status(400).json({ error: 'Self-confirm only allowed on the meal day' });
    if (!isSelfConfirmWindow(booking.meal))
      return res.status(400).json({ error: `Confirm window closed. Confirm within 2 hours of ${booking.meal} time.` });

    booking.status        = 'consumed';
    booking.consumedAt    = new Date();
    booking.consumedBy    = null;
    booking.consumeMethod = 'self';
    await booking.save();
    res.json({ success: true, booking });
  } catch (err) { next(err); }
});

// ── FIXED QR CHECKIN (resident scans mess QR poster) ─────────────────────────
// GET /food/checkin-meals
// Returns today's bookings for the logged-in resident that are within ±1 hr of
// the meal's serve time. Resident can then self-confirm directly.

router.get('/checkin-meals', hstProtect, async (req, res, next) => {
  try {
    const today   = localDateStr();
    const serving = currentlyServingMeals();

    if (serving.length === 0) {
      return res.json({ success: true, serving: [], bookings: [], message: 'No meals being served right now.' });
    }

    const bookings = await hstFoodBooking.find({
      userId: req.user._id,
      date:   today,
      meal:   { $in: serving },
      status: { $in: ['booked', 'consumed'] },
    });

    res.json({ success: true, serving, bookings, today });
  } catch (err) { next(err); }
});

// POST /food/checkin-confirm/:id  — resident confirms via fixed QR flow
router.patch('/checkin-confirm/:id', hstProtect, async (req, res, next) => {
  try {
    const booking = await hstFoodBooking.findOne({ _id: req.params.id, userId: req.user._id });
    if (!booking)                        return res.status(404).json({ error: 'Booking not found' });
    if (booking.status === 'consumed')   return res.status(409).json({ error: 'Already confirmed' });
    if (booking.status !== 'booked')     return res.status(400).json({ error: 'Cannot confirm this booking' });

    const serving = currentlyServingMeals();
    if (!serving.includes(booking.meal))
      return res.status(400).json({ error: `${booking.meal} is not being served right now (±1 hour window)` });

    booking.status        = 'consumed';
    booking.consumedAt    = new Date();
    booking.consumedBy    = null;
    booking.consumeMethod = 'self';
    await booking.save();

    res.json({ success: true, booking });
  } catch (err) { next(err); }
});

// ── STATS ─────────────────────────────────────────────────────────────────────

// GET /food/tomorrow/count
router.get('/tomorrow/count', hstProtect, hstAdminOnly, async (req, res, next) => {
  try {
    const tomorrow = addDaysToStr(localDateStr(), 1);
    const counts = await hstFoodBooking.aggregate([
      { $match: { date: tomorrow, status: { $in: ['booked', 'consumed'] } } },
      { $group: { _id: '$meal', count: { $sum: 1 } } },
    ]);
    const result = { breakfast: 0, lunch: 0, dinner: 0, date: tomorrow };
    counts.forEach(c => { result[c._id] = c.count; });
    res.json({ success: true, ...result });
  } catch (err) { next(err); }
});

// GET /food/stats?range=daily|weekly|monthly&date=YYYY-MM-DD
router.get('/stats', hstProtect, hstAdminOnly, async (req, res, next) => {
  try {
    const { range = 'daily', date } = req.query;
    const refDate = date || localDateStr();

    let from, to;
    if (range === 'weekly')       ({ from, to } = weekRangeOf(refDate));
    else if (range === 'monthly') ({ from, to } = monthRangeOf(refDate));
    else                          { from = refDate; to = refDate; }

    const rows = await hstFoodBooking.aggregate([
      { $match: { date: { $gte: from, $lte: to }, status: { $in: ['booked', 'consumed', 'no_show'] } } },
      { $group: { _id: { date: '$date', meal: '$meal', status: '$status' }, count: { $sum: 1 } } },
      { $sort: { '_id.date': 1 } },
    ]);

    const dayMap = {};
    rows.forEach(r => {
      const dt = r._id.date;
      if (!dayMap[dt]) dayMap[dt] = { date: dt,
        breakfast: 0, lunch: 0, dinner: 0,
        consumed: 0, no_show: 0, booked: 0 };
      dayMap[dt][r._id.meal]  = (dayMap[dt][r._id.meal] || 0) + r.count;
      dayMap[dt][r._id.status] = (dayMap[dt][r._id.status] || 0) + r.count;
    });

    const breakdown = Object.values(dayMap).sort((a, b) => a.date.localeCompare(b.date));

    const totals = breakdown.reduce((acc, d) => {
      acc.breakfast += d.breakfast;
      acc.lunch     += d.lunch;
      acc.dinner    += d.dinner;
      acc.consumed  += d.consumed;
      acc.no_show   += d.no_show;
      acc.booked    += d.booked;
      return acc;
    }, { breakfast: 0, lunch: 0, dinner: 0, consumed: 0, no_show: 0, booked: 0 });
    totals.total = totals.breakfast + totals.lunch + totals.dinner;

    res.json({ success: true, range, from, to, ...totals, breakdown });
  } catch (err) { next(err); }
});

// GET /food/date/:date/meal/:meal  — residents list for drill-down
router.get('/date/:date/meal/:meal', hstProtect, hstAdminOnly, async (req, res, next) => {
  try {
    const { date, meal } = req.params;
    const bookings = await hstFoodBooking.find({
      date, meal, status: { $in: ['booked', 'consumed', 'no_show'] }
    }).populate('userId', 'name phone roomNumber')
      .populate('consumedBy', 'name');
    res.json({ success: true, bookings, count: bookings.length });
  } catch (err) { next(err); }
});

// GET /food/date/:date  — backward compat
router.get('/date/:date', hstProtect, hstAdminOnly, async (req, res, next) => {
  try {
    const bookings = await hstFoodBooking.find({
      date: req.params.date, status: { $in: ['booked', 'consumed', 'no_show'] }
    }).populate('userId', 'name phone roomNumber');
    res.json({ success: true, bookings });
  } catch (err) { next(err); }
});

// GET /food/today/count  — backward compat
router.get('/today/count', hstProtect, hstAdminOnly, async (req, res, next) => {
  try {
    const today = localDateStr();
    const counts = await hstFoodBooking.aggregate([
      { $match: { date: today, status: { $in: ['booked', 'consumed'] } } },
      { $group: { _id: '$meal', count: { $sum: 1 } } },
    ]);
    const result = { breakfast: 0, lunch: 0, dinner: 0 };
    counts.forEach(c => { result[c._id] = c.count; });
    res.json({ success: true, ...result });
  } catch (err) { next(err); }
});

module.exports = router;
