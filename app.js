require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const mongoSanitize = require('express-mongo-sanitize');
const xss = require('xss-clean');
const hpp = require('hpp');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');

const hstConnectDb = require('./config/hstDb.config');
const hstErrorHandler = require('./middleware/hstErrorHandler.middleware');

// Routes
const hstAuthRoutes = require('./routes/hstAuth.routes');
const hstRoomRoutes = require('./routes/hstRoom.routes');
const hstResidentRoutes = require('./routes/hstResident.routes');
const hstBillingRoutes = require('./routes/hstBilling.routes');
const hstFoodRoutes = require('./routes/hstFood.routes');
const hstLaundryRoutes = require('./routes/hstLaundry.routes');
const hstOutPassRoutes  = require('./routes/hstOutPass.routes');
const hstLatecomeRoutes   = require('./routes/hstLatecome.routes');
const hstComplaintRoutes  = require('./routes/hstComplaint.routes');
const hstWebhookRoutes    = require('./routes/hstWebhook.routes');
const hstAuditLogRoutes   = require('./routes/hstAuditLog.routes');
const hstStaffRoutes      = require('./routes/hstStaff.routes');
const hstVisitorRoutes    = require('./routes/hstVisitor.routes');
const hstNoticeRoutes         = require('./routes/hstNotice.routes');
const hstNotificationRoutes   = require('./routes/hstNotification.routes');
const hstExpenseRoutes        = require('./routes/hstExpense.routes');
const hstFoodMenuRoutes       = require('./routes/hstFoodMenu.routes');
const hstAttendanceRoutes     = require('./routes/hstAttendance.routes');
const hstWaitlistRoutes       = require('./routes/hstWaitlist.routes');
const hstMaintenanceRoutes    = require('./routes/hstMaintenance.routes');
const hstAssetRoutes          = require('./routes/hstAsset.routes');

// Cron jobs (auto-start)
require('./services/hstCron.service');

const app = express();

// ── Database ──────────────────────────────────
hstConnectDb();

// ── Trust proxy (for rate limiting behind Render/Vercel) ──
app.set('trust proxy', 1);

// ── Security Headers ──────────────────────────
app.use(helmet());

// ── CORS – whitelist only frontend origin ─────
app.use(cors({
  origin: process.env.FRONTEND_URL,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
}));

// ── Webhook raw body (must be before json()) ──
app.use('/api/v1/webhook/razorpay', express.raw({ type: 'application/json' }));

// ── Body Parsers ──────────────────────────────
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));
app.use(cookieParser());

// ── Input Sanitization ────────────────────────
app.use(mongoSanitize());
app.use(xss());
app.use(hpp());

// ── Global Rate Limit ─────────────────────────
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests. Try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/v1/', globalLimiter);

// ── Health Check ──────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// ── API Routes (v1) ───────────────────────────
app.use('/api/v1/auth',       hstAuthRoutes);
app.use('/api/v1/rooms',      hstRoomRoutes);
app.use('/api/v1/residents',  hstResidentRoutes);
app.use('/api/v1/billing',    hstBillingRoutes);
app.use('/api/v1/food',       hstFoodRoutes);
app.use('/api/v1/laundry',    hstLaundryRoutes);
app.use('/api/v1/outpass',    hstOutPassRoutes);
app.use('/api/v1/latecome',   hstLatecomeRoutes);
app.use('/api/v1/complaints', hstComplaintRoutes);
app.use('/api/v1/webhook',    hstWebhookRoutes);
app.use('/api/v1/audit',     hstAuditLogRoutes);
app.use('/api/v1/staff',     hstStaffRoutes);
app.use('/api/v1/visitors',  hstVisitorRoutes);
app.use('/api/v1/notices',        hstNoticeRoutes);
app.use('/api/v1/notifications',  hstNotificationRoutes);
app.use('/api/v1/expenses',       hstExpenseRoutes);
app.use('/api/v1/food-menu',      hstFoodMenuRoutes);
app.use('/api/v1/attendance',     hstAttendanceRoutes);
app.use('/api/v1/waitlist',       hstWaitlistRoutes);
app.use('/api/v1/maintenance',    hstMaintenanceRoutes);
app.use('/api/v1/assets',         hstAssetRoutes);

// ── 404 Handler ───────────────────────────────
app.use((req, res) => res.status(404).json({ error: 'Route not found' }));

// ── Global Error Handler ──────────────────────
app.use(hstErrorHandler);

// ── Start Server ──────────────────────────────
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`[HST] Server running on port ${PORT}`));
