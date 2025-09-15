import { ref, get } from "firebase/database";
import { rtdb } from "../bot/firebaseConfig.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { id } = req.body; // POST body
  if (!id) return res.status(400).json({ error: "Player ID or username is required" });

  try {
    let user = null;

    // --- Fetch all users and find by telegramId or username ---
    const usersSnap = await get(ref(rtdb, "users"));
    const users = usersSnap.val() || {};
    user = Object.values(users).find(
      u => u.telegramId === id || u.username === id
    );

    if (!user) return res.status(404).json({ error: "User not found" });

    // --- Aggregate winning history ---
    const winningSnap = await get(ref(rtdb, "winningHistory"));
    const winnings = winningSnap.val() || {};
    let totalWinnings = 0, gamesWon = 0;

    Object.values(winnings).forEach(entry => {
      if (entry.playerId === user.telegramId) {
        totalWinnings += entry.payout || 0;
        gamesWon += 1;
      }
    });

    // --- Aggregate deposits ---
    const depositSnap = await get(ref(rtdb, "deposits"));
    const deposits = depositSnap.val() || {};
    let totalDeposits = 0;

    Object.values(deposits).forEach(entry => {
      if (entry.userId === user.telegramId) totalDeposits += entry.amount || 0;
    });

    // --- Aggregate losses ---
    const deductSnap = await get(ref(rtdb, "deductRdbs"));
    const deductions = deductSnap.val() || {};
    let totalLosses = 0;

    Object.values(deductions).forEach(entry => {
      if (entry.userId === user.telegramId) totalLosses += entry.amount || 0;
    });

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
