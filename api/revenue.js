import express from "express";
import { rtdb } from "../bot/firebaseConfig.js"; // adjust path if needed
import { ref, get } from "firebase/database";

const app = express();
const PORT = process.env.PORT || 5000;

// Utility: format timestamp → YYYY-MM-DD
function formatDate(ts) {
  const d = new Date(ts);
  return d.toISOString().split("T")[0];
}

// Revenue route with passcode check
app.get("/api/revenue/:passcode", async (req, res) => {
  try {
    const { passcode } = req.params;

    // ✅ Check passcode
    if (passcode !== "12123434") {
      return res.status(403).json({ error: "Forbidden: invalid passcode" });
    }

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

    return res.json({
      totalByDate,
      undrawnedTotal,
      undrawnedDetails,
    });
  } catch (err) {
    console.error("Error fetching revenue:", err);
    return res.status(500).json({ error: "Failed to fetch revenue" });
  }
});

app.listen(PORT, () => console.log(`Revenue API running on port ${PORT}`));
