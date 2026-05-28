const router = require('express').Router();
const Joi = require('joi');
const hstExpense = require('../models/hstExpense.model');
const hstBill    = require('../models/hstBill.model');
const { hstProtect, hstAdminOnly } = require('../middleware/hstAuth.middleware');
const { hstAudit } = require('../services/hstAudit.service');

// POST /api/v1/expenses  — log a new expense
router.post('/', hstProtect, hstAdminOnly, async (req, res, next) => {
  try {
    const schema = Joi.object({
      category:    Joi.string().valid('maintenance','salary','utilities','supplies','other').required(),
      amount:      Joi.number().min(0).required(),
      date:        Joi.date().required(),
      description: Joi.string().min(2).max(500).required(),
      receiptUrl:  Joi.string().uri().allow('', null).optional(),
    });
    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const expense = await hstExpense.create({ ...value, addedBy: req.user._id });
    hstAudit({ user: req.user, action: 'create', module: 'Settings', targetId: expense._id, targetLabel: `Expense: ${value.description}`, req });
    res.status(201).json({ success: true, expense });
  } catch (err) { next(err); }
});

// GET /api/v1/expenses  — list with optional month/year/category filters
router.get('/', hstProtect, hstAdminOnly, async (req, res, next) => {
  try {
    const { month, year, category, page = 1, limit = 50 } = req.query;
    const filter = {};
    if (category) filter.category = category;
    if (month && year) {
      const m = parseInt(month), y = parseInt(year);
      filter.date = {
        $gte: new Date(y, m - 1, 1),
        $lte: new Date(y, m, 0, 23, 59, 59),
      };
    } else if (year) {
      filter.date = { $gte: new Date(parseInt(year), 0, 1), $lte: new Date(parseInt(year), 11, 31, 23, 59, 59) };
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [expenses, total] = await Promise.all([
      hstExpense.find(filter).sort({ date: -1 }).skip(skip).limit(parseInt(limit)).populate('addedBy', 'name'),
      hstExpense.countDocuments(filter),
    ]);

    const totalAmount = expenses.reduce((s, e) => s + e.amount, 0);
    res.json({ success: true, expenses, total, totalAmount, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) });
  } catch (err) { next(err); }
});

// GET /api/v1/expenses/summary/:year/:month  — revenue vs expense for a month
router.get('/summary/:year/:month', hstProtect, hstAdminOnly, async (req, res, next) => {
  try {
    const year  = parseInt(req.params.year);
    const month = parseInt(req.params.month);

    const dateFrom = new Date(year, month - 1, 1);
    const dateTo   = new Date(year, month, 0, 23, 59, 59);

    const [bills, expenses] = await Promise.all([
      hstBill.find({ month, year }),
      hstExpense.find({ date: { $gte: dateFrom, $lte: dateTo } }),
    ]);

    const totalBilled    = bills.reduce((s, b) => s + b.total, 0);
    const totalCollected = bills.filter(b => b.isPaid).reduce((s, b) => s + b.total, 0);
    const partialPaid    = bills.filter(b => !b.isPaid && (b.paidAmount ?? 0) > 0).reduce((s, b) => s + (b.paidAmount ?? 0), 0);
    const totalReceived  = totalCollected + partialPaid;
    const totalOutstanding = totalBilled - totalReceived;

    const expenseByCategory = {};
    let totalExpenses = 0;
    for (const e of expenses) {
      expenseByCategory[e.category] = (expenseByCategory[e.category] ?? 0) + e.amount;
      totalExpenses += e.amount;
    }

    const netProfit = totalReceived - totalExpenses;

    res.json({
      success: true,
      year, month,
      revenue: { totalBilled, totalCollected, partialPaid, totalReceived, totalOutstanding, billCount: bills.length, unpaidCount: bills.filter(b => !b.isPaid).length },
      expenses: { total: totalExpenses, byCategory: expenseByCategory, count: expenses.length },
      netProfit,
    });
  } catch (err) { next(err); }
});

// GET /api/v1/expenses/report/overdue  — top overdue residents
router.get('/report/overdue', hstProtect, hstAdminOnly, async (req, res, next) => {
  try {
    const now   = new Date();
    const month = now.getMonth() + 1;
    const year  = now.getFullYear();

    // Unpaid bills — could span multiple months
    const unpaid = await hstBill.find({ isPaid: false })
      .populate('userId', 'name phone email roomId')
      .populate('roomId', 'roomNumber')
      .sort({ createdAt: 1 }); // oldest first

    // Group by resident
    const byResident = {};
    for (const bill of unpaid) {
      const uid = bill.userId?._id?.toString();
      if (!uid) continue;
      if (!byResident[uid]) {
        byResident[uid] = { resident: bill.userId, totalDue: 0, bills: [] };
      }
      const remaining = bill.total - (bill.paidAmount ?? 0);
      byResident[uid].totalDue += remaining;
      byResident[uid].bills.push({ id: bill._id, month: bill.month, year: bill.year, total: bill.total, paidAmount: bill.paidAmount ?? 0, remaining });
    }

    const ranked = Object.values(byResident)
      .filter(r => r.totalDue > 0)
      .sort((a, b) => b.totalDue - a.totalDue)
      .slice(0, 20);

    res.json({ success: true, overdue: ranked, currentMonth: month, currentYear: year });
  } catch (err) { next(err); }
});

// GET /api/v1/expenses/report/csv?month=&year=  — CSV export of expenses
router.get('/report/csv', hstProtect, hstAdminOnly, async (req, res, next) => {
  try {
    const { month, year } = req.query;
    const filter = {};
    if (month && year) {
      const m = parseInt(month), y = parseInt(year);
      filter.date = { $gte: new Date(y, m - 1, 1), $lte: new Date(y, m, 0, 23, 59, 59) };
    }
    const expenses = await hstExpense.find(filter).sort({ date: -1 }).populate('addedBy', 'name');

    const header = 'Date,Category,Description,Amount,Added By\n';
    const rows = expenses.map(e =>
      [
        new Date(e.date).toLocaleDateString('en-IN'),
        e.category,
        `"${e.description.replace(/"/g, '""')}"`,
        e.amount,
        e.addedBy?.name ?? '—',
      ].join(',')
    ).join('\n');

    const filename = month && year ? `expenses-${year}-${String(month).padStart(2,'0')}.csv` : 'expenses-all.csv';
    res.set({ 'Content-Type': 'text/csv', 'Content-Disposition': `attachment; filename="${filename}"` });
    res.send(header + rows);
  } catch (err) { next(err); }
});

// GET /api/v1/expenses/report/bills-csv?month=&year=  — CSV export of bills
router.get('/report/bills-csv', hstProtect, hstAdminOnly, async (req, res, next) => {
  try {
    const { month, year } = req.query;
    const filter = {};
    if (month) filter.month = parseInt(month);
    if (year)  filter.year  = parseInt(year);

    const bills = await hstBill.find(filter)
      .populate('userId', 'name email phone')
      .populate('roomId', 'roomNumber')
      .sort('-createdAt');

    const header = 'Resident,Email,Phone,Room,Month,Year,Rent,Electricity,Food,Total,Paid Amount,Status,Paid Date\n';
    const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const rows = bills.map(b =>
      [
        `"${b.userId?.name ?? ''}"`,
        b.userId?.email ?? '',
        b.userId?.phone ?? '',
        b.roomId?.roomNumber ?? '',
        MONTH_NAMES[(b.month ?? 1) - 1],
        b.year,
        b.rent,
        b.electricityShare,
        b.foodTotal,
        b.total,
        b.paidAmount ?? 0,
        b.isPaid ? 'Paid' : (b.paidAmount > 0 ? 'Partial' : 'Unpaid'),
        b.paidAt ? new Date(b.paidAt).toLocaleDateString('en-IN') : '',
      ].join(',')
    ).join('\n');

    const filename = month && year ? `bills-${year}-${String(month).padStart(2,'0')}.csv` : 'bills-all.csv';
    res.set({ 'Content-Type': 'text/csv', 'Content-Disposition': `attachment; filename="${filename}"` });
    res.send(header + rows);
  } catch (err) { next(err); }
});

// PATCH /api/v1/expenses/:id  — update
router.patch('/:id', hstProtect, hstAdminOnly, async (req, res, next) => {
  try {
    const allowed = ['category', 'amount', 'date', 'description', 'receiptUrl'];
    const updates = {};
    allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });
    const expense = await hstExpense.findByIdAndUpdate(req.params.id, updates, { returnDocument: 'after' });
    if (!expense) return res.status(404).json({ error: 'Expense not found' });
    hstAudit({ user: req.user, action: 'update', module: 'Settings', targetId: expense._id, targetLabel: expense.description, req });
    res.json({ success: true, expense });
  } catch (err) { next(err); }
});

// DELETE /api/v1/expenses/:id
router.delete('/:id', hstProtect, hstAdminOnly, async (req, res, next) => {
  try {
    const expense = await hstExpense.findByIdAndDelete(req.params.id);
    if (!expense) return res.status(404).json({ error: 'Expense not found' });
    hstAudit({ user: req.user, action: 'delete', module: 'Settings', targetLabel: expense.description, req });
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
