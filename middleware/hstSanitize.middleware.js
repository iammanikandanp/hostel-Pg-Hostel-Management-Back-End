const mongoSanitize = require('express-mongo-sanitize');
const xss = require('xss-clean');
const hpp = require('hpp');

// These are already wired globally in app.js via app.use()
// This file exports them individually for use in specific routes if needed
module.exports = { mongoSanitize, xss, hpp };
