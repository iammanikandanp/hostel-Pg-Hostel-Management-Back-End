const cron = require('node-cron');
const hstUser = require('../models/hstUser.model');
const hstFoodBooking = require('../models/hstFoodBooking.model');
const hstOutPass = require('../models/hstOutPass.model');
const hstLatecome = require('../models/hstLatecome.model');
const hstAttendance = require('../models/hstAttendance.model');
const hstMaintenanceTask = require('../models/hstMaintenanceTask.model');
const { hstSendWhatsApp } = require('./hstNotification.service');
const { sendBillRemindersInternal } = require('../controllers/hstBilling.controller');

const fmt = (date) =>
  new Date(date).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

// ── Daily 8 AM — food booking reminder ──────────────────────────────────────
cron.schedule('0 8 * * *', async () => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const residents = await hstUser.find({ role: 'resident', isActive: true });
    for (const r of residents) {
      const alreadyBooked = await hstFoodBooking.findOne({ userId: r._id, date: today, status: 'booked' });
      if (!alreadyBooked) {
        await hstSendWhatsApp(r.phone,
          `🍽️ Hi ${r.name}! Don't forget to book your meals for today.\nCutoff: 9 PM tonight.`
        );
      }
    }
  } catch (err) {
    console.error('[HST-CRON] Food reminder error:', err.message);
  }
});

// ── Daily 9 AM — smart bill reminders ───────────────────────────────────────
cron.schedule('0 9 * * *', async () => {
  try {
    const result = await sendBillRemindersInternal('auto');
    if (result.sent > 0) {
      console.log(`[HST-CRON] Bill reminders (${result.type}): sent to ${result.sent} resident(s)`);
    }
  } catch (err) {
    console.error('[HST-CRON] Bill reminder error:', err.message);
  }
});

// ── Every 5 min — out-pass return reminders + overdue alerts ────────────────
cron.schedule('*/5 * * * *', async () => {
  try {
    const now          = new Date();
    const in30min      = new Date(now.getTime() + 30 * 60 * 1000);
    const fiveMinAgo   = new Date(now.getTime() - 5 * 60 * 1000);

    // 1. 30-min reminder — send once (reminderSent flag)
    const dueSoon = await hstOutPass.find({
      status:         'approved',
      expectedReturn: { $gte: now, $lte: in30min },
      reminderSent:   false,
    }).populate('userId', 'name phone');

    for (const op of dueSoon) {
      await hstSendWhatsApp(op.userId.phone,
        `⏰ *Return Reminder*\n\n` +
        `Hi ${op.userId.name}, you need to return to the hostel in ~30 minutes.\n\n` +
        `Return by   : ${fmt(op.expectedReturn)}\n` +
        `Destination : ${op.destination}\n\n` +
        `If you need more time, request an extension from the app.`
      );
      op.reminderSent = true;
      await op.save();
    }

    // 2. Overdue — expectedReturn passed in the last 5 min (fresh overdue only)
    const freshOverdue = await hstOutPass.find({
      status:         'approved',
      expectedReturn: { $gte: fiveMinAgo, $lt: now },
      overdueSent:    false,
    }).populate('userId', 'name phone');

    for (const op of freshOverdue) {
      // Alert resident
      await hstSendWhatsApp(op.userId.phone,
        `🚨 *Return Time Passed!*\n\n` +
        `Hi ${op.userId.name}, your return time has passed.\n\n` +
        `Was due at  : ${fmt(op.expectedReturn)}\n` +
        `Destination : ${op.destination}\n\n` +
        `Please choose:\n` +
        `1️⃣ Return now and tap *"Mark as Returned"* in the app\n` +
        `2️⃣ Need more time? Tap *"Request Extension"* in the app and give a reason`
      );

      // Alert admin
      await hstSendWhatsApp(process.env.ADMIN_PHONE,
        `🚨 *Overdue Out-Pass*\n\n` +
        `Resident    : ${op.userId.name}\n` +
        `Destination : ${op.destination}\n` +
        `Was due at  : ${fmt(op.expectedReturn)}\n\n` +
        `Resident has been notified. Waiting for return or extension request.`
      );

      op.overdueSent = true;
      await op.save();
    }

  } catch (err) {
    console.error('[HST-CRON] OutPass check error:', err.message);
  }
});

// ── Every 5 min — late come not-arrived alerts ───────────────────────────────
cron.schedule('*/5 * * * *', async () => {
  try {
    const now        = new Date();
    const plus15     = new Date(now.getTime() + 15 * 60 * 1000);
    const minus15    = new Date(now.getTime() - 15 * 60 * 1000);

    // Approved requests whose expectedArrival passed 15 min ago and not yet arrived
    const notArrived = await hstLatecome.find({
      status:           'approved',
      expectedArrival:  { $gte: minus15, $lt: now },
      arrivalAlertSent: false,
    }).populate('userId', 'name phone');

    for (const lc of notArrived) {
      // Alert resident
      await hstSendWhatsApp(lc.userId.phone,
        `🚨 *Still Not Arrived?*\n\n` +
        `Hi ${lc.userId.name}, your expected arrival time has passed.\n\n` +
        `Expected : ${fmt(lc.expectedArrival)}\n\n` +
        `Please tap *"I'm Back"* in the app once you arrive, or contact admin.`
      );

      // Alert admin
      await hstSendWhatsApp(process.env.ADMIN_PHONE,
        `🚨 *Late Come – Not Arrived*\n\n` +
        `Resident         : ${lc.userId.name}\n` +
        `Expected Arrival : ${fmt(lc.expectedArrival)}\n\n` +
        `Resident has NOT marked arrival yet. Please follow up.`
      );

      lc.arrivalAlertSent = true;
      await lc.save();
    }
  } catch (err) {
    console.error('[HST-CRON] Latecome check error:', err.message);
  }
});

// ── Daily 10 PM — nightly attendance auto-seed (create absent records for all active residents) ──
cron.schedule('0 22 * * *', async () => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const [residents, approvedOutpasses] = await Promise.all([
      hstUser.find({ role: 'resident', isActive: true }).select('_id'),
      hstOutPass.find({
        status: 'approved',
        expectedReturn: { $gt: new Date() },
      }).select('userId'),
    ]);

    const onOutpassIds = new Set(approvedOutpasses.map(o => o.userId.toString()));

    const ops = residents.map(r => ({
      updateOne: {
        filter: { date: today, resident: r._id },
        // Only insert if not already marked — don't overwrite manual entries
        update: {
          $setOnInsert: {
            status:   onOutpassIds.has(r._id.toString()) ? 'on_outpass' : 'absent',
            markedBy: null,
            note:     'Auto-seeded',
          },
        },
        upsert: true,
      },
    }));

    const result = await hstAttendance.bulkWrite(ops);
    if (result.upsertedCount > 0) {
      console.log(`[HST-CRON] Attendance seeded: ${result.upsertedCount} records for ${today}`);
    }
  } catch (err) {
    console.error('[HST-CRON] Attendance seed error:', err.message);
  }
});

// ── Daily 8 AM — maintenance due/overdue reminders ────────────────────────────
cron.schedule('30 8 * * *', async () => {
  try {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    const dueTasks = await hstMaintenanceTask.find({
      isActive:     true,
      reminderSent: false,
      nextDueDate:  { $lte: tomorrow },
    });

    for (const task of dueTasks) {
      const isOverdue = task.nextDueDate < new Date();
      await hstSendWhatsApp(
        process.env.ADMIN_PHONE,
        `🔧 *Maintenance ${isOverdue ? 'OVERDUE' : 'Due Tomorrow'}*\n\n` +
        `Task      : ${task.taskName}\n` +
        `Due Date  : ${task.nextDueDate.toLocaleDateString('en-IN')}\n` +
        `Frequency : ${task.frequency}\n` +
        (task.assignedTo ? `Assigned  : ${task.assignedTo}\n` : '') +
        `\nPlease mark it complete in the admin panel once done.`
      );
      task.reminderSent = true;
      await task.save();
    }

    if (dueTasks.length) {
      console.log(`[HST-CRON] Maintenance reminders sent: ${dueTasks.length}`);
    }
  } catch (err) {
    console.error('[HST-CRON] Maintenance reminder error:', err.message);
  }
});

console.log('[HST-CRON] All scheduled jobs registered');
