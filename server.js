app.get('/api/banks', requireAuth, async (req, res) => {
  try {
    const r = await fetch('https://api.flutterwave.com/v3/banks/NG', {
      headers: { Authorization: `Bearer ${process.env.FLW_SECRET_KEY}` }
    });
    
    // Check if Flutterwave returned a JSON response
    const contentType = r.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      // If it's not JSON, read the text to see what the error is
      const textError = await r.text();
      console.error("Flutterwave returned a non-JSON error:", textError);
      return res.status(502).json({ 
        error: "Flutterwave is temporarily unavailable. Please try again." 
      });
    }

    const d = await r.json();
    if (d.status === 'success') {
      res.json(d.data);
    } else {
      console.error("Flutterwave Banks API Error:", d);
      res.status(400).json({ error: d.message || 'Failed to fetch banks' });
    }
  } catch (e) { 
    console.error("Server error fetching banks:", e);
    res.status(500).json({ error: e.message }); 
  }
});
