const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

// Fetch ALL banks from Flutterwave
app.get('/api/banks', async (req, res) => {
  try {
    const response = await fetch('https://api.flutterwave.com/v3/banks/NG', {
      headers: { 'Authorization': `Bearer ${process.env.FLW_SECRET_KEY}` }
    });
    const data = await response.json();
    if (data.status === 'success') res.json(data.data);
    else res.status(400).json({ error: 'Failed to fetch banks' });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/create-payment', async (req, res) => {
  try {
    const { jobId, amount, email } = req.body;
    const payload = {
      tx_ref: `domco-${jobId}-${Date.now()}`,
      amount: amount, currency: "NGN",
      redirect_url: "https://whytewritingservice-ui.github.io/Domco-app/",
      customer: { email: email || "test@test.com", name: "Domco Client" },
      customizations: { title: "Domco Hub Escrow", description: `Funding for Job ${jobId}` }
    };
    const response = await fetch('https://api.flutterwave.com/v3/payments', {
      method: 'POST', headers: { 'Authorization': `Bearer ${process.env.FLW_SECRET_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (data.status === "success") res.json({ paymentLink: data.data.link });
    else res.status(400).json({ error: data.message });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/verify-payment', async (req, res) => {
  try {
    const { tx_ref } = req.body;
    const response = await fetch(`https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=${tx_ref}`, {
      method: 'GET', headers: { 'Authorization': `Bearer ${process.env.FLW_SECRET_KEY}` }
    });
    const data = await response.json();
    if (data.status === 'success' && data.data.status === 'successful') {
      res.json({ status: 'success', jobId: tx_ref.split('-')[1], amount: data.data.amount });
    } else { res.status(400).json({ status: 'failed', message: 'Payment not verified' }); }
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/release-escrow', async (req, res) => {
  try {
    const { jobId, amount } = req.body;
    const payload = { account_bank: "044", account_number: "0690000040", amount: amount * 0.6, narration: `Domco Payout Job ${jobId}`, currency: "NGN", reference: `payout-${jobId}-${Date.now()}` };
    const response = await fetch('https://api.flutterwave.com/v3/transfers', { method: 'POST', headers: { 'Authorization': `Bearer ${process.env.FLW_SECRET_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await response.json();
    if (data.status === "success") res.json({ message: "Payout successful!" });
    else res.status(400).json({ error: data.message });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`Backend running on port ${PORT}`));
