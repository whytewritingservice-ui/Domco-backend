const express = require('express');
const cors = require('cors');
const Flutterwave = require('flutterwave-node-v3');

const app = express();
app.use(cors());
app.use(express.json());

// Render will inject your secret keys here
const flw = new Flutterwave(process.env.FLW_PUBLIC_KEY, process.env.FLW_SECRET_KEY);

app.post('/api/create-payment', async (req, res) => {
  try {
    const { jobId, amount, email } = req.body;
    const payload = {
      tx_ref: `domco-${jobId}-${Date.now()}`,
      amount: amount,
      currency: "NGN",
      redirect_url: "https://google.com",
      customer: { email: email || "test@test.com" },
      customizations: { title: "Domco Hub Escrow", description: `Funding Job ${jobId}` }
    };
    const response = await flw.Standard.create_payment(payload);
    if (response.status === "success") {
      res.json({ paymentLink: response.data.link });
    } else {
      res.status(400).json({ error: "Payment failed" });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

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
    const response = await flw.Transfer.initiate(payload);
    if (response.status === "success") {
      res.json({ message: "Payout successful!" });
    } else {
      res.status(400).json({ error: "Transfer failed" });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`Backend running on port ${PORT}`));
