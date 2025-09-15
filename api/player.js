import { ref, get, child } from "firebase/database";
import { rtdb } from "../bot/firebaseConfig.js"; // adjust path if needed

export default async function handler(req, res) {
  const { id } = req.query; // e.g., 123123
  if (!id) return res.status(400).json({ error: "Player ID is required" });

  try {
    // --- Get user info ---
    const userSnap = await get(ref(rtdb, `users/${id}`));
    if (!userSnap.exists()) {
      return res.status(404).json({ error: "User not found" });
    }
    const user = userSnap.val();

    // --- Aggregate winning history ---
    const winningSnap = await get(ref(rtdb, "winningHistory"));
    let totalWinnings = 0;
    let gamesWon = 0;

    if (winningSnap.exists()) {
      const winningData = winningSnap.val();
      for (const key in winningData) {
        const entry = winningData[key];
        if (entry.playerId === user.telegramId) {
          totalWinnings += entry.payout || 0;
          gamesWon += 1;
        }
      }
    }

    // --- Aggregate deposits ---
    const depositSnap = await get(ref(rtdb, "deposits"));
    let totalDeposits = 0;

    if (depositSnap.exists()) {
      const depositData = depositSnap.val();
      for (const key in depositData) {
        const entry = depositData[key];
        if (entry.userId === user.telegramId) {
          totalDeposits += entry.amount || 0;
        }
      }
    }

    // --- Aggregate losses (deductions) ---
    const deductSnap = await get(ref(rtdb, "deductRdbs"));
    let totalLosses = 0;

    if (deductSnap.exists()) {
      const deductData = deductSnap.val();
      for (const key in deductData) {
        const entry = deductData[key];
        if (entry.userId === user.telegramId) {
          totalLosses += entry.amount || 0;
        }
      }
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
