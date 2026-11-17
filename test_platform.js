const http = require('http');
const { app, server } = require('./server.js');
const db = require('./backend/database/db');

async function runTests() {
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;

  console.log('\n=============================================================');
  console.log(`🧪 RUNNING KANNADA RIDERS GARAGE 14 VERIFICATION SUITE (Port ${port})`);
  console.log('=============================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, testName) {
    if (condition) {
      console.log(`  ✅ PASS: ${testName}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${testName}`);
      failed++;
    }
  }

  // Helper request
  function request(method, path, body = null, cookie = null) {
    return new Promise((resolve, reject) => {
      const port = server.address().port;
      const opts = {
        hostname: 'localhost',
        port,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
        }
      };
      if (cookie) opts.headers['Cookie'] = cookie;

      const req = http.request(opts, (res) => {
        let raw = '';
        res.on('data', chunk => raw += chunk);
        res.on('end', () => {
          let json = {};
          try { json = JSON.parse(raw); } catch(e) {}
          const setCookie = res.headers['set-cookie'];
          resolve({ status: res.statusCode, headers: res.headers, body: json, raw, cookie: setCookie ? setCookie[0] : null });
        });
      });
      req.on('error', reject);
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  }

  try {
    // 1. Health check
    const health = await request('GET', '/api/health');
    assert(health.status === 200 && health.body.success, 'API Health Check responds 200 OK');

    // 2. Admin Login
    const adminLogin = await request('POST', '/api/auth/admin/login', {
      identifier: 'admin@kannadariders.com',
      password: 'Admin@123'
    });
    assert(adminLogin.status === 200 && adminLogin.body.success && adminLogin.cookie, 'Admin Login with seeded credentials succeeds');
    const adminCookie = adminLogin.cookie;

    // 3. Admin /auth/me
    const adminMe = await request('GET', '/api/auth/me', null, adminCookie);
    assert(adminMe.status === 200 && adminMe.body.user.role === 'admin', 'Admin auth/me returns admin role and identity');

    // 4. Customer Registration
    const testEmail = `rider_${Date.now()}@test.com`;
    const testMobile = `98${Math.floor(10000000 + Math.random() * 90000000)}`;
    const custReg = await request('POST', '/api/auth/customer/register', {
      full_name: 'Shankar Gowda',
      email: testEmail,
      mobile: testMobile,
      password: 'RiderPassword123',
      confirm_password: 'RiderPassword123'
    });
    assert(custReg.status === 201 && custReg.body.success, 'Customer Registration creates account successfully');

    // 5. Customer Login
    const custLogin = await request('POST', '/api/auth/customer/login', {
      identifier: testEmail,
      password: 'RiderPassword123'
    });
    assert(custLogin.status === 200 && custLogin.body.success && custLogin.cookie, 'Customer Login succeeds and issues HTTP-only session cookie');
    const customerCookie = custLogin.cookie;
    const customerId = custLogin.body.user.id;

    // 6. Customer Role Guard Check
    const custMe = await request('GET', '/api/auth/me', null, customerCookie);
    assert(custMe.status === 200 && custMe.body.user.role === 'customer', 'Customer auth/me returns customer role');

    // 7. Security: Customer cannot access Admin Stats
    const forbiddenAdmin = await request('GET', '/api/admin/stats', null, customerCookie);
    assert(forbiddenAdmin.status === 403, 'Customer cannot access admin endpoints (403 Forbidden)');

    // 8. Vehicle Registration by Customer
    const testRegNo = `KA-04-KR-${Math.floor(1000 + Math.random() * 9000)}`;
    const addVehicle = await request('POST', '/api/customer/vehicles', {
      make: 'Royal Enfield',
      model: 'Continental GT 650',
      year: 2024,
      registration_number: testRegNo,
      fuel_type: 'Petrol',
      odometer_reading: 3400,
      color: 'Apex Grey'
    }, customerCookie);
    assert(addVehicle.status === 201 && addVehicle.body.success, 'Customer registers vehicle in centralized DB');
    const vehicleId = addVehicle.body.id;

    // 9. Admin Automatically Sees Registered Vehicle
    const adminVehicles = await request('GET', '/api/admin/vehicles', null, adminCookie);
    const foundVehicle = adminVehicles.body.vehicles.find(v => v.id === vehicleId);
    assert(foundVehicle && foundVehicle.registration_number === testRegNo, 'Admin dashboard automatically sees new vehicle in central DB');

    // 10. Customer Online Service Booking Request
    const addBooking = await request('POST', '/api/customer/bookings', {
      vehicle_id: vehicleId,
      service_type: 'Full Engine Tune & Brake Overhaul',
      preferred_date: '2026-11-20',
      preferred_time: '10:00 AM',
      pickup_drop: 'pickup_only',
      problem_description: 'Slight brake fade and clutch slipping at high RPM',
      address: 'Indiranagar 100ft Road, Bangalore'
    }, customerCookie);
    assert(addBooking.status === 201 && addBooking.body.success, 'Customer books service appointment online');
    const bookingId = addBooking.body.bookingId;

    // 11. Admin Receives Booking Request in Admin Dashboard
    const adminBookings = await request('GET', '/api/admin/bookings', null, adminCookie);
    const foundBooking = adminBookings.body.bookings.find(b => b.id === bookingId);
    assert(foundBooking && foundBooking.service_type === 'Full Engine Tune & Brake Overhaul', 'Admin receives customer booking request in admin dashboard');

    // 12. Admin Converts Booking to Live Service Order
    const convertOrder = await request('POST', `/api/admin/bookings/${bookingId}/convert`, {
      estimated_completion: '2026-11-22',
      notes: 'Check front brake calipers and clutch plates'
    }, adminCookie);
    assert(convertOrder.status === 201 && convertOrder.body.success, 'Admin converts booking to live service job');
    const orderId = convertOrder.body.orderId;

    // 13. 9-Stage Timeline Status Update: "inspection_started"
    const updateStatus = await request('PUT', `/api/admin/service-orders/${orderId}/status`, {
      status: 'inspection_started',
      notes: 'Initial diagnostics underway'
    }, adminCookie);
    assert(updateStatus.status === 200 && updateStatus.body.success, 'Admin updates service status to "inspection_started"');

    // 14. Customer Sees Updated Status in Real-Time
    const custOrder = await request('GET', `/api/customer/service-orders/${orderId}`, null, customerCookie);
    assert(custOrder.status === 200 && custOrder.body.order.status === 'inspection_started', 'Customer portal reflects updated live service status');

    // 15. Admin Generates Detailed Estimate
    const addEstimate = await request('POST', '/api/admin/estimates', {
      service_order_id: orderId,
      customer_id: customerId,
      labour_charge: 1200,
      discount: 200,
      tax_rate: 18.0,
      admin_notes: 'Includes genuine Brembo pads and Motul 300V oil',
      items: [
        { description: 'Motul 300V Factory Line 15W50 (3.1L)', item_type: 'part', quantity: 3, unit_price: 1100 },
        { description: 'Brembo Sintered Brake Pads (Front)', item_type: 'part', quantity: 1, unit_price: 2400 },
        { description: 'OEM Oil Filter & O-Rings', item_type: 'part', quantity: 1, unit_price: 350 }
      ]
    }, adminCookie);
    assert(addEstimate.status === 201 && addEstimate.body.success, 'Admin creates detailed estimate with parts and labour breakdown');
    const estimateId = addEstimate.body.estimateId;

    // 16. Customer Reviews and Approves Estimate
    const approveEstimate = await request('POST', `/api/customer/estimates/${estimateId}/respond`, {
      decision: 'approved',
      comments: 'Approved! Please proceed with genuine parts.'
    }, customerCookie);
    assert(approveEstimate.status === 200 && approveEstimate.body.success, 'Customer approves estimate and advances service to in_progress');

    // 17. Admin Generates Official Tax Invoice & PDF
    const addInvoice = await request('POST', '/api/admin/invoices', {
      service_order_id: orderId,
      customer_id: customerId,
      estimate_id: estimateId,
      subtotal: 6050,
      labour_charge: 1200,
      discount: 200,
      tax_rate: 18.0,
      notes: 'Kannada Riders Garage 14 — Customer satisfaction guaranteed.',
      items: [
        { description: 'Motul 300V Factory Line 15W50', item_type: 'part', quantity: 3, unit_price: 1100 },
        { description: 'Brembo Sintered Brake Pads', item_type: 'part', quantity: 1, unit_price: 2400 },
        { description: 'Labour & Precision Diagnostics', item_type: 'labour', quantity: 1, unit_price: 1200 }
      ]
    }, adminCookie);
    assert(addInvoice.status === 201 && addInvoice.body.invoiceNumber && addInvoice.body.pdfUrl, 'Admin generates invoice and PDF document');
    const invoiceId = addInvoice.body.invoiceId;

    // 18. Customer Verifies and Pays Invoice
    const payInvoice = await request('POST', '/api/customer/payments/verify', {
      invoice_id: invoiceId,
      amount: 8319, // Total with 18% GST on 7050
      payment_method: 'upi',
      transaction_id: `UPI-TEST-${Date.now()}`
    }, customerCookie);
    assert(payInvoice.status === 201 && payInvoice.body.receipt_number && payInvoice.body.status === 'paid', 'Customer pays invoice via verified UPI payment with receipt');

    // 19. Customer Rating & Feedback
    const submitReview = await request('POST', '/api/customer/reviews', {
      service_order_id: orderId,
      rating: 5,
      feedback: 'The throttle response is razor-sharp now! Best garage in Bangalore.'
    }, customerCookie);
    assert(submitReview.status === 201 && submitReview.body.success, 'Customer submits 5-star service rating & review');

    // 20. Customer Isolation Check: Customer B cannot view Customer A's service order
    const cust2Email = `rider2_${Date.now()}@test.com`;
    const cust2Reg = await request('POST', '/api/auth/customer/register', {
      full_name: 'Anand Kumar',
      email: cust2Email,
      mobile: `97${Math.floor(10000000 + Math.random() * 90000000)}`,
      password: 'Password123',
      confirm_password: 'Password123'
    });
    const cust2Login = await request('POST', '/api/auth/customer/login', {
      identifier: cust2Email,
      password: 'Password123'
    });
    // Attempt to access Customer 1's service order with Customer 2's session
    const unauthorizedAccess = await request('GET', `/api/customer/service-orders/${orderId}`, null, cust2Login.cookie);
    assert(unauthorizedAccess.status === 404 || unauthorizedAccess.status === 403, 'Customer isolation strictly enforced: Customer B cannot access Customer A records');

    console.log('\n=============================================================');
    console.log(`🏁 TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
    console.log('=============================================================\n');

    server.close();
    process.exit(failed === 0 ? 0 : 1);
  } catch(e) {
    console.error('Test suite uncaught error:', e);
    server.close();
    process.exit(1);
  }
}

runTests();
