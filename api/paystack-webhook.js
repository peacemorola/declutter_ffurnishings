import crypto from 'crypto';

const BASE44_URL = 'https://declutterffurnishings.base44.app/api/apps/6a27fe3930796e6ea134052d/entities/CommissionPayment';

export default async function handler(req, res) {
  // Only accept POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Step 1 — verify signature
    const secret = process.env.PAYSTACK_SECRET_KEY;
    const hash = crypto
      .createHmac('sha512', secret)
      .update(JSON.stringify(req.body))
      .digest('hex');

    if (hash !== req.headers['x-paystack-signature']) {
      console.log('Invalid signature — request ignored');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    // Step 2 — check event type
    if (req.body.event !== 'charge.success') {
      console.log(`Ignored event: ${req.body.event}`);
      return res.status(200).json({ received: true, ignored: true });
    }

    const reference = req.body.data.reference;
    console.log(`Processing payment: ${reference}`);

    // Step 3 — verify transaction independently with Paystack
    const verifyRes = await fetch(
      `https://api.paystack.co/transaction/verify/${reference}`,
      {
        headers: {
          Authorization: `Bearer ${secret}`
        }
      }
    );
    const verifyData = await verifyRes.json();

    if (verifyData.data?.status !== 'success') {
      console.log(`Transaction ${reference} status is not success — ignored`);
      return res.status(200).json({ received: true, ignored: true });
    }

    // Step 4 — find the CommissionPayment record in Base44 by reference
    const headers = {
      api_key: process.env.BASE44_API_KEY,
      Authorization: `Bearer ${process.env.BASE44_API_KEY}`,
      'Content-Type': 'application/json'
    };
    const toList = (d) =>
      Array.isArray(d) ? d : (d.items || d.data || d.results || []);

    // Attempt A: JSON q= filter
    const resA = await fetch(
      `${BASE44_URL}?q=${encodeURIComponent(JSON.stringify({ paystack_reference: reference }))}`,
      { headers }
    );
    const listA = toList(await resA.json());
    console.log(`q= filter: status ${resA.status}, count ${listA.length}`);

    // Attempt B: unfiltered list (diagnostic — remove once the cause is found)
    const resB = await fetch(BASE44_URL, { headers });
    const listB = toList(await resB.json());
    console.log(`Unfiltered: status ${resB.status}, count ${listB.length}`);
    console.log(
      'Latest records:',
      JSON.stringify(
        listB.slice(-3).map((r) => ({
          id: r.id,
          ref: r.paystack_reference,
          status: r.payment_status,
          created: r.created_date
        }))
      )
    );

    const record =
      listA.find((r) => r.paystack_reference === reference) ||
      listB.find((r) => r.paystack_reference === reference);

    if (!record) {
      console.log(`No CommissionPayment record found for reference: ${reference}`);
      return res.status(500).json({ error: 'Record not found' });
    }

    // Step 5 — duplicate prevention
    if (record.payment_status === 'success') {
      console.log(`Payment ${reference} already processed — skipping`);
      return res.status(200).json({ received: true, duplicate: true });
    }

    // Step 6 — update the record to success
    const updateRes = await fetch(`${BASE44_URL}/${record.id}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ payment_status: 'success' })
    });
    console.log(`Base44 update status: ${updateRes.status}`);

    if (updateRes.ok) {
      console.log(`Payment ${reference} successfully marked as success`);
      return res.status(200).json({ received: true });
    }

    console.log(`Failed to update record for reference: ${reference}`);
    return res.status(500).json({ error: 'Update failed' });
  } catch (error) {
    console.error('Webhook error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
