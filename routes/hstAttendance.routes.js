const router = require('express').Router();
const { hstProtect, hstAdminOnly } = require('../middleware/hstAuth.middleware');
const hstAttendance = require('../models/hstAttendance.model');
const hstUser = require('../models/hstUser.model');
const hstOutPass = require('../models/hstOutPass.model');

// Middleware: admin, warden, or accountant may access
const hstStaffOrAdmin = (req, res, next) => {
  const allowed = ['admin', 'warden', 'accountant'];
  if (!allowed.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
  next();
};

// GET /attendance?date=YYYY-MM-DD — get all residents' attendance for a date
router.get('/', hstProtect, hstStaffOrAdmin, async (req, res, next) => {
  try {
    const date = req.query.date || new Date().toISOString().split('T')[0];
    const [residents, records] = await Promise.all([
      hstUser.find({ role: 'resident', isActive: true }).select('name roomId').populate('roomId', 'roomNumber floor'),
      hstAttendance.find({ date }).select('resident status note markedBy'),
    ]);

    const map = {};
    records.forEach(r => { map[r.resident.toString()] = r; });

    const list = residents.map(r => ({
      resident: { _id: r._id, name: r.name, room: r.roomId },
      status:   map[r._id.toString()]?.status ?? 'absent',
      note:     map[r._id.toString()]?.note ?? null,
      recorded: !!map[r._id.toString()],
    }));

    res.json({ success: true, date, attendance: list });
  } catch (err) { next(err); }
});

// POST /attendance/mark — mark/update single or bulk attendance
// body: { date, records: [{ residentId, status, note }] }
router.post('/mark', hstProtect, hstStaffOrAdmin, async (req, res, next) => {
  try {
    const { date, records } = req.body;
    if (!date || !Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ error: 'date and records[] are required' });
    }

    const ops = records.map(r => ({
      updateOne: {
        filter: { date, resident: r.residentId },
        update: { $set: { status: r.status, note: r.note ?? null, markedBy: req.user._id } },
        upsert: true,
      },
    }));
    await hstAttendance.bulkWrite(ops);
    res.json({ success: true, marked: records.length });
  } catch (err) { next(err); }
});

// GET /attendance/monthly?residentId=&month=&year= — per-resident monthly summary
router.get('/monthly', hstProtect, async (req, res, next) => {
  try {
    const { month, year } = req.query;
    const residentId = req.user.role === 'resident' ? req.user._id.toString() : req.query.residentId;
    if (!residentId) return res.status(400).json({ error: 'residentId required' });

    const m = parseInt(month) || new Date().getMonth() + 1;
    const y = parseInt(year)  || new Date().getFullYear();
    const pad = n => String(n).padStart(2, '0');

    const prefix = `${y}-${pad(m)}-`;
    const records = await hstAttendance.find({
      resident: residentId,
      date: { $regex: `^${prefix}` },
    }).sort({ date: 1 });

    const summary = { present: 0, absent: 0, on_outpass: 0, on_leave: 0 };
    records.forEach(r => { if (summary[r.status] !== undefined) summary[r.status]++; });

    res.json({ success: true, month: m, year: y, records, summary });
  } catch (err) { next(err); }
});

// GET /attendance/report?month=&year= — admin monthly report across all residents
router.get('/report', hstProtect, hstStaffOrAdmin, async (req, res, next) => {
  try {
    const m = parseInt(req.query.month) || new Date().getMonth() + 1;
    const y = parseInt(req.query.year)  || new Date().getFullYear();
    const pad = n => String(n).padStart(2, '0');
    const prefix = `${y}-${pad(m)}-`;

    const [residents, records] = await Promise.all([
      hstUser.find({ role: 'resident', isActive: true }).select('name roomId').populate('roomId', 'roomNumber'),
      hstAttendance.find({ date: { $regex: `^${prefix}` } }),
    ]);

    const byResident = {};
    records.forEach(r => {
      const id = r.resident.toString();
      if (!byResident[id]) byResident[id] = { present: 0, absent: 0, on_outpass: 0, on_leave: 0 };
      if (byResident[id][r.status] !== undefined) byResident[id][r.status]++;
    });

    const report = residents.map(r => ({
      resident: { _id: r._id, name: r.name, room: r.roomId?.roomNumber ?? '—' },
      ...( byResident[r._id.toString()] ?? { present: 0, absent: 0, on_outpass: 0, on_leave: 0 }),
    }));

    res.json({ success: true, month: m, year: y, report });
  } catch (err) { next(err); }
});

module.exports = router;
