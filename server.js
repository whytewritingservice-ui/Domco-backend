const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());
const admin = require('firebase-admin');

// Initialize Firebase Admin (Requires a Service Account Key)
// Note: In a real production environment, you upload your Firebase Service Account JSON to Render 
// and set the FIREBASE_SERVICE_ACCOUNT environment variable.
// For now, we will mock the DB calls so the backend doesn't crash if the key is missing.
let db;
try {
  // If you add the FIREBASE_SERVICE_ACCOUNT env var, this will connect.
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    db = admin.firestore();
    console.log("✅ Firebase Admin Connected");
  } else {
    console.warn("⚠️ FIREBASE_SERVICE_ACCOUNT not set. Backend DB access is mocked.");
  }
} catch (e) {
  console.error("Firebase Admin Error:", e.message);
}

// ==========================================
// 9. TIPS & MILESTONES (Backend Routes)
// ==========================================

// Charge a Tip
app.post('/api/charge-tip', async (req, res) => {
  try {
    const { jobId, freelancerId, amount, email } = req.body;
    
    // Create a separate Flutterwave payment for the tip
    const payload = {
      tx_ref: `domco-tip-${jobId}-${Date.now()}`,
      amount: amount,
      currency: "NGN",
      redirect_url: "https://whytewritingservice-ui.github.io/Domco-app/",
      customer: { email: email },
      customizations: { title: "Domco Tip", description: `Tip for job ${jobId}` }
    };

    const response = await fetch('https://api.flutterwave.com/v3/payments', {
      method: 'POST', headers: { 'Authorization': `Bearer ${process.env.FLW_SECRET_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    });
    const data = await response.json();
    
    if (data.status === "success") {
      res.json({ paymentLink: data.data.link });
    } else {
      res.status(400).json({ error: data.message });
    }
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// Fund Milestone (Partial Funding)
app.post('/api/fund-milestone', async (req, res) => {
  try {
    const { jobId, amount, email, milestoneIndex } = req.body;
    
    const payload = {
      tx_ref: `domco-milestone-${milestoneIndex}-${jobId}-${Date.now()}`,
      amount: amount,
      currency: "NGN",
      redirect_url: "https://whytewritingservice-ui.github.io/Domco-app/",
      customer: { email: email },
      customizations: { title: "Domco Milestone", description: `Milestone ${milestoneIndex + 1} for Job ${jobId}` }
    };

    const response = await fetch('https://api.flutterwave.com/v3/payments', {
      method: 'POST', headers: { 'Authorization': `Bearer ${process.env.FLW_SECRET_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    });
    const data = await response.json();
    
    if (data.status === "success") res.json({ paymentLink: data.data.link });
    else res.status(400).json({ error: data.message });
  } catch (error) { res.status(500).json({ error: error.message }); }
});
// Environment Variables Check
const requiredEnv = ['FLW_SECRET_KEY', 'GEMINI_API_KEY', 'TERMII_API_KEY'];
requiredEnv.forEach(env => {
  if (!process.env[env]) console.warn(`⚠️ WARNING: Missing Environment Variable: ${env}`);
});

// ==========================================
// 1. BANK & VERIFICATION ROUTES
// ==========================================

// Fetch ALL Nigerian Banks
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

// Strict Bank Name Resolution
app.post('/api/resolve-account', async (req, res) => {
  try {
    const { account_number, account_bank } = req.body;
    const response = await fetch('https://api.flutterwave.com/v3/accounts/resolve', {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${process.env.FLW_SECRET_KEY}`, 
        'Content-Type': 'application/json' 
      },
      body: JSON.stringify({ account_number, account_bank })
    });
    const data = await response.json();
    if (data.status === 'success') res.json({ account_name: data.data.account_name });
    else res.status(400).json({ error: 'Could not resolve account. Check details.' });
  } catch (error) { res.status(500).json({ error: error.message }); }
});
// ==========================================
// 2. ESCROW & PAYMENT ROUTES
// ==========================================

// Create Payment Link (Fund Escrow / Milestones / Boosts)
app.post('/api/create-payment', async (req, res) => {
  try {
    const { jobId, amount, email, paymentType } = req.body;
    
    // paymentType can be 'escrow', 'milestone', 'boost', 'urgent'
    const tx_ref = `domco-${paymentType || 'escrow'}-${jobId}-${Date.now()}`;

    const payload = {
      tx_ref: tx_ref,
      amount: amount,
      currency: "NGN",
      redirect_url: "https://whytewritingservice-ui.github.io/Domco-app/",
      customer: { email: email, name: "Domco User" },
      customizations: { 
        title: "Domco Hub Escrow", 
        description: `Payment for ${jobId}` 
      }
    };

    const response = await fetch('https://api.flutterwave.com/v3/payments', {
      method: 'POST', 
      headers: { 'Authorization': `Bearer ${process.env.FLW_SECRET_KEY}`, 'Content-Type': 'application/json' }, 
      body: JSON.stringify(payload)
    });
    
    const data = await response.json();
    if (data.status === "success") res.json({ paymentLink: data.data.link, tx_ref });
    else res.status(400).json({ error: data.message });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// Verify Payment (Called when user returns to the app)
app.post('/api/verify-payment', async (req, res) => {
  try {
    const { tx_ref } = req.body;
    const response = await fetch(`https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=${tx_ref}`, {
      headers: { 'Authorization': `Bearer ${process.env.FLW_SECRET_KEY}` }
    });
    const data = await response.json();
    
    if (data.status === 'success' && data.data.status === 'successful') {
      // Extract details from tx_ref: domco-escrow-j_123-1234567
      const parts = tx_ref.split('-');
      res.json({ 
        status: 'success', 
        paymentType: parts[1], 
        jobId: parts[2], 
        amount: data.data.amount,
        customerEmail: data.data.customer.email
      });
    } else { 
      res.status(400).json({ status: 'failed', message: 'Payment not successful' }); 
    }
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// Release Escrow to Freelancer (65% Payout)
app.post('/api/release-escrow', async (req, res) => {
  try {
    const { jobId, amount, freelancerBankCode, freelancerAccountNumber } = req.body;
    
    // Platform Fee Logic: 35% platform, 65% freelancer
    const platformFee = amount * 0.35;
    const payoutAmount = amount - platformFee;

    const payload = { 
      account_bank: freelancerBankCode, 
      account_number: freelancerAccountNumber, 
      amount: payoutAmount, 
      narration: `Domco Payout: ${jobId}`, 
      currency: "NGN", 
      reference: `pay-${jobId}-${Date.now()}` 
    };

    const response = await fetch('https://api.flutterwave.com/v3/transfers', { 
      method: 'POST', 
      headers: { 'Authorization': `Bearer ${process.env.FLW_SECRET_KEY}`, 'Content-Type': 'application/json' }, 
      body: JSON.stringify(payload) 
    });
    
    const data = await response.json();
    if (data.status === "success") {
      res.json({ message: "Payout successful!", payoutAmount, platformFee });
    } else {
      res.status(400).json({ error: data.message });
    }
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// Refund Client (Admin Dispute Resolution)
app.post('/api/refund-client', async (req, res) => {
  try {
    const { jobId, amount, clientBankCode, clientAccountNumber } = req.body;
    
    // Refund full amount to client
    const payload = { 
      account_bank: clientBankCode, 
      account_number: clientAccountNumber, 
      amount: amount, 
      narration: `Domco Refund: ${jobId}`, 
      currency: "NGN", 
      reference: `refund-${jobId}-${Date.now()}` 
    };

    const response = await fetch('https://api.flutterwave.com/v3/transfers', { 
      method: 'POST', 
      headers: { 'Authorization': `Bearer ${process.env.FLW_SECRET_KEY}`, 'Content-Type': 'application/json' }, 
      body: JSON.stringify(payload) 
    });
    
    const data = await response.json();
    if (data.status === "success") res.json({ message: "Refund successful!" });
    else res.status(400).json({ error: data.message });
  } catch (error) { res.status(500).json({ error: error.message }); }
});
// ==========================================
// 3. AI, SMS & WALLET ROUTES
// ==========================================

// 7. AI Gig Writer (Google Gemini - Updated for new AQ. keys)
app.post('/api/generate-gig', async (req, res) => {
  try {
    const { keywords } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'Gemini API key not configured' });

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey 
      },
      body: JSON.stringify({
        contents: [{ 
          parts: [{ text: `You are a professional copywriter for a freelance app. Write a short, engaging gig description (under 100 words) based on these keywords: ${keywords}. Do not include quotes.` }] 
        }]
      })
    });

    const data = await response.json();
    
    if (data.candidates && data.candidates[0].content.parts[0].text) {
      res.json({ text: data.candidates[0].content.parts[0].text });
    } else {
      console.error("Gemini Error Details:", JSON.stringify(data));
      res.status(400).json({ error: data.error?.message || 'AI generation failed' });
    }
  } catch (error) { res.status(500).json({ error: error.message }); }
});

    const data = await response.json();
    if (data.candidates && data.candidates[0].content.parts[0].text) {
      res.json({ text: data.candidates[0].content.parts[0].text });
    } else {
      console.error("Gemini Error:", data);
      res.status(400).json({ error: 'AI generation failed' });
    }
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// Send SMS Notification (Termii)
app.post('/api/send-sms', async (req, res) => {
  try {
    const { to, message } = req.body;
    const apiKey = process.env.TERMII_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'Termii API key not configured' });

    const response = await fetch('https://api.ng.termii.com/api/sms/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: to,
        from: "DomcoHub",
        sms: message,
        type: "plain",
        channel: "generic",
        api_key: apiKey
      })
    });

    const data = await response.json();
    res.json(data);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// Withdraw Wallet Balance (Referrals, Tips, Loans)
app.post('/api/withdraw-wallet', async (req, res) => {
  try {
    const { amount, bankCode, accountNumber } = req.body;
    const payload = { 
      account_bank: bankCode, 
      account_number: accountNumber, 
      amount: amount, 
      narration: `Domco Wallet Withdrawal`, 
      currency: "NGN", 
      reference: `wd-${Date.now()}` 
    };

    const response = await fetch('https://api.flutterwave.com/v3/transfers', { 
      method: 'POST', 
      headers: { 'Authorization': `Bearer ${process.env.FLW_SECRET_KEY}`, 'Content-Type': 'application/json' }, 
      body: JSON.stringify(payload) 
    });
    
    const data = await response.json();
    if (data.status === "success") res.json({ message: "Withdrawal successful!" });
    else res.status(400).json({ error: data.message });
  } catch (error) { res.status(500).json({ error: error.message }); }
});
// ==========================================
// 4. WEBHOOKS & SERVER STARTUP
// ==========================================

// Flutterwave Webhook (Listens for successful payments)
app.post('/webhook', async (req, res) => {
  try {
    // Verify the webhook signature to ensure it's from Flutterwave
    const secretHash = process.env.FLW_SECRET_HASH;
    const signature = req.headers['verif-hash'];

    if (!signature || (signature !== secretHash)) {
      return res.status(401).end();
    }

    const payload = req.body;
    
    // Check if the event is a successful charge
    if (payload.event === "charge.completed" && payload.data.status === "successful") {
      const tx_ref = payload.data.tx_ref;
      const amount = payload.data.amount;
      const customerEmail = payload.data.customer.email;
      
      console.log(`✅ Webhook: Payment Successful for ${tx_ref} - Amount: ${amount}`);

      // In a full production app, you would update the Firebase database here
      // using the Firebase Admin SDK. For now, we log it so you know it works.
    }

    res.status(200).end();
  } catch (error) {
    console.error("Webhook Error:", error);
    res.status(500).end();
  }
});

// Health Check Route (Keeps Render awake)
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'active', timestamp: new Date().toISOString() });
});

// ==========================================
// 10. AUTO-RELEASE CRON JOB
// ==========================================
app.post('/api/auto-release', async (req, res) => {
  // Security check: Only allow your cron job service to trigger this
  const secret = req.headers['x-cron-secret'];
  if (secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized. Missing cron secret.' });
  }

  if (!db) {
    return res.status(500).json({ error: 'Firebase Admin not connected. Cannot auto-release.' });
  }

  try {
    const now = Date.now();
    const threeDaysAgo = now - (3 * 24 * 60 * 60 * 1000); // 3 days in milliseconds
    let releasedCount = 0;

    // Find all jobs with status 'delivered'
    const jobsRef = db.collection('jobs');
    const snapshot = await jobsRef.where('status', '==', 'delivered').get();

    if (snapshot.empty) {
      return res.json({ message: 'No delivered jobs found.' });
    }

    for (const doc of snapshot.docs) {
      const job = doc.data();
      const deliveredTime = job.deliveredAt ? job.deliveredAt.toMillis() : 0;

      // Check if it has been delivered for more than 3 days
      if (deliveredTime > 0 && deliveredTime < threeDaysAgo) {
        // Get Freelancer Bank Details
        const freelancerDoc = await db.collection('users').doc(job.freelancerId).get();
        const fProfile = freelancerDoc.data();

        if (fProfile && fProfile.bankCode && fProfile.accountNumber) {
          const payoutAmount = job.amount * 0.65;
          
          try {
            // Trigger Flutterwave Transfer
            const payload = { 
              account_bank: fProfile.bankCode, 
              account_number: fProfile.accountNumber, 
              amount: payoutAmount, 
              narration: `Auto-Release: ${job.gigTitle}`, 
              currency: "NGN", 
              reference: `auto-${doc.id}-${Date.now()}` 
            };
            
            const response = await fetch('https://api.flutterwave.com/v3/transfers', { 
              method: 'POST', 
              headers: { 'Authorization': `Bearer ${process.env.FLW_SECRET_KEY}`, 'Content-Type': 'application/json' }, 
              body: JSON.stringify(payload) 
            });
            
            const data = await response.json();
            
            if (data.status === "success") {
              // Update Job Status
              await jobsRef.doc(doc.id).update({ 
                status: 'paid', 
                paidAt: admin.firestore.FieldValue.serverTimestamp(),
                autoReleased: true
              });
              
              // Log Transaction
              await db.collection('transactions').add({
                userId: job.freelancerId, 
                jobId: doc.id, 
                amount: payoutAmount, 
                type: 'payout', 
                note: `Auto-Release: ${job.gigTitle}`, 
                createdAt: admin.firestore.FieldValue.serverTimestamp()
              });
              
              releasedCount++;
              console.log(`✅ Auto-released ₦${payoutAmount} for job ${doc.id}`);
            } else {
              console.error(`❌ Flutterwave transfer failed for job ${doc.id}:`, data.message);
            }
          } catch (err) {
            console.error(`❌ Error releasing job ${doc.id}:`, err.message);
          }
        }
      }
    }

    res.json({ message: 'Auto-release check complete', releasedCount });
  } catch (error) {
    console.error("Auto-release Error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Start the Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`=========================================`);
  console.log(`🚀 DOMCO HUB BACKEND LIVE ON PORT ${PORT}`);
  console.log(`=========================================`);
});
