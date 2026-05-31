const hstUser = require('../models/hstUser.model');
const hstRoom = require('../models/hstRoom.model');
const hstBill = require('../models/hstBill.model');
const hstFoodBooking = require('../models/hstFoodBooking.model');
const hstSettings = require('../models/hstSettings.model');
const { hstGenerateBillPdf } = require('../services/hstPdf.service');
const { hstSendWhatsApp, hstSendWhatsAppWithPdf, hstSendEmail } = require('../services/hstNotification.service');
const { hstAudit } = require('../services/hstAudit.service');
const { hstNotify } = require('../services/hstInAppNotify.service');
const Razorpay = require('razorpay');

const rzp = new Razorpay({
  key_id:     process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function hstCalcElectricity(room, settings) {
  const units = Math.max(0, room.currentMeterReading - room.lastMeterReading);
  const roomCost = units * settings.electricityRate;
  const occupants = room.members.length || 1;
  return { share: Math.ceil(roomCost / occupants), units };
}

exports.hstGenerateBills = async (req, res, next) => {
  try {
    const settings = await hstSettings.findOne();
    if (!settings) return res.status(400).json({ error: 'Hostel settings not configured' });

    const now = new Date();
    const month = now.getMonth() + 1;
    const year  = now.getFullYear();

    const residents = await hstUser.find({ role: 'resident', isActive: true });
    const results = [];

    for (const resident of residents) {
      const existing = await hstBill.findOne({ userId: resident._id, month, year });
      if (existing) {
        results.push({ name: resident.name, status: 'skipped (already generated)' });
        continue;
      }

      const room = await hstRoom.findById(resident.roomId);
      if (!room) {
        results.push({ name: resident.name, status: 'skipped (no room)' });
        continue;
      }

      const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
      const endDate   = `${year}-${String(month).padStart(2, '0')}-31`;
      const bookings  = await hstFoodBooking.aggregate([
        { $match: { userId: resident._id, date: { $gte: startDate, $lte: endDate }, status: { $in: ['booked', 'consumed'] } } },
        { $group: { _id: '$meal', count: { $sum: 1 } } },
      ]);
      const mealCounts = { breakfast: 0, lunch: 0, dinner: 0 };
      bookings.forEach(b => { mealCounts[b._id] = b.count; });
      const foodTotal = (mealCounts.breakfast * settings.foodPrices.breakfast)
                      + (mealCounts.lunch     * settings.foodPrices.lunch)
                      + (mealCounts.dinner    * settings.foodPrices.dinner);

      const bc = resident.billComponents ?? { rent: true, electricity: true, food: true };
      const { share: electricityShare, units: ebUnits } = hstCalcElectricity(room, settings);
      const rent            = bc.rent        ? settings.rentPerRoom : 0;
      const ebCharge        = bc.electricity ? electricityShare     : 0;
      const foodCharge      = bc.food        ? foodTotal            : 0;
      const total           = rent + ebCharge + foodCharge;
      const totalPaise      = total * 100;

      let payLinkUrl = null;
      try {
        const payLink = await rzp.paymentLink.create({
          amount:      totalPaise,
          currency:    'INR',
          description: `Hostel bill for ${month}/${year} – ${resident.name}`,
          customer:    { name: resident.name, contact: `+91${resident.phone}`, email: resident.email },
          notify:      { sms: false, email: false },
          reminder_enable: false,
        });
        payLinkUrl = payLink.short_url;
      } catch (rzpErr) {
        console.error('[HST-BILLING] Razorpay link creation failed:', rzpErr.message);
      }

      const bill = await hstBill.create({
        userId: resident._id,
        roomId: room._id,
        month, year,
        rent:             rent,
        electricityShare: ebCharge,
        foodTotal:        foodCharge,
        total,
        paymentLink: payLinkUrl,
        billComponents: {
          rent:        bc.rent        ?? true,
          electricity: bc.electricity ?? true,
          food:        bc.food        ?? true,
        },
      });

      try {
        const pdfBuffer = await hstGenerateBillPdf(
          resident, bill, room, month, year,
          bc.electricity ? ebUnits : null,
          bc.electricity ? settings.electricityRate : null
        );

        const dueDateDay = settings.dueDateDay || 10;
        const dueDate    = `${dueDateDay} ${MONTH_NAMES[month - 1]} ${year}`;
        const lines = [];
        if (bc.rent)        lines.push(`Rent        : Rs.${rent}`);
        if (bc.electricity) lines.push(`EB (${ebUnits} units x Rs.${settings.electricityRate}) : Rs.${ebCharge}`);
        if (bc.food)        lines.push(`Food        : Rs.${foodCharge}`);
        const receiptNo = `HST-${bill._id.toString().slice(-8).toUpperCase()}`;
        const waMsg =
          `*Hostel Receipt – ${receiptNo}*\n` +
          `Hi ${resident.name}! Your bill for ${MONTH_NAMES[month - 1]} ${year}:\n\n` +
          lines.join('\n') + '\n' +
          `────────────────────\n` +
          `*Total : Rs.${total}*\n\n` +
          `Due Date: ${dueDate}` +
          (payLinkUrl ? `\nPay here: ${payLinkUrl}` : '') +
          `\n\n_Receipt PDF attached_`;
        await hstSendWhatsAppWithPdf(resident.phone, waMsg, pdfBuffer, `receipt_${receiptNo}.pdf`);

        await hstSendEmail({
          to:      resident.email,
          subject: `Hostel Receipt ${receiptNo} – ${MONTH_NAMES[month - 1]} ${year}`,
          html: `<p>Hi ${resident.name},</p><p>Please find your hostel receipt for ${MONTH_NAMES[month - 1]} ${year} attached.</p>` +
                `<p><strong>Total: Rs.${total}</strong></p>` +
                (payLinkUrl ? `<p>Pay online: <a href="${payLinkUrl}">${payLinkUrl}</a></p>` : ''),
          attachments: [{ filename: `receipt_${receiptNo}.pdf`, content: pdfBuffer }],
        });
      } catch (notifErr) {
        console.error('[HST-BILLING] Notification error:', notifErr.message);
      }

      hstNotify(resident._id, { type: 'bill_generated', title: 'New Bill Generated', message: `Your bill for ${MONTH_NAMES[month - 1]} ${year} is ₹${total}. Due by the ${settings.dueDateDay || 10}th.`, relatedId: bill._id, relatedModel: 'Bill' });
      results.push({ name: resident.name, status: 'generated', total });
    }

    hstAudit({ user: req.user, action: 'generate', module: 'Bill', targetLabel: `${month}/${year} – ${results.length} bills`, req });
    res.json({ success: true, results });
  } catch (err) { next(err); }
};

exports.hstGetAllBills = async (req, res, next) => {
  try {
    const { month, year } = req.query;
    const filter = {};
    if (month) filter.month = parseInt(month);
    if (year)  filter.year  = parseInt(year);
    const bills = await hstBill.find(filter)
      .populate('userId', 'name email phone')
      .populate('roomId', 'roomNumber floor')
      .sort('-createdAt');
    res.json({ success: true, bills });
  } catch (err) { next(err); }
};

exports.hstGetMyBills = async (req, res, next) => {
  try {
    const bills = await hstBill.find({ userId: req.user._id }).sort('-createdAt');
    res.json({ success: true, bills });
  } catch (err) { next(err); }
};

exports.hstMarkPaid = async (req, res, next) => {
  try {
    // components: { rent, electricity, food } — which parts are being paid now
    const { components } = req.body; // e.g. { rent: true, electricity: false, food: true }

    const bill = await hstBill.findById(req.params.id)
      .populate('userId', 'name phone email')
      .populate('roomId', 'roomNumber');
    if (!bill) return res.status(404).json({ error: 'Bill not found' });

    const now = new Date();
    const paidDate = now.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    const monthName = MONTH_NAMES[(bill.month ?? 1) - 1];

    // Determine which components are now paid (merge with previously paid)
    const prev = bill.paidComponents ?? { rent: false, electricity: false, food: false };
    const updatedComponents = {
      rent:        prev.rent        || (components?.rent        ?? false),
      electricity: prev.electricity || (components?.electricity ?? false),
      food:        prev.food        || (components?.food        ?? false),
    };

    // Calculate amount being paid in this transaction
    const payingNow =
      (!prev.rent        && updatedComponents.rent        ? bill.rent             : 0) +
      (!prev.electricity && updatedComponents.electricity ? bill.electricityShare : 0) +
      (!prev.food        && updatedComponents.food        ? bill.foodTotal        : 0);

    const totalPaidSoFar = (bill.paidAmount ?? 0) + payingNow;

    // Bill is fully paid if all applicable (non-zero) components are paid
    const rentDone  = bill.rent             === 0 || updatedComponents.rent;
    const ebDone    = bill.electricityShare === 0 || updatedComponents.electricity;
    const foodDone  = bill.foodTotal        === 0 || updatedComponents.food;
    const fullyPaid = rentDone && ebDone && foodDone;

    bill.paidComponents = updatedComponents;
    bill.paidAmount     = totalPaidSoFar;
    bill.isPaid         = fullyPaid;
    bill.paidAt         = fullyPaid ? now : bill.paidAt;
    await bill.save();

    // WhatsApp receipt for this payment
    if (bill.userId?.phone && payingNow > 0) {
      const lines = [];
      if (!prev.rent        && updatedComponents.rent)        lines.push(`Rent        : ₹${bill.rent}`);
      if (!prev.electricity && updatedComponents.electricity) lines.push(`Electricity : ₹${bill.electricityShare}`);
      if (!prev.food        && updatedComponents.food)        lines.push(`Food        : ₹${bill.foodTotal}`);

      const remaining = bill.total - totalPaidSoFar;
      const msg =
        `Hi ${bill.userId.name}! ✅ Payment Received\n\n` +
        `Room   : ${bill.roomId?.roomNumber ?? '?'}\n` +
        `Period : ${monthName} ${bill.year}\n` +
        `Date   : ${paidDate}\n\n` +
        `Paid now:\n${lines.join('\n')}\n` +
        `Amount : ₹${payingNow}\n` +
        `────────────────────\n` +
        (fullyPaid
          ? `*Total Paid : ₹${totalPaidSoFar} ✅ Fully Settled*\n\nThank you! 🙏`
          : `Paid so far : ₹${totalPaidSoFar}\nRemaining   : ₹${remaining}\n\nPlease clear the remaining balance.`);
      hstSendWhatsApp(bill.userId.phone, msg).catch(() => {});
    }

    hstAudit({ user: req.user, action: 'mark_paid', module: 'Bill', targetId: bill._id, targetLabel: `${bill.userId?.name} – ₹${payingNow}`, req });
    res.json({ success: true, bill });
  } catch (err) { next(err); }
};

// ── Shared reminder logic (used by cron + manual API) ─────────────────────────
async function sendBillRemindersInternal(type) {
  const settings = await hstSettings.findOne();
  if (!settings) throw new Error('Hostel settings not configured');

  const now      = new Date();
  const month    = now.getMonth() + 1;
  const year     = now.getFullYear();
  const today    = now.getDate();
  const dueDay   = settings.dueDateDay || 10;
  const monthName = MONTH_NAMES[month - 1];

  let reminderType = type;
  if (type === 'auto') {
    const diff = today - dueDay;
    if      (diff === -3) reminderType = 'pre-3';
    else if (diff === -2) reminderType = 'pre-2';
    else if (diff ===  1) reminderType = 'overdue';
    else if (diff ===  7) reminderType = 'last-warning';
    else return { sent: 0, type: 'none', message: 'No reminder scheduled for today' };
  }

  const unpaid = await hstBill.find({ month, year, isPaid: false })
    .populate('userId', 'name phone')
    .populate('roomId', 'roomNumber');

  let sent = 0;
  for (const bill of unpaid) {
    if (!bill.userId?.phone) continue;
    const name     = bill.userId.name;
    const room     = bill.roomId?.roomNumber ?? '?';
    const total    = bill.total;
    const payLine  = bill.paymentLink ? `\nPay here: ${bill.paymentLink}` : '';
    let msg = '';

    if (reminderType === 'pre-3') {
      msg =
        `Hi ${name}! 🔔 Bill Reminder – Room ${room}\n\n` +
        `Your hostel bill for ${monthName} ${year} is due in 3 days (by ${dueDay}th).\n\n` +
        `Rent        : ₹${bill.rent}\n` +
        `Electricity : ₹${bill.electricityShare}\n` +
        `Food        : ₹${bill.foodTotal}\n` +
        `────────────────────\n` +
        `Total       : ₹${total}${payLine}`;
    } else if (reminderType === 'pre-2') {
      msg =
        `Hi ${name}! ⚠️ Final Reminder – Room ${room}\n\n` +
        `Your hostel bill of ₹${total} for ${monthName} ${year} is due in 2 days (by ${dueDay}th).\n` +
        `Please pay soon to avoid a late charge.${payLine}`;
    } else if (reminderType === 'overdue') {
      msg =
        `Hi ${name}! 🚨 Bill Overdue – Room ${room}\n\n` +
        `Your hostel bill of ₹${total} for ${monthName} ${year} is now overdue.\n` +
        `Please pay immediately.${payLine}`;
    } else if (reminderType === 'last-warning') {
      msg =
        `Hi ${name}! 🚨 LAST WARNING – Room ${room}\n\n` +
        `Your bill of ₹${total} for ${monthName} ${year} is 7 days overdue.\n` +
        `Please contact the admin immediately.${payLine}`;
    }

    if (msg) {
      await hstSendWhatsApp(bill.userId.phone, msg);
      sent++;
    }
  }

  return { sent, type: reminderType, message: `Sent ${sent} reminder(s)` };
}

exports.sendBillRemindersInternal = sendBillRemindersInternal;

exports.hstSendSingleReminder = async (req, res, next) => {
  try {
    const { billId, type = 'pre-3' } = req.body;
    const validTypes = ['pre-3', 'pre-2', 'overdue', 'last-warning'];
    if (!billId) return res.status(400).json({ error: 'billId is required' });
    if (!validTypes.includes(type)) {
      return res.status(400).json({ error: `type must be one of: ${validTypes.join(', ')}` });
    }

    const bill = await hstBill.findById(billId)
      .populate('userId', 'name phone')
      .populate('roomId', 'roomNumber');
    if (!bill) return res.status(404).json({ error: 'Bill not found' });
    if (!bill.userId?.phone) return res.status(400).json({ error: 'Resident has no phone number' });

    const settings  = await hstSettings.findOne();
    const dueDay    = settings?.dueDateDay ?? 10;
    const monthName = MONTH_NAMES[(bill.month ?? 1) - 1];
    const name      = bill.userId.name;
    const room      = bill.roomId?.roomNumber ?? '?';
    const total     = bill.total;
    const payLine   = bill.paymentLink ? `\nPay here: ${bill.paymentLink}` : '';

    let msg = '';
    if (type === 'pre-3') {
      msg =
        `Hi ${name}! 🔔 Bill Reminder – Room ${room}\n\n` +
        `Your hostel bill for ${monthName} ${bill.year} is due in 3 days (by ${dueDay}th).\n\n` +
        `Rent        : ₹${bill.rent}\n` +
        `Electricity : ₹${bill.electricityShare}\n` +
        `Food        : ₹${bill.foodTotal}\n` +
        `────────────────────\n` +
        `Total       : ₹${total}${payLine}`;
    } else if (type === 'pre-2') {
      msg =
        `Hi ${name}! ⚠️ Final Reminder – Room ${room}\n\n` +
        `Your hostel bill of ₹${total} for ${monthName} ${bill.year} is due in 2 days (by ${dueDay}th).\n` +
        `Please pay soon to avoid a late charge.${payLine}`;
    } else if (type === 'overdue') {
      msg =
        `Hi ${name}! 🚨 Bill Overdue – Room ${room}\n\n` +
        `Your hostel bill of ₹${total} for ${monthName} ${bill.year} is now overdue.\n` +
        `Please pay immediately.${payLine}`;
    } else if (type === 'last-warning') {
      msg =
        `Hi ${name}! 🚨 LAST WARNING – Room ${room}\n\n` +
        `Your bill of ₹${total} for ${monthName} ${bill.year} is 7 days overdue.\n` +
        `Please contact the admin immediately.${payLine}`;
    }

    await hstSendWhatsApp(bill.userId.phone, msg);
    res.json({ success: true, message: `Reminder sent to ${name}` });
  } catch (err) { next(err); }
};

exports.hstSendBillReminders = async (req, res, next) => {
  try {
    const { type = 'auto' } = req.body;
    const validTypes = ['auto', 'pre-3', 'pre-2', 'overdue', 'last-warning'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({ error: `type must be one of: ${validTypes.join(', ')}` });
    }
    const result = await sendBillRemindersInternal(type);
    res.json({ success: true, ...result });
  } catch (err) { next(err); }
};

exports.hstRecalculateRoomBills = async (req, res, next) => {
  try {
    const { roomId, month, year } = req.body;
    if (!roomId || !month || !year) {
      return res.status(400).json({ error: 'roomId, month, and year are required' });
    }

    const room = await hstRoom.findById(roomId).populate('members', '_id');
    if (!room) return res.status(404).json({ error: 'Room not found' });

    const settings = await hstSettings.findOne();
    if (!settings) return res.status(400).json({ error: 'Hostel settings not configured' });

    const units = Math.max(0, room.currentMeterReading - room.lastMeterReading);
    const { share: electricityShare } = hstCalcElectricity(room, settings);

    const bills = await hstBill.find({ roomId, month: Number(month), year: Number(year) })
      .populate('userId', 'name phone');
    if (bills.length === 0) {
      return res.json({ success: true, updated: 0, message: 'No existing bills found for this room and period' });
    }

    const monthName = MONTH_NAMES[Number(month) - 1];

    let updated = 0;
    for (const bill of bills) {
      if (bill.isPaid) continue;
      bill.electricityShare = electricityShare;
      bill.total = bill.rent + electricityShare + bill.foodTotal;
      await bill.save();
      updated++;

      // WhatsApp notification
      if (bill.userId?.phone) {
        const msg =
          `Hi ${bill.userId.name}!\n\n` +
          `⚡ Electricity Bill Updated – Room ${room.roomNumber}\n\n` +
          `Units used  : ${units} units\n` +
          `EB charge   : ₹${electricityShare} (split among ${room.members.length} resident${room.members.length !== 1 ? 's' : ''})\n` +
          `────────────────────\n` +
          `Rent        : ₹${bill.rent}\n` +
          `Food        : ₹${bill.foodTotal}\n` +
          `Total       : ₹${bill.total}\n\n` +
          `Period: ${monthName} ${year}` +
          (bill.paymentLink ? `\nPay here: ${bill.paymentLink}` : '');
        hstSendWhatsApp(bill.userId.phone, msg).catch(() => {});
      }
    }

    res.json({ success: true, updated, message: `Updated ${updated} bill(s) for Room ${room.roomNumber}` });
  } catch (err) { next(err); }
};

exports.hstGetSettings = async (req, res, next) => {
  try {
    let settings = await hstSettings.findOne();
    if (!settings) settings = await hstSettings.create({});
    res.json({ success: true, settings });
  } catch (err) { next(err); }
};

exports.hstUpdateSettings = async (req, res, next) => {
  try {
    const allowed = ['hostelName', 'rentPerRoom', 'electricityRate', 'foodPrices', 'laundrySlots', 'machineCount', 'dueDateDay'];
    const updates = {};
    allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });

    let settings = await hstSettings.findOne();
    if (!settings) {
      settings = await hstSettings.create(updates);
    } else {
      Object.assign(settings, updates);
      await settings.save();
    }
    hstAudit({ user: req.user, action: 'update', module: 'Settings', targetLabel: 'Billing settings', req });
    res.json({ success: true, settings });
  } catch (err) { next(err); }
};
