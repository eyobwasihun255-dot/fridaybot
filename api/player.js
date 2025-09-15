import { ref, get, query, orderByChild, equalTo, child } from "firebase/database";
import { rtdb } from "../bot/firebaseConfig.js";

export default async function handler(req, res) {
  const { id } = req.query;
  if (!id) return res.status(400).json({ error: "Player ID or username is required" });

  try {
    let user = null;

    // --- Try to get by telegramId (key) first ---
    const userSnap = await get(ref(rtdb, `users/${id}`));
    if (userSnap.exists()) {
      user = userSnap.val();
    } else {
      // --- If not found, search by username ---
      const usernameQuery = query(ref(rtdb, "users"), orderByChild("username"), equalTo(id));
      const usernameSnap = await get(usernameQuery);
      if (usernameSnap.exists()) {
        const users = usernameSnap.val();
        // There should be only one match
        user = Object.values(users)[0];
      }
    }

    if (!user) return res.status(404).json({ error: "User not found" });

    // --- Aggregate winning history ---
    const winningQuery = query(ref(rtdb, "winningHistory"), orderByChild("playerId"), equalTo(user.telegramId));
    const winningSnap = await get(winningQuery);
    let totalWinnings = 0;
    let gamesWon = 0;

    if (winningSnap.exists()) {
      const winningData = winningSnap.val();
      for (const key in winningData) {
        const entry = winningData[key];
        totalWinnings += entry.payout || 0;
        gamesWon += 1;
      }
    }

    // --- Aggregate deposits ---
    const depositQuery = query(ref(rtdb, "deposits"), orderByChild("userId"), equalTo(user.telegramId));
    const depositSnap = await get(depositQuery);
    let totalDeposits = 0;
    if (depositSnap.exists()) {
      const depositData = depositSnap.val();
      for (const key in depositData) totalDeposits += depositData[key].amount || 0;
    }

    // --- Aggregate losses (deductions) ---
    const deductQuery = query(ref(rtdb, "deductRdbs"), orderByChild("userId"), equalTo(user.telegramId));
    const deductSnap = await get(deductQuery);
    let totalLosses = 0;
    if (deductSnap.exists()) {
      const deductData = deductSnap.val();
      for (const key in deductData) totalLosses += deductData[key].amount || 0;
    }

    // --- Construct JSON response ---
    const response = {
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
    };

    return res.status(200).json(response);
  } catch (error) {
    console.error("Error fetching player data:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
