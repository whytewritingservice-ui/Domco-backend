const express = require('express');
const cors = require('cors');
const app = express();
app.use(cors());
app.use(express.json());

// 1. Fetch ALL banks
app.get('/api/banks', async (req, res) => {
  try {
    const response = await fetch('https://api.flutterwave.com/v3/banks/NG', {
      headers: { 'Authorization': `Bearer ${process.env.FLW_SECRET_KEY}` }
    });
    const data = await response.json();
    if (data.status === 'success') res.json(data.data);
    else res.status(400).json({ error: 'Failed' });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// 2. Verify Bank Account Name
app.post('/api/resolve-account', async (req, res) => {
  try {
    const { account_number, account_bank } = req.body;
    const response = await fetch('https://api.flutterwave.com/v3/accounts/resolve', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.FLW_SECRET_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ account_number, account_bank })
    });
    const data = await response.json();
    if (data.status === 'success') res.json({ account_name: data.data.account_name });
    else res.status(400).json({ error: 'Could not resolve account' });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// 3. Create Payment Link
app.post('/api/create-payment', async (req, res) => {
  try {
    const { jobId, amount, email } = req.body;
    const payload = {
      tx_ref: `domco-${jobId}-${Date.now()}`, amount, currency: "NGN",
      redirect_url: "https://whytewritingservice-ui.github.io/Domco-app/",
      customer: { email, name: "Domco User" },
      customizations: { title: "Domco Hub", description: `Payment for ${jobId}` }
    };
    const response = await fetch('https://api.flutterwave.com/v3/payments', {
      method: 'POST', headers: { 'Authorization': `Bearer ${process.env.FLW_SECRET_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (data.status === "success") res.json({ paymentLink: data.data.link });
    else res.status(400).json({ error: data.message });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// 4. Verify Payment
app.post('/api/verify-payment', async (req, res) => {
  try {
    const { tx_ref } = req.body;
    const response = await fetch(`https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=${tx_ref}`, {
      headers: { 'Authorization': `Bearer ${process.env.FLW_SECRET_KEY}` }
    });
    const data = await response.json();
    if (data.status === 'success' && data.data.status === 'successful') {
      res.json({ status: 'success', jobId: tx_ref.split('-')[1], amount: data.data.amount });
    } else { res.status(400).json({ status: 'failed' }); }
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// 5. Release Escrow
app.post('/api/release-escrow', async (req, res) => {
  try {
    const { jobId, amount, freelancerBankCode, freelancerAccountNumber } = req.body;
    const payload = { account_bank: freelancerBankCode, account_number: freelancerAccountNumber, amount: amount * 0.65, narration: `Domco Payout ${jobId}`, currency: "NGN", reference: `pay-${jobId}-${Date.now()}` };
    const response = await fetch('https://api.flutterwave.com/v3/transfers', { method: 'POST', headers: { 'Authorization': `Bearer ${process.env.FLW_SECRET_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await response.json();
    if (data.status === "success") res.json({ message: "Payout successful!" });
    else res.status(400).json({ error: data.message });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// 6. Withdraw Wallet
app.post('/api/withdraw-wallet', async (req, res) => {
  try {
    const { amount, bankCode, accountNumber } = req.body;
    const payload = { account_bank: bankCode, account_number: accountNumber, amount: amount, narration: `Domco Wallet Withdrawal`, currency: "NGN", reference: `wd-${Date.now()}` };
    const response = await fetch('https://api.flutterwave.com/v3/transfers', { method: 'POST', headers: { 'Authorization': `Bearer ${process.env.FLW_SECRET_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await response.json();
    if (data.status === "success") res.json({ message: "Withdrawal successful!" });
    else res.status(400).json({ error: data.message });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// 7. AI Gig Writer (Google Gemini)
app.post('/api/generate-gig', async (req, res) => {
  try {
    const { keywords } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'Gemini API key not configured' });

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `You are a professional copywriter for a freelance app. Write a short, engaging gig description (under 100 words) based on these keywords: ${keywords}. Do not include quotes.` }] }]
      })
    });

    const data = await response.json();
    if (data.candidates && data.candidates[0].content.parts[0].text) {
      res.json({ text: data.candidates[0].content.parts[0].text });
    } else {
      console.error(data);
      res.status(400).json({ error: 'AI generation failed' });
    }
  } catch (error) { res.status(500).json({ error: error.message }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`Backend running on port ${PORT}`));
