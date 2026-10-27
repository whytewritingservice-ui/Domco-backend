const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const app = express();

const ALLOWED_ORIGINS = [
  'https://whytewritingservice-ui.github.io',
  'http://localhost:5500',
  'http://localhost:3000'
];
app.use(cors({
  origin: (o, cb) => (!o || ALLOWED_ORIGINS.includes(o)) ? cb(null, true) : cb(new Error('CORS'))
}));
app.use(express.json({ limit: '2mb' }));

// ---- FIREBASE ----
let db, auth;
try {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(sa) });
    db = admin.firestore();
    auth = admin.auth();
    console.log('✅ Firebase ready');
  } else {
    console.error('❌ FIREBASE_SERVICE_ACCOUNT missing');
  }
} catch (e) { console.error('Firebase error:', e.message); }

// ---- MIDDLEWARE ----
async function requireAuth(req, res, next) {
  try {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'No token' });
    req.user = await auth.verifyIdToken(token);
    const snap = await db.collection('users').doc(req.user.uid).get();
    if (snap.exists && snap.data().banned === true) {
      return res.status(403).json({ error: 'Account banned' });
    }
    req.profile = snap.exists ? snap.data() : {};
    next();
  } catch (e) { res.status(401).json({ error: 'Invalid token' }); }
}

async function requireAdmin(req, res, next) {
  if (!req.profile || !req.profile.isAdmin) return res.status(403).json({ error: 'Admin only' });
  next();
}

// ---- HEALTH & BANKS ----
app.get('/health', (req, res) => res.json({ ok: true, ts: Date.now(), version: '3.0' }));

app.get('/api/banks', requireAuth, async (req, res) => {
  try {
    const r = await fetch('https://api.flutterwave.com/v3/banks/NG', {
      headers: { Authorization: `Bearer ${process.env.FLW_SECRET_KEY}` }
    });
    
    // Prevent JSON crash on upstream errors
    const contentType = r.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      const textError = await r.text();
      console.error("Flutterwave returned a non-JSON error:", textError);
      return res.status(502).json({ error: "Flutterwave is temporarily unavailable." });
    }

    const d = await r.json();
    if (d.status === 'success') res.json(d.data);
    else res.status(400).json({ error: d.message || 'Failed' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/resolve-account', requireAuth, async (req, res) => {
  try {
    const { account_number, account_bank } = req.body;
    if (!/^\d{10}$/.test(account_number)) return res.status(400).json({ error: 'Bad account' });
    const r = await fetch('https://api.flutterwave.com/v3/accounts/resolve', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ account_number, account_bank })
    });
    const d = await r.json();
    if (d.status === 'success') res.json({ account_name: d.data.account_name });
    else res.status(400).json({ error: 'Could not resolve' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- PAYMENTS ----
app.post('/api/create-payment', requireAuth, async (req, res) => {
  try {
    const { amount, purpose, jobId, gigId, extra } = req.body;
    if (!amount || Number(amount) < 100) return res.status(400).json({ error: 'Amount too low' });

    const txRef = `domco_${purpose}_${req.user.uid}_${Date.now()}`;
    await db.collection('payments').doc(txRef).set({
      userId: req.user.uid, amount: Number(amount), purpose, jobId: jobId || null,
      gigId: gigId || null, extra: extra || null, status: 'pending',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    const payload = {
      tx_ref: txRef, amount: Number(amount), currency: 'NGN',
      redirect_url: 'https://whytewritingservice-ui.github.io/Domco-app/',
      customer: { email: req.user.email || 'user@domco.app', name: req.profile.first ? `${req.profile.first} ${req.profile.last || ''}`.trim() : 'Domco User' },
      customizations: { title: 'Domco Hub', description: `Payment for ${purpose}` }
    };

    const r = await fetch('https://api.flutterwave.com/v3/payments', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const d = await r.json();
    if (d.status === 'success') res.json({ paymentLink: d.data.link, tx_ref: txRef });
    else res.status(400).json({ error: d.message });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/verify-payment', requireAuth, async (req, res) => {
  try {
    const { tx_ref } = req.body;
    const intentDoc = await db.collection('payments').doc(tx_ref).get();
    if (!intentDoc.exists) return res.status(404).json({ error: 'Unknown tx_ref' });
    const intent = intentDoc.data();
    if (intent.userId !== req.user.uid) return res.status(403).json({ error: 'Not yours' });
    if (intent.status === 'successful') return res.json({ status: 'success', already: true, ...intent });

    const r = await fetch(`https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=${tx_ref}`, {
      headers: { Authorization: `Bearer ${process.env.FLW_SECRET_KEY}` }
    });
    const d = await r.json();
    if (d.status === 'success' && d.data.status === 'successful' && Number(d.data.amount) >= Number(intent.amount)) {
      await db.collection('payments').doc(tx_ref).update({ status: 'successful', flwId: d.data.id, verifiedAt: admin.firestore.FieldValue.serverTimestamp() });
      res.json({ status: 'success', ...intent, flwId: d.data.id });
    } else {
      res.status(400).json({ status: 'failed', flw: d.data });
    }
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/release-escrow', requireAuth, async (req, res) => {
  try {
    const { jobId, tip = 0 } = req.body;
    const jobRef = db.collection('jobs').doc(jobId);
    const jobDoc = await jobRef.get();
    if (!jobDoc.exists) return res.status(404).json({ error: 'Job not found' });
    const job = jobDoc.data();
    if (job.clientId !== req.user.uid && !req.profile.isAdmin) return res.status(403).json({ error: 'Only client or admin' });
    if (job.status === 'paid') return res.status(400).json({ error: 'Already paid' });
    if (!['funded', 'delivered', 'disputed', 'releasing'].includes(job.status)) return res.status(400).json({ error: `Cannot release from ${job.status}` });

    const fDoc = await db.collection('users').doc(job.freelancerId).get();
    const f = fDoc.data();
    if (!f || !f.bankCode || !f.accountNumber) return res.status(400).json({ error: 'Freelancer bank missing' });

    const gross = Number(job.amount);
    const payout = +(gross * 0.65).toFixed(2);
    const platformFee = +(gross * 0.35).toFixed(2);
    const tipAmt = Number(tip) || 0;
    const idempotencyKey = `release_${jobId}`;

    await jobRef.update({ status: 'releasing', releasedAt: admin.firestore.FieldValue.serverTimestamp() });

    const r = await fetch('https://api.flutterwave.com/v3/transfers', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ account_bank: f.bankCode, account_number: f.accountNumber, amount: payout + tipAmt, narration: `Domco Payout ${jobId}`, currency: 'NGN', reference: idempotencyKey })
    });
    const d = await r.json();
    if (d.status === 'success') {
      await jobRef.update({ status: 'paid', paidAt: admin.firestore.FieldValue.serverTimestamp(), flwTransferId: d.data.id, platformFee, payoutAmount: payout + tipAmt });
      await db.collection('transactions').add({ userId: job.freelancerId, jobId, amount: payout + tipAmt, type: 'payout', note: `Payout for ${job.title || jobId}`, createdAt: admin.firestore.FieldValue.serverTimestamp() });
      await db.collection('transactions').add({ userId: 'PLATFORM', jobId, amount: platformFee, type: 'platform_fee', note: `35% fee on ${job.title || jobId}`, createdAt: admin.firestore.FieldValue.serverTimestamp() });
      res.json({ message: 'Payout initiated', payout: payout + tipAmt, fee: platformFee });
    } else {
      await jobRef.update({ status: 'funded' });
      res.status(400).json({ error: d.message });
    }
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- WEBHOOK ----
app.post('/webhook/flutterwave', async (req, res) => {
  const hash = req.headers['verif-hash'];
  if (!hash || hash !== process.env.FLW_SECRET_HASH) return res.status(401).end();
  
  const event = req.body || {};
  const ref = event.data?.tx_ref || event.data?.reference; // Get the tx_ref
  const status = event.data?.status || event.status;

  // Handle successful payments (charge.completed)
  if (event.type === 'charge.completed' && status === 'successful' && ref) {
    try {
      const intentDoc = await db.collection('payments').doc(ref).get();
      if (!intentDoc.exists) return res.status(404).end();
      
      const intent = intentDoc.data();
      if (intent.status === 'successful') return res.status(200).end(); // Prevent double crediting

      // Mark payment as successful
      await db.collection('payments').doc(ref).update({
        status: 'successful',
        flwId: event.data.id,
        verifiedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      // Credit the user's wallet
      if (intent.purpose === 'wallet') {
        await db.collection('users').doc(intent.userId).update({
          walletBalance: admin.firestore.FieldValue.increment(intent.amount)
        });
        await db.collection('transactions').add({
          userId: intent.userId,
          amount: intent.amount,
          type: 'deposit',
          note: 'Wallet top-up via Flutterwave',
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
      }
    } catch (e) {
      console.error("Webhook processing error:", e);
    }
  }

  // Handle escrow release confirmation
  if (status && String(status).toUpperCase().includes('SUCCESS') && ref && ref.startsWith('release_')) {
    const jobId = ref.replace('release_', '');
    db.collection('jobs').doc(jobId).update({ status: 'paid', confirmedAt: admin.firestore.FieldValue.serverTimestamp() }).catch(() => {});
  }

  res.status(200).end();
});

// ---- WITHDRAW ----
app.post('/api/withdraw-wallet', requireAuth, async (req, res) => {
  try {
    const { amount, bankCode, accountNumber } = req.body;
    const amt = Number(amount);
    if (!amt || amt < 100) return res.status(400).json({ error: 'Minimum withdrawal is ₦100' });
    const balance = Number(req.profile.walletBalance || 0);
    if (balance < amt) return res.status(400).json({ error: 'Insufficient balance' });

    const reference = `wd_${req.user.uid}_${Date.now()}`;
    const r = await fetch('https://api.flutterwave.com/v3/transfers', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ account_bank: bankCode, account_number: accountNumber, amount: amt, narration: 'Domco Withdrawal', currency: 'NGN', reference })
    });
    const d = await r.json();
    if (d.status === 'success') {
      await db.collection('users').doc(req.user.uid).update({ walletBalance: admin.firestore.FieldValue.increment(-amt) });
      await db.collection('transactions').add({ userId: req.user.uid, amount: amt, type: 'withdrawal', note: 'Wallet withdrawal', reference, createdAt: admin.firestore.FieldValue.serverTimestamp() });
      res.json({ message: 'Withdrawal initiated', reference });
    } else res.status(400).json({ error: d.message });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- AI & SMS & ADMIN ----
app.post('/api/generate-gig', requireAuth, async (req, res) => {
  try {
    const { keywords } = req.body;
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=' + process.env.GEMINI_API_KEY, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: `Write a short engaging gig description under 100 words for: ${keywords}. No quotes.` }] }] })
    });
    const d = await r.json();
    const text = d.candidates?.[0]?.content?.parts?.[0]?.text;
    if (text) res.json({ text }); else res.status(400).json({ error: 'AI failed' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/send-sms', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { to, message } = req.body;
    const r = await fetch('https://api.ng.termii.com/api/sms/send', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, from: 'DomcoHub', sms: message, type: 'plain', channel: 'generic', api_key: process.env.TERMII_API_KEY })
    });
    res.json(await r.json());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin-stats', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [usersCount, jobsCount] = await Promise.all([ db.collection('users').count().get(), db.collection('jobs').count().get() ]);
    const fundedSnap = await db.collection('jobs').where('status', 'in', ['funded', 'delivered', 'disputed', 'releasing']).get();
    let escrow = 0; fundedSnap.forEach(d => escrow += Number(d.data().amount || 0));
    const feesSnap = await db.collection('transactions').where('type', '==', 'platform_fee').get();
    let profit = 0; feesSnap.forEach(d => profit += Number(d.data().amount || 0));
    res.json({ totalUsers: usersCount.data().count, totalJobs: jobsCount.data().count, escrow, profit: Math.round(profit) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- AUTO RELEASE CRON ----
app.post('/api/auto-release', async (req, res) => {
  if (req.headers['x-cron-secret'] !== process.env.CRON_SECRET) return res.status(401).json({ error: 'Unauthorized' });
  if (!db) return res.status(500).json({ error: 'Firebase not connected' });
  try {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const snap = await db.collection('jobs').where('status', '==', 'delivered').get();
    let released = 0;
    for (const doc of snap.docs) {
      const job = doc.data();
      const deliveredAt = job.deliveredAt?.toDate?.() || null;
      if (!deliveredAt || deliveredAt >= threeDaysAgo) continue;
      const fSnap = await db.collection('users').doc(job.freelancerId).get();
      const f = fSnap.data();
      if (!f?.bankCode || !f?.accountNumber) continue;
      const payout = +(Number(job.amount) * 0.65).toFixed(2);
      const r = await fetch('https://api.flutterwave.com/v3/transfers', {
        method: 'POST', headers: { Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ account_bank: f.bankCode, account_number: f.accountNumber, amount: payout, narration: `Auto-release ${doc.id}`, currency: 'NGN', reference: `auto_${doc.id}` })
      });
      const d = await r.json();
      if (d.status === 'success') {
        await doc.ref.update({ status: 'paid', paidAt: admin.firestore.FieldValue.serverTimestamp(), autoReleased: true });
        released++;
      }
    }
    res.json({ message: 'Auto-release complete', released });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// ---- IP ADDRESS FINDER ----
app.get('/api/my-ip', async (req, res) => {
  try {
    const r = await fetch('https://api.ipify.org?format=json');
    const d = await r.json();
    res.json({ render_server_ip: d.ip });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
// ---- START SERVER ----
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Domco backend live on ${PORT}`));
