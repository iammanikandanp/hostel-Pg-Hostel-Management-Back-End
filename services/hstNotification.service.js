const twilio = require('twilio');
const { Resend } = require('resend');
const cloudinary = require('cloudinary').v2;

const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const resend = new Resend(process.env.RESEND_API_KEY);

exports.hstSendWhatsApp = async (phone, message) => {
  try {
    await twilioClient.messages.create({
      from: `whatsapp:${process.env.TWILIO_WHATSAPP_FROM}`,
      to:   `whatsapp:+91${phone}`,
      body: message,
    });
  } catch (err) {
    console.error(`[HST-WHATSAPP] Failed to +91${phone}:`, err.message);
  }
};

// Upload PDF buffer to Cloudinary (public, temporary), send via Twilio mediaUrl, then delete.
exports.hstSendWhatsAppWithPdf = async (phone, message, pdfBuffer, filename) => {
  let publicId = null;
  try {
    // Upload PDF as a raw file with public access so Twilio can fetch it
    const uploadResult = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          resource_type: 'raw',
          folder: 'hostel-receipts',
          public_id: filename.replace('.pdf', ''),
          access_mode: 'public',
          format: 'pdf',
        },
        (err, result) => (err ? reject(err) : resolve(result))
      );
      stream.end(pdfBuffer);
    });
    publicId = uploadResult.public_id;

    await twilioClient.messages.create({
      from:      `whatsapp:${process.env.TWILIO_WHATSAPP_FROM}`,
      to:        `whatsapp:+91${phone}`,
      body:      message,
      mediaUrl:  [uploadResult.secure_url],
    });
  } catch (err) {
    console.error(`[HST-WHATSAPP-PDF] Failed to +91${phone}:`, err.message);
    // Fallback: send text-only if PDF send fails
    try {
      await twilioClient.messages.create({
        from: `whatsapp:${process.env.TWILIO_WHATSAPP_FROM}`,
        to:   `whatsapp:+91${phone}`,
        body: message.replace('\n\n_Receipt PDF attached_', ''),
      });
    } catch (fbErr) {
      console.error(`[HST-WHATSAPP-PDF] Fallback also failed:`, fbErr.message);
    }
  } finally {
    // Clean up the uploaded PDF from Cloudinary after a short delay
    if (publicId) {
      setTimeout(() => {
        cloudinary.uploader.destroy(publicId, { resource_type: 'raw' }).catch(() => {});
      }, 5 * 60 * 1000); // delete after 5 minutes (enough time for Twilio to fetch)
    }
  }
};

exports.hstSendEmail = async ({ to, subject, html, attachments = [] }) => {
  try {
    await resend.emails.send({
      from:        process.env.FROM_EMAIL,
      to,
      subject,
      html,
      attachments,
    });
  } catch (err) {
    console.error(`[HST-EMAIL] Failed to ${to}:`, err.message);
  }
};
