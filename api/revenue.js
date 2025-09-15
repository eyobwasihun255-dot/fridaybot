
import express from "express";
import { rtdb } from "../bot/firebaseConfig.js";// adjust your path
import { ref, get } from "firebase/database";

const app = express();
const PORT = process.env.PORT || 5000;

// Utility: format timestamp → YYYY-MM-DD
function formatDate(ts) {
  const d = new Date(ts);
  return d.toISOString().split("T")[0];
}

app.get("/api/revenue", async (req, res) => {
  try {
    const revenueRef = ref(rtdb, "revenue");
    const snapshot = await get(revenueRef);

    if (!snapshot.exists()) {
      return res.json({ totalByDate: {}, undrawnedTotal: 0, undrawnedDetails: [] });
    }

    const data = snapshot.val();
    const totalByDate = {};
    let undrawnedTotal = 0;
    const undrawnedDetails = [];

    Object.values(data).forEach((entry) => {
      if (!entry?.datetime || !entry?.amount) return;

      // --- Group by date ---
      const dateKey = formatDate(entry.datetime);
      totalByDate[dateKey] = (totalByDate[dateKey] || 0) + entry.amount;

      // --- Undrawned revenue ---
      if (!entry.drawned) {
        undrawnedTotal += entry.amount;
        undrawnedDetails.push(entry);
      }
    });

    res.json({
      totalByDate,
      undrawnedTotal,
      undrawnedDetails,
    });
  } catch (err) {
    console.error("Error fetching revenue:", err);
    res.status(500).json({ error: "Failed to fetch revenue" });
  }
});

app.listen(PORT, () => console.log(`Revenue API running on port ${PORT}`));