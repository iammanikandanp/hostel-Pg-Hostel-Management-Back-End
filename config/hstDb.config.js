const mongoose = require('mongoose');

const hstConnectDb = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI);
    console.log(`[HST-DB] Connected: ${conn.connection.host}`);
  } catch (err) {
    console.error('[HST-DB] Connection failed:', err.message);
    process.exit(1);
  }
};

module.exports = hstConnectDb;
