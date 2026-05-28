const crypto = require('crypto');
const router = require('express').Router();
const hstBill = require('../models/hstBill.model');
const { hstSendWhatsApp, hstSendEmail } = require('../services/hstNotification.service');

router.post('/razorpay', async (req, res) => {
  try {
    const signature = req.headers['x-razorpay-signature'];
    const body = req.body;

    const expected = crypto
      .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
      .update(body)
      .digest('hex');

    if (signature !== expected) {
      console.warn('[HST-WEBHOOK] Invalid signature – possible spoof attempt');
      return res.status(400).send('Invalid signature');
    }

    const event = JSON.parse(body);

    if (event.event === 'payment.captured') {
      const entity    = event.payload.payment.entity;
      const billId    = entity.notes?.billId;
      const amount    = entity.amount / 100;
      const paymentId = entity.id;

      if (!billId) return res.json({ status: 'ignored' });

      const bill = await hstBill.findByIdAndUpdate(
        billId,
        { isPaid: true, paidAt: new Date(), paymentId },
        { returnDocument: 'after' }
      ).populate('userId');

      if (bill) {
        await hstSendWhatsApp(bill.userId.phone,
          `Payment received! Rs.${amount} for ${bill.month}/${bill.year}.\nPayment ID: ${paymentId}\nThank you!`
        );
        await hstSendEmail({
          to:      bill.userId.email,
          subject: `Payment receipt – Rs.${amount}`,
          html:    `<p>Payment of Rs.${amount} received. ID: ${paymentId}</p>`,
        });
      }
    }

    res.json({ status: 'ok' });
  } catch (err) {
    console.error('[HST-WEBHOOK]', err.message);
    res.status(500).send('Internal error');
  }
});

module.exports = router;
