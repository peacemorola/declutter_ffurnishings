import crypto from 'crypto';

const BASE44_URL = 'https://declutterffurnishings.base44.app/api/apps/6a27fe3930796e6ea134052d/entities/CommissionPayment';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).end();
  }

  const secret = process.env.PAYSTACK_SECRET_KEY;

  const hash = crypto
    .createHmac('sha512', secret)
    .update(JSON.stringify(req.body))
    .digest('hex');

  if (hash !== req.headers['x-paystack-signature']) {
    console.log('Invalid signature, request ignored');
    return res.status(401).end();
  }

  if (req.body.event !== 'charge.success') {
    console.log(`Ignored event: ${req.body.event}`);
    return res.status(200).json({ received: true });
  }

  const reference = req.body.data.reference;
  console.log(`Processing payment: ${reference}`);

  try {
    const verifyRes = await fetch(
      `https://api.paystack.co/transaction/verify/${reference}`,
      { headers: { Authorization: `Bearer ${secret}` } }
    );
    const verifyData = await verifyRes.json();

    if (verifyData.data?.status !== 'success') {
      console.log(`Transaction ${reference} not successful, ignored`);
      return res.status(200).json({ received: true });
    }

    const findRes = await fetch(
      `${BASE44_URL}?q=${encodeURIComponent(JSON.stringify({ paystack_reference: reference }))}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.BASE44_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    console.log(`Base44 find status: ${findRes.status}`);
    const findData = await findRes.json();
    const record = Array.isArray(findData) ? findData[0] : findData.items?.[0];

    if (!record) {
      console.log(`No CommissionPayment found for ${reference}`);
      return res.status(500).json({ error: 'Record not found' });
    }

    if (record.payment_status === 'success') {
      console.log(`Payment ${reference} already processed`);
      return res.status(200).json({ received: true });
    }

    const updateRes = await fetch(`${BASE44_URL}/${record.id}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${process.env.BASE44_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ payment_status: 'success' })
    });
    console.log(`Base44 update status: ${updateRes.status}`);

    if (!updateRes.ok) {
      return res.status(500).json({ error: 'Update failed' });
    }

    console.log(`Payment ${reference} marked as success`);
    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('Webhook error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
}
