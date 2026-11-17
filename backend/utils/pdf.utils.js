const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

function generateInvoicePDF(invoice, items = [], customer, serviceOrder, vehicle) {
  return new Promise((resolve, reject) => {
    try {
      const fileName = `invoice-${invoice.invoice_number || invoice.id}-${Date.now()}.pdf`;
      const filePath = path.resolve('public/uploads/invoices', fileName);
      const publicUrl = `/uploads/invoices/${fileName}`;

      const doc = new PDFDocument({ margin: 40, size: 'A4' });
      const stream = fs.createWriteStream(filePath);
      doc.pipe(stream);

      // Colors
      const primaryColor = '#111118';
      const accentOrange = '#ff6b2b';
      const textMuted = '#666666';

      // Header Banner
      doc.rect(0, 0, doc.page.width, 100).fill(primaryColor);

      // Title & Branding
      doc.fillColor(accentOrange)
        .font('Helvetica-Bold')
        .fontSize(22)
        .text('KANNADA RIDERS GARAGE 14', 40, 30);

      doc.fillColor('#ffffff')
        .font('Helvetica')
        .fontSize(10)
        .text('Premium Motorcycle Care & Performance Garage', 40, 56)
        .text('GSTIN: 29AAAAA0000A1Z5 | Ph: +91 98765 43210', 40, 70);

      // Invoice Badge
      doc.fillColor(accentOrange)
        .font('Helvetica-Bold')
        .fontSize(20)
        .text('TAX INVOICE', 400, 35, { align: 'right' });

      doc.fillColor('#ffffff')
        .font('Helvetica')
        .fontSize(10)
        .text(`No: ${invoice.invoice_number || 'INV-' + invoice.id}`, 400, 60, { align: 'right' })
        .text(`Date: ${invoice.issued_date || new Date().toISOString().slice(0, 10)}`, 400, 75, { align: 'right' });

      // Customer & Vehicle Section
      const startY = 120;
      doc.fillColor(primaryColor)
        .font('Helvetica-Bold')
        .fontSize(12)
        .text('BILLED TO:', 40, startY);

      doc.font('Helvetica')
        .fontSize(10)
        .fillColor('#222222')
        .text(customer ? customer.full_name : 'Customer', 40, startY + 18)
        .text(`Phone: ${customer ? customer.mobile : '—'}`, 40, startY + 32)
        .text(`Email: ${customer ? customer.email : '—'}`, 40, startY + 46);

      doc.fillColor(primaryColor)
        .font('Helvetica-Bold')
        .fontSize(12)
        .text('VEHICLE & SERVICE DETAILS:', 320, startY);

      doc.font('Helvetica')
        .fontSize(10)
        .fillColor('#222222')
        .text(`Bike: ${vehicle ? `${vehicle.make} ${vehicle.model} (${vehicle.year || '—'})` : 'Motorcycle'}`, 320, startY + 18)
        .text(`Reg No: ${vehicle ? vehicle.registration_number : '—'}`, 320, startY + 32)
        .text(`Service: ${serviceOrder ? (serviceOrder.description || 'General Service') : 'Garage Service'}`, 320, startY + 46);

      // Line Items Table Header
      const tableTop = 200;
      doc.rect(40, tableTop, doc.page.width - 80, 24).fill('#f2f2f7');

      doc.fillColor(primaryColor)
        .font('Helvetica-Bold')
        .fontSize(9)
        .text('#', 50, tableTop + 7)
        .text('Description / Part', 80, tableTop + 7)
        .text('Type', 280, tableTop + 7)
        .text('Qty', 350, tableTop + 7, { align: 'center', width: 40 })
        .text('Unit Price (Rs)', 400, tableTop + 7, { align: 'right', width: 70 })
        .text('Total (Rs)', 480, tableTop + 7, { align: 'right', width: 70 });

      let curY = tableTop + 28;
      const itemList = items.length > 0 ? items : [
        { description: 'Comprehensive Motorcycle Service & Diagnostics', item_type: 'labour', quantity: 1, unit_price: invoice.subtotal || invoice.total_amount, total_price: invoice.subtotal || invoice.total_amount }
      ];

      itemList.forEach((it, idx) => {
        if (idx % 2 === 1) {
          doc.rect(40, curY - 4, doc.page.width - 80, 20).fill('#fafafa');
        }

        doc.fillColor('#333333')
          .font('Helvetica')
          .fontSize(9)
          .text(String(idx + 1), 50, curY)
          .text(it.description || 'Service item', 80, curY, { width: 190 })
          .text(it.item_type || 'part', 280, curY)
          .text(String(it.quantity || 1), 350, curY, { align: 'center', width: 40 })
          .text(Number(it.unit_price || 0).toFixed(2), 400, curY, { align: 'right', width: 70 })
          .text(Number(it.total_price || 0).toFixed(2), 480, curY, { align: 'right', width: 70 });

        curY += 22;
      });

      // Divider
      doc.strokeColor('#e5e5ea').lineWidth(1).moveTo(40, curY).lineTo(doc.page.width - 40, curY).stroke();
      curY += 15;

      // Totals Box
      const totalsX = 350;
      doc.font('Helvetica').fontSize(10).fillColor('#444444');
      doc.text('Subtotal:', totalsX, curY);
      doc.text(`Rs. ${Number(invoice.subtotal || 0).toFixed(2)}`, 450, curY, { align: 'right', width: 100 });
      curY += 18;

      if (invoice.labour_charge) {
        doc.text('Labour Charges:', totalsX, curY);
        doc.text(`Rs. ${Number(invoice.labour_charge || 0).toFixed(2)}`, 450, curY, { align: 'right', width: 100 });
        curY += 18;
      }

      if (invoice.discount > 0) {
        doc.text('Discount:', totalsX, curY);
        doc.text(`- Rs. ${Number(invoice.discount || 0).toFixed(2)}`, 450, curY, { align: 'right', width: 100 });
        curY += 18;
      }

      doc.text(`GST (${invoice.tax_rate || 18}%):`, totalsX, curY);
      doc.text(`Rs. ${Number(invoice.tax_amount || 0).toFixed(2)}`, 450, curY, { align: 'right', width: 100 });
      curY += 22;

      // Grand Total Highlight
      doc.rect(totalsX - 10, curY - 5, doc.page.width - totalsX - 30, 28).fill('#fff2eb');
      doc.fillColor(accentOrange)
        .font('Helvetica-Bold')
        .fontSize(12)
        .text('Grand Total:', totalsX, curY + 2);
      doc.text(`Rs. ${Number(invoice.total_amount || 0).toFixed(2)}`, 450, curY + 2, { align: 'right', width: 100 });

      curY += 45;

      // Status Stamp
      const isPaid = invoice.status === 'paid';
      doc.rect(40, curY, 140, 36)
        .lineWidth(2)
        .strokeColor(isPaid ? '#2ec4b6' : '#e63946')
        .stroke();

      doc.fillColor(isPaid ? '#2ec4b6' : '#e63946')
        .font('Helvetica-Bold')
        .fontSize(14)
        .text(isPaid ? 'PAID IN FULL' : (invoice.status.toUpperCase() || 'UNPAID'), 40, curY + 11, { width: 140, align: 'center' });

      // Footer
      doc.fillColor(textMuted)
        .font('Helvetica')
        .fontSize(9)
        .text('Thank you for riding with Kannada Riders Garage 14!', 40, doc.page.height - 60, { align: 'center', width: doc.page.width - 80 })
        .text('For queries or road support: support@kannadariders.com | Terms & conditions apply', 40, doc.page.height - 46, { align: 'center', width: doc.page.width - 80 });

      doc.end();

      stream.on('finish', () => resolve(publicUrl));
      stream.on('error', (err) => reject(err));
    } catch (e) {
      reject(e);
    }
  });
}

module.exports = { generateInvoicePDF };
