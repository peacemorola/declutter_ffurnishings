// api/paystack-webhook.js
const crypto = require('crypto');

const BASE44_URL = 'https://declutterffurnishings.base44.app/api/apps/6a27fe3930796e6ea134052d/entities/CommissionPayment';

export default async function handler(req, res) {

  // Step 1 — acknowledge immediately
  res.status(200).json({ received: true });

  // Only accept POST requests
  if (req.method !== 'POST') return;

  // Step 2 — verify signature
  const secret = process.env.PAYSTACK_SECRET_KEY;
  const hash = crypto
    .createHmac('sha512', secret)
    .update(JSON.stringify(req.body))
    .digest('hex');

  if (hash !== req.headers['x-paystack-signature']) {
    console.log('Invalid signature — request ignored');
    return;
  }

  // Step 3 — check event type
  if (req.body.event !== 'charge.success') {
    console.log(`Ignored event: ${req.body.event}`);
    return;
  }

  const reference = req.body.data.reference;
  const amountPaid = req.body.data.amount;

  console.log(`Processing payment: ${reference}`);

  // Step 4 — verify transaction independently with Paystack
  const verifyRes = await fetch(
    `https://api.paystack.co/transaction/verify/${reference}`,
    {
      headers: {
        Authorization: `Bearer ${secret}`
      }
    }
  );
  const verifyData = await verifyRes.json();

  if (verifyData.data.status !== 'success') {
    console.log(`Transaction ${reference} status is not success — ignored`);
    return;
  }

  // Step 5 — find the CommissionPayment record in base44 by reference
  const findRes = await fetch(
    `${BASE44_URL}?q=${encodeURIComponent(JSON.stringify({ paystack_reference: reference }))}`,
    {
      headers: {
        'Authorization': `Bearer ${process.env.BASE44_API_KEY}`,
        'Content-Type': 'application/json'
      }
    }
  );
  const findData = await findRes.json();
  const record = findData[0];

  if (!record) {
    console.log(`No CommissionPayment record found for reference: ${reference}`);
    return;
  }

  // Step 6 — duplicate prevention
  if (record.payment_status === 'success') {
    console.log(`Payment ${reference} already processed — skipping`);
    return;
  }

  // Step 7 — update the record to success
  const updateRes = await fetch(
    `${BASE44_URL}/${record.id}`,
    {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${process.env.BASE44_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        ...record,
        payment_status: 'success'
      })
    }
  );

  if (updateRes.ok) {
    console.log(`Payment ${reference} successfully marked as success`);
  } else {
    console.log(`Failed to update record for reference: ${reference}`);
  }
}