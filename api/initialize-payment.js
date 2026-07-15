// api/initialize-payment.js

export default async function handler(req, res) {
  // Only accept POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email, amount, reference, metadata } = req.body;

  if (!email || !amount || !reference) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const response = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email,
        amount,
        reference,
        metadata
      })
    });

    const data = await response.json();

    if (!data.status) {
      return res.status(400).json({ error: 'Paystack initialisation failed', details: data });
    }

    return res.status(200).json({
      access_code: data.data.access_code,
      reference: data.data.reference
    });

  } catch (error) {
    console.error('Initialisation error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
