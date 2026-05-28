exports.hstFormatDate = (date) => {
  return new Date(date).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
};

exports.hstFormatCurrency = (amount) => `Rs.${Number(amount).toLocaleString('en-IN')}`;

exports.hstMonthName = (month) => {
  const names = ['', 'January', 'February', 'March', 'April', 'May', 'June',
                 'July', 'August', 'September', 'October', 'November', 'December'];
  return names[month] || '';
};

exports.hstSafePhone = (phone) => String(phone).replace(/\D/g, '').slice(-10);
