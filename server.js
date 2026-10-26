const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

// 1. FIREBASE ADMIN SETUP (For Auto-Release)
const admin = require('firebase-admin');
let db;
try {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    db = admin.firestore();
    console.log("✅ Firebase Admin Connected");
  }
} catch (e) { console.error("Firebase Admin Error:", e.message); }

// 2. BANKS & VERIFICATION
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

// 3. PAYMENTS & ESCROW
app.post('/api/create-payment', async (req, res) => {
  try {
    const { jobId, amount, email, paymentType } = req.body;
    const payload = {
      tx_ref: `domco-${paymentType || 'escrow'}-${jobId}-${Date.now()}`,
      amount: amount, currency: "NGN",
      redirect_url: "https://whytewritingservice-ui.github.io/Domco-app/",
      customer: { email: email, name: "Domco User" },
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

app.post('/api/verify-payment', async (req, res) => {
  try {
    const { tx_ref } = req.body;
    const response = await fetch(`https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=${tx_ref}`, {
      headers: { 'Authorization': `Bearer ${process.env.FLW_SECRET_KEY}` }
    });
    const data = await response.json();
    if (data.status === 'success' && data.data.status === 'successful') {
      const parts = tx_ref.split('-');
      res.json({ status: 'success', paymentType: parts[1], jobId: parts[2], amount: data.data.amount, customerEmail: data.data.customer.email });
    } else { res.status(400).json({ status: 'failed' }); }
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/release-escrow', async (req, res) => {
  try {
    const { jobId, amount, freelancerBankCode, freelancerAccountNumber } = req.body;
    const payoutAmount = amount * 0.65;
    const payload = { account_bank: freelancerBankCode, account_number: freelancerAccountNumber, amount: payoutAmount, narration: `Domco Payout ${jobId}`, currency: "NGN", reference: `pay-${jobId}-${Date.now()}` };
    const response = await fetch('https://api.flutterwave.com/v3/transfers', { method: 'POST', headers: { 'Authorization': `Bearer ${process.env.FLW_SECRET_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await response.json();
    if (data.status === "success") res.json({ message: "Payout successful!" });
    else res.status(400).json({ error: data.message });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

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

// 4. AI & SMS
app.post('/api/generate-gig', async (req, res) => {
  try {
    const { keywords } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'Gemini API key not configured' });

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({ contents: [{ parts: [{ text: `You are a professional copywriter. Write a short, engaging gig description (under 100 words) based on these keywords: ${keywords}. Do not include quotes.` }] }] })
    });
    const data = await response.json();
    if (data.candidates && data.candidates[0].content.parts[0].text) res.json({ text: data.candidates[0].content.parts[0].text });
    else res.status(400).json({ error: 'AI generation failed' });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/send-sms', async (req, res) => {
  try {
    const { to, message } = req.body;
    const apiKey = process.env.TERMII_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'Termii API key not configured' });

    const response = await fetch('https://api.ng.termii.com/api/sms/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: to, from: "DomcoHub", sms: message, type: "plain", channel: "generic", api_key: apiKey })
    });
    const data = await response.json();
    res.json(data);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// 5. AUTO-RELEASE CRON JOB
app.post('/api/auto-release', async (req, res) => {
  const secret = req.headers['x-cron-secret'];
  if (secret !== process.env.CRON_SECRET) return res.status(401).json({ error: 'Unauthorized' });
  if (!db) return res.status(500).json({ error: 'Firebase Admin not connected' });

  try {
    const threeDaysAgo = Date.now() - (3 * 24 * 60 * 60 * 1000);
    const snapshot = await db.collection('jobs').where('status', '==', 'delivered').get();
    if (snapshot.empty) return res.json({ message: 'No delivered jobs found.' });

    let releasedCount = 0;
    for (const doc of snapshot.docs) {
      const job = doc.data();
      const deliveredTime = job.deliveredAt ? job.deliveredAt.toMillis() : 0;
      if (deliveredTime > 0 && deliveredTime < threeDaysAgo) {
        const fDoc = await db.collection('users').doc(job.freelancerId).get();
        const fProfile = fDoc.data();
        if (fProfile && fProfile.bankCode && fProfile.accountNumber) {
          const payload = { account_bank: fProfile.bankCode, account_number: fProfile.accountNumber, amount: job.amount * 0.65, narration: `Auto-Release`, currency: "NGN", reference: `auto-${doc.id}-${Date.now()}` };
          const response = await fetch('https://api.flutterwave.com/v3/transfers', { method: 'POST', headers: { 'Authorization': `Bearer ${process.env.FLW_SECRET_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
          const data = await response.json();
          if (data.status === "success") {
            await db.collection('jobs').doc(doc.id).update({ status: 'paid', paidAt: admin.firestore.FieldValue.serverTimestamp() });
            await db.collection('transactions').add({ userId: job.freelancerId, jobId: doc.id, amount: job.amount * 0.65, type: 'payout', note: `Auto-Release: ${job.gigTitle}`, createdAt: admin.firestore.FieldValue.serverTimestamp() });
            releasedCount++;
          }
        }
      }
    }
    res.json({ message: 'Auto-release check complete', releasedCount });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// 6. START SERVER
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 DOMCO BACKEND LIVE ON PORT ${PORT}`));
