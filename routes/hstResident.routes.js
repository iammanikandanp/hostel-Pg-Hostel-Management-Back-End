const router = require('express').Router();
const { hstProtect, hstAdminOnly } = require('../middleware/hstAuth.middleware');
const hstUpload = require('../middleware/hstUpload.middleware');
const {
  hstGetAllResidents,
  hstAddResident,
  hstMoveOut,
  hstGetMyProfile,
  hstUpdateMyProfile,
  hstGetResident,
  hstUpdateResident,
  hstReallocateResident,
} = require('../controllers/hstResident.controller');

const hstRoom = require('../models/hstRoom.model');
const hstUser = require('../models/hstUser.model');
const hstBill = require('../models/hstBill.model');
const hstOutPass = require('../models/hstOutPass.model');
const hstFoodBooking = require('../models/hstFoodBooking.model');
const { hstGenerateRentReceipt, hstGenerateResidencyCertificate } = require('../services/hstPdf.service');

router.get('/me',                hstProtect,               hstGetMyProfile);
router.patch('/me',              hstProtect,               hstUpload.single('profilePhoto'), hstUpdateMyProfile);

// GET /api/v1/residents/me/receipt/:billId  — download formal rent receipt PDF
router.get('/me/receipt/:billId', hstProtect, async (req, res, next) => {
  try {
    const bill = await hstBill.findOne({ _id: req.params.billId, userId: req.user._id })
      .populate('userId', 'name email phone')
      .populate('roomId', 'roomNumber floor');
    if (!bill) return res.status(404).json({ error: 'Bill not found' });
    const pdf = await hstGenerateRentReceipt(bill);
    const filename = `rent-receipt-${MONTH_NAMES[bill.month - 1]}-${bill.year}.pdf`;
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${filename}"` });
    res.send(pdf);
  } catch (err) { next(err); }
});

// GET /api/v1/residents/me/certificate  — download residency certificate PDF
router.get('/me/certificate', hstProtect, async (req, res, next) => {
  try {
    const user = await hstUser.findById(req.user._id).populate('roomId', 'roomNumber floor').select('-password');
    const pdf = await hstGenerateResidencyCertificate(user);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="residency-certificate.pdf"` });
    res.send(pdf);
  } catch (err) { next(err); }
});

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
// GET /residents/me/room-history — resident's own room transfer history
router.get('/me/room-history', hstProtect, async (req, res, next) => {
  try {
    const user = await hstUser.findById(req.user._id)
      .select('roomHistory roomId')
      .populate('roomHistory.roomId', 'roomNumber floor type');
    res.json({ success: true, roomHistory: user.roomHistory ?? [] });
  } catch (err) { next(err); }
});

// GET /residents/:id/room-history — admin view
router.get('/:id/room-history', hstProtect, hstAdminOnly, async (req, res, next) => {
  try {
    const user = await hstUser.findById(req.params.id).select('roomHistory name');
    if (!user) return res.status(404).json({ error: 'Resident not found' });
    res.json({ success: true, roomHistory: user.roomHistory ?? [] });
  } catch (err) { next(err); }
});

router.get('/',                  hstProtect, hstAdminOnly, hstGetAllResidents);
router.get('/:id',               hstProtect, hstAdminOnly, hstGetResident);
router.post('/',                 hstProtect, hstAdminOnly, hstUpload.fields([{ name: 'profilePhoto', maxCount: 1 }, { name: 'idProof', maxCount: 1 }]), hstAddResident);
router.patch('/:id',             hstProtect, hstAdminOnly, hstUpload.fields([{ name: 'profilePhoto', maxCount: 1 }, { name: 'idProof', maxCount: 1 }]), hstUpdateResident);
router.patch('/:id/moveout',     hstProtect, hstAdminOnly, hstMoveOut);
router.patch('/:id/reallocate',  hstProtect, hstAdminOnly, hstReallocateResident);

// Admin dashboard summary
router.get('/admin/dashboard', hstProtect, hstAdminOnly, async (req, res, next) => {
  try {
    const now = new Date();
    const month = now.getMonth() + 1;
    const year  = now.getFullYear();
    const today = now.toISOString().split('T')[0];

    const [totalRooms, residents, bills, pendingOutpasses, foodCounts] = await Promise.all([
      hstRoom.find({ isActive: true }),
      hstUser.find({ role: 'resident', isActive: true }),
      hstBill.find({ month, year }),
      hstOutPass.countDocuments({ status: 'pending' }),
      hstFoodBooking.aggregate([
        { $match: { date: today, status: 'booked' } },
        { $group: { _id: '$meal', count: { $sum: 1 } } },
      ]),
    ]);

    const food = { breakfast: 0, lunch: 0, dinner: 0 };
    foodCounts.forEach(f => { food[f._id] = f.count; });

    const totalSeats   = totalRooms.reduce((a, r) => a + r.capacity, 0);
    const takenSeats   = totalRooms.reduce((a, r) => a + r.members.length, 0);

    res.json({
      success: true,
      rooms: {
        total: totalRooms.length,
        totalSeats,
        takenSeats,
        availableSeats: totalSeats - takenSeats,
      },
      billing: {
        totalDue:        bills.reduce((a, b) => a + b.total, 0),
        totalPaid:       bills.filter(b => b.isPaid).reduce((a, b) => a + b.total, 0),
        unpaidResidents: bills.filter(b => !b.isPaid).length,
      },
      residents: residents.length,
      todayFood: food,
      pendingOutpassRequests: pendingOutpasses,
    });
  } catch (err) { next(err); }
});

module.exports = router;
