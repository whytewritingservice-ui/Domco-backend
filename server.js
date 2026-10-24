const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Route 1: Create Payment Link (Direct API Call)
app.post('/api/create-payment', async (req, res) => {
  try {
    const { jobId, amount, email } = req.body;
    
    const payload = {
      tx_ref: `domco-${jobId}-${Date.now()}`,
      amount: amount,
      currency: "NGN",
      redirect_url: https://benevolent-figolla-387f49.netlify.app
      customer: { 
        email: email || "test@test.com",
        name: "Domco Client"
      },
      customizations: {
        title: "Domco Hub Escrow",
        description: `Funding for Job ${jobId}`
      }
    };

    const response = await fetch('https://api.flutterwave.com/v3/payments', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.FLW_SECRET_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (data.status === "success") {
      res.json({ paymentLink: data.data.link });
    } else {
      console.error("Flutterwave Error:", data);
      res.status(400).json({ error: data.message || "Payment creation failed" });
    }
  } catch (error) {
    console.error("Server Error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Route 2: Release Escrow (Pay Freelancer)
app.post('/api/release-escrow', async (req, res) => {
  try {
    const { jobId, amount } = req.body;
    
    const payload = {
      account_bank: "044", 
      account_number: "0690000040", 
      amount: amount * 0.6, 
      narration: `Domco Payout Job ${jobId}`,
      currency: "NGN",
      reference: `payout-${jobId}-${Date.now()}`
    };

    const response = await fetch('https://api.flutterwave.com/v3/transfers', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.FLW_SECRET_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (data.status === "success") {
      res.json({ message: "Payout successful!" });
    } else {
      console.error("Flutterwave Transfer Error:", data);
      res.status(400).json({ error: data.message || "Transfer failed" });
    }
  } catch (error) {
    console.error("Server Error:", error);
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`Backend running on port ${PORT}`));
