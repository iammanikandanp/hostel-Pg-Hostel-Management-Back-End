const router = require('express').Router();
const { hstProtect, hstAdminOnly } = require('../middleware/hstAuth.middleware');
const hstLaundryBooking = require('../models/hstLaundryBooking.model');
const hstSettings = require('../models/hstSettings.model');
const hstUser = require('../models/hstUser.model');
const { hstSendWhatsApp } = require('../services/hstNotification.service');

// Generate 1-hour slots between startTime and endTime (e.g. "06:00" → "21:00")
function generateSlots(start, end) {
  const slots = [];
  let [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  const endMins = eh * 60 + em;
  while (sh * 60 + sm < endMins) {
    slots.push(`${String(sh).padStart(2, '0')}:${String(sm).padStart(2, '0')}`);
    sh += 1;
  }
  return slots;
}

function fmt12(time24) {
  const [h, m] = time24.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

// ── Resident: book a slot ────────────────────────────────────────────────────
router.post('/', hstProtect, async (req, res, next) => {
  try {
    const { date, slotTime, machineNo } = req.body;
    if (!date || !slotTime || !machineNo) {
      return res.status(400).json({ error: 'date, slotTime, and machineNo are required' });
    }

    const settings     = await hstSettings.findOne();
    const machineCount = settings?.machineCount || 2;
    const laundryDays  = settings?.laundryDays ?? [0,1,2,3,4,5,6];

    // Check if the chosen date falls on an allowed laundry day
    const dayOfWeek = new Date(date + 'T00:00:00').getDay();
    if (!laundryDays.includes(dayOfWeek)) {
      return res.status(400).json({ error: 'Laundry is not available on this day' });
    }

    // Reject past slots (for today, slot hour must be in the future)
    const now      = new Date();
    const todayStr = now.toISOString().split('T')[0];
    if (date === todayStr) {
      const slotHour = parseInt(slotTime.split(':')[0], 10);
      if (slotHour <= now.getHours()) {
        return res.status(400).json({ error: 'This time slot has already passed' });
      }
    }

    if (machineNo < 1 || machineNo > machineCount) {
      return res.status(400).json({ error: `Machine number must be between 1 and ${machineCount}` });
    }

    // Validate slotTime is in the generated list
    const slots = generateSlots(settings?.laundryStartTime || '06:00', settings?.laundryEndTime || '21:00');
    if (!slots.includes(slotTime)) {
      return res.status(400).json({ error: 'Invalid slot time' });
    }

    // Check machine conflict
    const conflict = await hstLaundryBooking.findOne({ date, slotTime, machineNo, status: 'booked' });
    if (conflict) {
      return res.status(409).json({ error: `Machine ${machineNo} at ${fmt12(slotTime)} is already booked` });
    }

    // Check resident double-booking same slot
    const myConflict = await hstLaundryBooking.findOne({ userId: req.user._id, date, slotTime, status: 'booked' });
    if (myConflict) {
      return res.status(409).json({ error: 'You already have a booking at this time' });
    }

    const booking = await hstLaundryBooking.create({ userId: req.user._id, date, slotTime, machineNo });

    // WhatsApp confirmation to resident
    await hstSendWhatsApp(req.user.phone,
      `🧺 *Laundry Slot Confirmed!*\n\n` +
      `Date    : ${new Date(date + 'T00:00:00').toLocaleDateString('en-IN', { dateStyle: 'medium' })}\n` +
      `Time    : ${fmt12(slotTime)}\n` +
      `Machine : #${machineNo}\n\n` +
      `Please bring your clothes on time. Cancel in the app if plans change.`
    );

    res.status(201).json({ success: true, booking });
  } catch (err) { next(err); }
});

// ── Available slots for a date ───────────────────────────────────────────────
router.get('/available/:date', hstProtect, async (req, res, next) => {
  try {
    const settings     = await hstSettings.findOne();
    const machineCount = settings?.machineCount || 2;
    const laundryDays  = settings?.laundryDays ?? [0,1,2,3,4,5,6];
    const slots        = generateSlots(settings?.laundryStartTime || '06:00', settings?.laundryEndTime || '21:00');

    const dayOfWeek = new Date(req.params.date + 'T00:00:00').getDay();
    if (!laundryDays.includes(dayOfWeek)) {
      return res.json({ success: true, available: [], unavailableDay: true });
    }

    // For today, treat slots whose hour has already passed as past
    const now       = new Date();
    const todayStr  = now.toISOString().split('T')[0];
    const isToday   = req.params.date === todayStr;
    const nowHour   = now.getHours();

    const booked = await hstLaundryBooking.find({ date: req.params.date, status: 'booked' })
      .select('slotTime machineNo');

    const bookedSet = new Set(booked.map(b => `${b.slotTime}-${b.machineNo}`));
    const available = [];
    for (const slot of slots) {
      const slotHour = parseInt(slot.split(':')[0], 10);
      const isPast   = isToday && slotHour <= nowHour;
      for (let m = 1; m <= machineCount; m++) {
        available.push({
          slotTime: slot,
          machineNo: m,
          booked: bookedSet.has(`${slot}-${m}`),
          past: isPast,
        });
      }
    }
    res.json({ success: true, available });
  } catch (err) { next(err); }
});

// ── Resident: my bookings ────────────────────────────────────────────────────
router.get('/my', hstProtect, async (req, res, next) => {
  try {
    const bookings = await hstLaundryBooking.find({ userId: req.user._id }).sort('-date -slotTime');
    res.json({ success: true, bookings });
  } catch (err) { next(err); }
});

// ── Resident: cancel ─────────────────────────────────────────────────────────
router.patch('/:id/cancel', hstProtect, async (req, res, next) => {
  try {
    const booking = await hstLaundryBooking.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      { status: 'cancelled' },
      { returnDocument: 'after' }
    );
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    res.json({ success: true, booking });
  } catch (err) { next(err); }
});

// ── Mark done — resident marks own, admin marks any ─────────────────────────
router.patch('/:id/done', hstProtect, async (req, res, next) => {
  try {
    const filter = req.user.role === 'admin'
      ? { _id: req.params.id }
      : { _id: req.params.id, userId: req.user._id };

    const booking = await hstLaundryBooking.findOneAndUpdate(
      { ...filter, status: 'booked' },
      { status: 'done' },
      { returnDocument: 'after' }
    ).populate('userId', 'name phone');
    if (!booking) return res.status(404).json({ error: 'Booking not found or not active' });

    // Notify resident when admin marks done
    if (req.user.role === 'admin') {
      await hstSendWhatsApp(booking.userId.phone,
        `✅ *Laundry Done!*\n\n` +
        `Hi ${booking.userId.name}, your laundry slot has been marked as completed.\n\n` +
        `Slot    : ${fmt12(booking.slotTime)}\n` +
        `Machine : #${booking.machineNo}\n` +
        `Date    : ${new Date(booking.date + 'T00:00:00').toLocaleDateString('en-IN', { dateStyle: 'medium' })}`
      );
    }

    res.json({ success: true, booking });
  } catch (err) { next(err); }
});

// ── Admin: all bookings (optionally filter by date) ──────────────────────────
router.get('/admin/bookings', hstProtect, hstAdminOnly, async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.date) filter.date = req.query.date;
    const bookings = await hstLaundryBooking.find(filter)
      .populate('userId', 'name phone roomId')
      .sort('date slotTime machineNo');
    res.json({ success: true, bookings });
  } catch (err) { next(err); }
});

// ── Admin: get laundry settings ──────────────────────────────────────────────
router.get('/admin/settings', hstProtect, hstAdminOnly, async (req, res, next) => {
  try {
    const settings = await hstSettings.findOne();
    res.json({ success: true, settings });
  } catch (err) { next(err); }
});

// ── Admin: update laundry settings ──────────────────────────────────────────
router.patch('/admin/settings', hstProtect, hstAdminOnly, async (req, res, next) => {
  try {
    const { laundryDays, laundryStartTime, laundryEndTime, machineCount } = req.body;

    const update = {};
    if (Array.isArray(laundryDays))   update.laundryDays      = laundryDays;
    if (laundryStartTime)             update.laundryStartTime  = laundryStartTime;
    if (laundryEndTime)               update.laundryEndTime    = laundryEndTime;
    if (machineCount != null)         update.machineCount      = Number(machineCount);

    // Validate start < end
    if (update.laundryStartTime && update.laundryEndTime) {
      const [sh] = update.laundryStartTime.split(':').map(Number);
      const [eh] = update.laundryEndTime.split(':').map(Number);
      if (sh >= eh) return res.status(400).json({ error: 'Start time must be before end time' });
    }

    const settings = await hstSettings.findOneAndUpdate({}, { $set: update }, { returnDocument: 'after', upsert: true });
    res.json({ success: true, settings });
  } catch (err) { next(err); }
});

module.exports = router;
