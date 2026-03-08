// ─────────────────────────────────────────────────────────────────────────────
// netlify/functions/stripe-link.js
// Tom Falk P&H — Stripe payment link proxy
//
// ⚠️  BEFORE GOING LIVE — HARD STOP:
//     1. The key currently in Netlify env is a TEST key.
//     2. Test keys begin with sk_test_
//     3. Live keys begin with sk_live_
//     4. You MUST replace STRIPE_SECRET_KEY in Netlify → Site Settings →
//        Environment Variables with your LIVE secret key before taking real
//        payments. Deploying with a test key in production silently accepts
//        cards but collects NO real money.
//     5. Roll the old exposed test key in Stripe dashboard if not already done.
//
// Setup (one-time):
//   Netlify dashboard → Site Settings → Environment Variables → Add variable:
//     Key:   STRIPE_SECRET_KEY
//     Value: sk_test_xxxx  (test) or sk_live_xxxx (live)
//
// Works with both test and live keys — just swap the env var. No code changes.
// ─────────────────────────────────────────────────────────────────────────────

exports.handler = async function(event) {
  // Only accept POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const key = process.env.STRIPE_SECRET_KEY;

  // ⚠️  Hard check — refuse to run without a key
  if (!key) {
    console.error('STRIPE_SECRET_KEY environment variable is not set.');
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Stripe not configured. Set STRIPE_SECRET_KEY in Netlify environment variables.' })
    };
  }

  // Warn loudly in logs if test key is in use — useful audit trail
  if (key.startsWith('sk_test_')) {
    console.warn('⚠️  STRIPE RUNNING IN TEST MODE — no real money will be collected.');
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  const { amountCents, productName, productDescription, jobId, invoiceNumber } = body;

  if (!amountCents || !productName || !jobId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing required fields: amountCents, productName, jobId' }) };
  }

  const stripeBase = 'https://api.stripe.com/v1';
  const authHeader = `Bearer ${key}`;
  const contentType = 'application/x-www-form-urlencoded';

  try {
    // Step 1: Create a one-time price
    const priceParams = new URLSearchParams({
      'unit_amount': String(amountCents),
      'currency': 'usd',
      'product_data[name]': productName,
    });
    if (productDescription) priceParams.append('product_data[description]', productDescription);

    const priceRes = await fetch(`${stripeBase}/prices`, {
      method: 'POST',
      headers: { 'Authorization': authHeader, 'Content-Type': contentType },
      body: priceParams
    });
    const price = await priceRes.json();

    if (!price.id) {
      console.error('Stripe price creation failed:', price);
      return { statusCode: 502, body: JSON.stringify({ error: 'Stripe price creation failed', detail: price.error?.message }) };
    }

    // Step 2: Create payment link
    const linkParams = new URLSearchParams({
      'line_items[0][price]': price.id,
      'line_items[0][quantity]': '1',
      'metadata[job_id]': jobId,
      'metadata[invoice_number]': invoiceNumber || '',
    });

    const linkRes = await fetch(`${stripeBase}/payment_links`, {
      method: 'POST',
      headers: { 'Authorization': authHeader, 'Content-Type': contentType },
      body: linkParams
    });
    const link = await linkRes.json();

    if (!link.url) {
      console.error('Stripe payment link creation failed:', link);
      return { statusCode: 502, body: JSON.stringify({ error: 'Stripe link creation failed', detail: link.error?.message }) };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: link.url, mode: key.startsWith('sk_live_') ? 'live' : 'test' })
    };

  } catch (e) {
    console.error('stripe-link function error:', e);
    return { statusCode: 500, body: JSON.stringify({ error: 'Internal error', detail: e.message }) };
  }
};
