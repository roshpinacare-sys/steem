process.env.NODE_ENV = 'test';
delete process.env.STRIPE_WEBHOOK_SECRET;
const app = require('../ecos-api-server.js');
const server = app.startServer(0);
server.once('listening', async () => {
  const port = server.address().port;
  const event = {
    id: `evt_debug_${Date.now()}`,
    type: 'payment_intent.succeeded',
    data: { object: { id: `pi_debug_${Date.now()}`, amount: 5000, currency: 'usd', status: 'succeeded', metadata: { client_account_id: 'client::gumloop_003' } } }
  };
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/payments/stripe/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    });
    console.log('STATUS', res.status);
    console.log(await res.text());
  } catch (err) {
    console.error(err);
  } finally {
    server.close(() => process.exit(0));
  }
});
