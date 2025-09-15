import express from "express";
import { rtdb } from "../bot/firebase/config.js";
import { ref, get, query, orderByChild, equalTo } from "firebase/database";

const app = express();
const PORT = process.env.PORT || 5000;

// Utility: format date
function formatDate(tsOrIso) {
  const d = new Date(tsOrIso);
  return d.toISOString().split("T")[0] + " " + d.toISOString().split("T")[1].slice(0, 8);
}

// GET player profile by telegramId
app.get("/player/:id", async (req, res) => {
  try {
    const playerId = req.params.id.toString();

    // --- Get User Info ---
    const userRef = ref(rtdb, `users/${playerId}`);
    const userSnap = await get(userRef);

    if (!userSnap.exists()) {
      return res.status(404).json({ error: "Player not found" });
    }
    const user = userSnap.val();

    // --- Get Winning History ---
    const historyRef = ref(rtdb, "winningHistory");
    const historySnap = await get(historyRef);
    let gamesPlayed = 0, gamesWon = 0, totalWinnings = 0;
    let historyList = [];

    if (historySnap.exists()) {
      const historyData = Object.values(historySnap.val());
      historyList = historyData.filter(h => h.playerId === playerId);

      gamesPlayed = historyList.length;
      gamesWon = historyList.filter(h => h.payout > 0).length;
      totalWinnings = historyList.reduce((sum, h) => sum + (h.payout || 0), 0);
    }

    // --- Get Deposits ---
    const depositsRef = ref(rtdb, "deposits");
    const depositsSnap = await get(depositsRef);
    let totalDeposits = 0;
    let depositList = [];

    if (depositsSnap.exists()) {
      const depositsData = Object.values(depositsSnap.val());
      depositList = depositsData.filter(d => d.userId === playerId);
      totalDeposits = depositList.reduce((sum, d) => sum + (d.amount || 0), 0);
    }

    // --- Build Response ---
    const profile = {
      telegramId: user.telegramId,
      username: user.username,
      balance: user.balance,
      lang: user.lang,
      createdAt: formatDate(user.createdAt),
      gamesPlayed,
      gamesWon,
      totalWinnings,
      totalDeposits,
      history: historyList.map(h => ({
        gameId: h.gameId,
        roomId: h.roomId,
        cardId: h.cardId,
        payout: h.payout,
        date: formatDate(h.date),
      })),
      deposits: depositList.map(d => ({
        id: d.depositId,
        amount: d.amount,
        method: d.method,
        date: formatDate(d.date),
      })),
    };

    res.json(profile);
  } catch (err) {
    console.error("Error fetching player profile:", err);
    res.status(500).json({ error: "Failed to fetch player profile" });
  }
});

app.listen(PORT, () => console.log(`Player API running on port ${PORT}`));
