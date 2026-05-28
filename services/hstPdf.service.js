const PDFDocument = require('pdfkit');

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function pipeToBuffer(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
}

function certHeader(doc, title) {
  doc.fontSize(20).font('Helvetica-Bold').fillColor('#1e1b4b').text('HostelMS', { align: 'center' });
  doc.fontSize(10).font('Helvetica').fillColor('#64748b').text('Hostel Management System', { align: 'center' });
  doc.moveDown(0.5);
  const lx = 50, ly = doc.y, lw = doc.page.width - 100;
  doc.moveTo(lx, ly).lineTo(lx + lw, ly).strokeColor('#4f46e5').lineWidth(2).stroke();
  doc.moveDown(0.8);
  doc.fontSize(16).font('Helvetica-Bold').fillColor('#1e1b4b').text(title, { align: 'center' });
  doc.moveDown(1).fillColor('#000');
}

function certRow(doc, label, value) {
  const y = doc.y;
  doc.fontSize(11).font('Helvetica-Bold').fillColor('#334155').text(label + ':', 60, y, { width: 170, lineBreak: false });
  doc.fontSize(11).font('Helvetica').fillColor('#1e293b').text(String(value ?? '—'), 240, y, { width: doc.page.width - 290 });
  doc.moveDown(0.45);
}

function certSection(doc, title) {
  doc.moveDown(0.6);
  doc.fontSize(12).font('Helvetica-Bold').fillColor('#4f46e5').text(title);
  doc.moveDown(0.3).fillColor('#000');
}

/**
 * Formal rent receipt PDF (distinct from bill PDF — for formal documentation)
 */
exports.hstGenerateRentReceipt = async (bill) => {
  const doc = new PDFDocument({ margin: 50, size: 'A4' });
  const bufferPromise = pipeToBuffer(doc);

  certHeader(doc, 'Rent Receipt');

  const receiptNo = `RR-${bill.year}-${String(bill.month).padStart(2,'0')}-${bill._id.toString().slice(-6).toUpperCase()}`;
  const monthName = MONTH_NAMES[bill.month - 1];

  certSection(doc, 'Receipt Details');
  certRow(doc, 'Receipt No', receiptNo);
  certRow(doc, 'Period', `${monthName} ${bill.year}`);
  certRow(doc, 'Date Issued', new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }));
  if (bill.paidAt) certRow(doc, 'Date Paid', new Date(bill.paidAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }));
  certRow(doc, 'Payment Status', bill.isPaid ? 'PAID' : 'PENDING');
  if (bill.paymentId) certRow(doc, 'Payment Reference', bill.paymentId);

  certSection(doc, 'Resident Details');
  certRow(doc, 'Full Name', bill.userId?.name);
  certRow(doc, 'Email',     bill.userId?.email);
  certRow(doc, 'Phone',     bill.userId?.phone);
  certRow(doc, 'Room No',   bill.roomId?.roomNumber);
  certRow(doc, 'Floor',     bill.roomId?.floor);

  certSection(doc, 'Bill Breakdown');
  certRow(doc, 'Rent',              `Rs.${bill.rent.toFixed(2)}`);
  if (bill.electricityShare) certRow(doc, 'Electricity Share', `Rs.${bill.electricityShare.toFixed(2)}`);
  if (bill.foodTotal)        certRow(doc, 'Food Total',        `Rs.${bill.foodTotal.toFixed(2)}`);

  doc.moveDown(0.3);
  const lx = 50, lw = doc.page.width - 100;
  doc.moveTo(lx, doc.y).lineTo(lx + lw, doc.y).strokeColor('#e2e8f0').lineWidth(1).stroke();
  doc.moveDown(0.4);
  const totY = doc.y;
  doc.fontSize(13).font('Helvetica-Bold').fillColor('#1e1b4b').text('Total Amount:', 60, totY, { width: 170, lineBreak: false });
  doc.fontSize(13).font('Helvetica-Bold').fillColor('#4f46e5').text(`Rs.${bill.total.toFixed(2)}`, 240, totY, { width: lw - 180 });
  doc.moveDown(2.5);

  doc.moveTo(lx, doc.y).lineTo(lx + lw, doc.y).strokeColor('#e2e8f0').lineWidth(1).stroke();
  doc.moveDown(0.8);
  doc.fontSize(10).font('Helvetica-Bold').fillColor('#334155').text('Authorized Signatory', 60);
  doc.fontSize(9).font('Helvetica').fillColor('#64748b').text('HostelMS Administration', 60);
  doc.moveDown(2);
  doc.fontSize(8).fillColor('#94a3b8').text('This is a computer-generated receipt. No signature required.', { align: 'center' });

  doc.end();
  return bufferPromise;
};

/**
 * Residency Certificate PDF
 */
exports.hstGenerateResidencyCertificate = async (user) => {
  const doc = new PDFDocument({ margin: 50, size: 'A4' });
  const bufferPromise = pipeToBuffer(doc);

  certHeader(doc, 'Residency Certificate');

  doc.moveDown(0.5);
  doc.fontSize(11).font('Helvetica').fillColor('#475569')
    .text('This is to certify that the following individual is a registered resident at our hostel facility.', { align: 'center', lineGap: 4 });
  doc.moveDown(1.2).fillColor('#000');

  certSection(doc, 'Resident Information');
  certRow(doc, 'Full Name',   user.name);
  certRow(doc, 'Email',       user.email);
  certRow(doc, 'Phone',       user.phone);
  certRow(doc, 'Room No',     user.roomId?.roomNumber);
  certRow(doc, 'Floor',       user.roomId?.floor);
  if (user.moveInDate) certRow(doc, 'Move-in Date', new Date(user.moveInDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }));
  certRow(doc, 'Status', user.isActive ? 'Active Resident' : 'Former Resident');

  if (user.guardianName) {
    certSection(doc, 'Guardian Information');
    certRow(doc, 'Guardian Name',  user.guardianName);
    certRow(doc, 'Guardian Phone', user.guardianPhone);
  }

  doc.moveDown(2);
  const lx = 50, lw = doc.page.width - 100;
  doc.moveTo(lx, doc.y).lineTo(lx + lw, doc.y).strokeColor('#e2e8f0').lineWidth(1).stroke();
  doc.moveDown(0.8);
  doc.fontSize(11).font('Helvetica').fillColor('#334155')
    .text(`Issued on: ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })}`, { align: 'right' });
  doc.moveDown(2);
  doc.fontSize(10).font('Helvetica-Bold').fillColor('#334155').text('Authorized Signatory', 60);
  doc.fontSize(9).font('Helvetica').fillColor('#64748b').text('HostelMS Administration', 60);
  doc.moveDown(2);
  doc.fontSize(8).fillColor('#94a3b8')
    .text('This certificate is system-generated and is valid without a physical signature.', { align: 'center' });

  doc.end();
  return bufferPromise;
};

exports.hstGenerateBillPdf = (resident, bill, room, month, year, ebUnits = null, electricityRate = null) => {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A5' });
    const buffers = [];

    doc.on('data', chunk => buffers.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    const W = doc.page.width - 100; // usable width

    // ── Header ──────────────────────────────────────────────
    doc.rect(50, 40, W, 60).fill('#4F46E5');
    doc.fillColor('white').fontSize(16).font('Helvetica-Bold')
       .text('HOSTEL RECEIPT', 50, 55, { width: W, align: 'center' });
    doc.fontSize(9).font('Helvetica')
       .text(`Receipt No: HST-${bill._id.toString().slice(-8).toUpperCase()}`, 50, 76, { width: W, align: 'center' });

    doc.fillColor('#1e293b');
    doc.moveDown(3.5);

    // ── Resident Info ────────────────────────────────────────
    const infoY = doc.y;
    doc.fontSize(9).font('Helvetica-Bold').text('BILLED TO', 50, infoY);
    doc.font('Helvetica').fontSize(10).text(resident.name, 50, infoY + 14);
    doc.fillColor('#64748b').fontSize(8)
       .text(`Room ${room.roomNumber}  ·  Floor ${room.floor}`, 50, infoY + 26)
       .text(resident.email, 50, infoY + 37)
       .text(resident.phone, 50, infoY + 48);

    const periodX = 50 + W / 2;
    doc.fillColor('#1e293b').fontSize(9).font('Helvetica-Bold').text('PERIOD', periodX, infoY);
    doc.font('Helvetica').fontSize(10).text(`${MONTH_NAMES[month - 1]} ${year}`, periodX, infoY + 14);
    doc.fillColor('#64748b').fontSize(8)
       .text(`Generated: ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`, periodX, infoY + 26);
    if (bill.paymentLink) {
      doc.fillColor('#64748b').text(`Status: ${bill.isPaid ? 'PAID' : 'UNPAID'}`, periodX, infoY + 37);
    }

    doc.moveDown(5.5);

    // ── Divider ──────────────────────────────────────────────
    const divY = doc.y;
    doc.moveTo(50, divY).lineTo(50 + W, divY).strokeColor('#e2e8f0').lineWidth(1).stroke();
    doc.moveDown(0.8);

    // ── Line items ───────────────────────────────────────────
    const rowY = () => doc.y;
    const addRow = (label, amount, highlight = false) => {
      const y = rowY();
      if (highlight) {
        doc.rect(50, y - 4, W, 22).fill('#f1f5f9').stroke('#e2e8f0');
      }
      doc.fillColor(highlight ? '#1e293b' : '#334155')
         .fontSize(highlight ? 10 : 9)
         .font(highlight ? 'Helvetica-Bold' : 'Helvetica')
         .text(label, 58, y, { width: W - 80 })
         .text(`Rs.${amount}`, 50, y, { width: W - 8, align: 'right' });
      doc.moveDown(highlight ? 1.4 : 1.2);
    };

    // header row
    const hY = rowY();
    doc.rect(50, hY - 2, W, 18).fill('#f8fafc');
    doc.fillColor('#94a3b8').fontSize(8).font('Helvetica-Bold')
       .text('DESCRIPTION', 58, hY + 2)
       .text('AMOUNT', 50, hY + 2, { width: W - 8, align: 'right' });
    doc.moveDown(1.4);

    if (bill.rent > 0)             addRow('Monthly Rent', bill.rent);
    if (bill.electricityShare > 0) {
      const ebLabel = ebUnits && electricityRate
        ? `Electricity  (${ebUnits} units × Rs.${electricityRate}/unit)`
        : 'Electricity';
      addRow(ebLabel, bill.electricityShare);
    }
    if (bill.foodTotal > 0)        addRow('Food (meal bookings)', bill.foodTotal);

    // total row
    doc.moveDown(0.3);
    const totalDivY = doc.y;
    doc.moveTo(50, totalDivY).lineTo(50 + W, totalDivY).strokeColor('#cbd5e1').lineWidth(0.5).stroke();
    doc.moveDown(0.5);
    addRow('TOTAL AMOUNT DUE', bill.total, true);

    // ── Pay link ─────────────────────────────────────────────
    if (bill.paymentLink) {
      doc.moveDown(0.5);
      doc.fillColor('#4F46E5').fontSize(8).font('Helvetica-Bold').text('PAY ONLINE:', 50, doc.y);
      doc.font('Helvetica').fillColor('#2563eb').text(bill.paymentLink, 50, doc.y + 1, { link: bill.paymentLink });
    }

    // ── Footer ───────────────────────────────────────────────
    const footerY = doc.page.height - 60;
    doc.moveTo(50, footerY).lineTo(50 + W, footerY).strokeColor('#e2e8f0').lineWidth(0.5).stroke();
    doc.fillColor('#94a3b8').fontSize(7).font('Helvetica')
       .text('This is a computer-generated receipt and does not require a signature.', 50, footerY + 8, { width: W, align: 'center' });

    doc.end();
  });
};
