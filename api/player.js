import { ref, get, query, orderByChild, equalTo } from "firebase/database";
import { rtdb } from "../bot/firebaseConfig.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { id } = req.body; // now POST body
  if (!id) return res.status(400).json({ error: "Player ID or username is required" });

  try {
    let user = null;

    // --- Try to get by telegramId first ---
    const userSnap = await get(ref(rtdb, `users/${id}`));
    if (userSnap.exists()) {
      user = userSnap.val();
    } else {
      // --- If not found, search by username ---
      const usernameQuery = query(ref(rtdb, "users"), orderByChild("username"), equalTo(id));
      const usernameSnap = await get(usernameQuery);
      if (usernameSnap.exists()) {
        user = Object.values(usernameSnap.val())[0];
      }
    }

    if (!user) return res.status(404).json({ error: "User not found" });

    // --- Aggregate winning history ---
    const winningQuery = query(ref(rtdb, "winningHistory"), orderByChild("playerId"), equalTo(user.telegramId));
    const winningSnap = await get(winningQuery);
    let totalWinnings = 0, gamesWon = 0;
    if (winningSnap.exists()) {
      Object.values(winningSnap.val()).forEach(entry => {
        totalWinnings += entry.payout || 0;
        gamesWon += 1;
      });
    }

    // --- Aggregate deposits ---
    const depositQuery = query(ref(rtdb, "deposits"), orderByChild("userId"), equalTo(user.telegramId));
    const depositSnap = await get(depositQuery);
    let totalDeposits = 0;
    if (depositSnap.exists()) {
      Object.values(depositSnap.val()).forEach(entry => totalDeposits += entry.amount || 0);
    }

    // --- Aggregate losses ---
    const deductQuery = query(ref(rtdb, "deductRdbs"), orderByChild("userId"), equalTo(user.telegramId));
    const deductSnap = await get(deductQuery);
    let totalLosses = 0;
    if (deductSnap.exists()) {
      Object.values(deductSnap.val()).forEach(entry => totalLosses += entry.amount || 0);
    }

    return res.status(200).json({
      telegramId: user.telegramId,
      username: user.username,
      balance: user.balance || 0,
      lang: user.lang || "en",
      gamesPlayed: user.gamesPlayed || 0,
      gamesWon,
      totalWinnings,
      totalDeposits,
      totalLosses,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    });
  } catch (err) {
    console.error("Error fetching player data:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
