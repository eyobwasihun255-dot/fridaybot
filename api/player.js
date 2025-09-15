// pages/api/player/[id].js
import { rtdb } from "../../bot/firebaseConfig.js"; // adjust path if needed
import { ref, get } from "firebase/database";

// Utility: format timestamp → YYYY-MM-DD HH:MM:SS
function formatDate(tsOrIso) {
  if (!tsOrIso) return null;
  const d = new Date(tsOrIso);
  return d.toISOString().split("T")[0] + " " + d.toISOString().split("T")[1].slice(0, 8);
}

export default async function handler(req, res) {
  try {
    const { id } = req.query;

    if (!id) {
      return res.status(400).json({ error: "Missing player ID" });
    }

    const playerId = id.toString();

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

    let gamesPlayed = 0;
    let gamesWon = 0;
    let totalWinnings = 0;
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
        amount: d.amount,
        method: d.method,
        date: formatDate(d.date),
      })),
    };

    return res.status(200).json(profile);
  } catch (err) {
    console.error("Error fetching player profile:", err);
    return res.status(500).json({ error: "Failed to fetch player profile" });
  }
}
