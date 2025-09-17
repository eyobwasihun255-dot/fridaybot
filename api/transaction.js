import express from "express";
import { ref, get } from "firebase/database"; // adjust path to your config
import { rtdb } from "../bot/firebaseConfig.js";
const router = express.Router();

/**
 * Helper: group by date (YYYY-MM-DD)
 */
function groupByDate(entries, field = "amount") {
  const totals = {};
  for (const entry of entries) {
    const date = new Date(entry.datetime).toISOString().split("T")[0];
    if (!totals[date]) totals[date] = 0;
    totals[date] += entry[field] || 0;
  }
  return totals;
}

/**
 * GET /api/transaction
 */
router.get("/transaction", async (req, res) => {
  try {
    // 1️⃣ Total balance across all users
    const usersSnap = await get(ref(rtdb, "users"));
    let totalBalance = 0;
    if (usersSnap.exists()) {
      const users = usersSnap.val();
      for (const uid in users) {
        totalBalance += users[uid].balance || 0;
      }
    }

    // 2️⃣ Deposits
    const depositsSnap = await get(ref(rtdb, "deposits"));
    let totalDeposits = 0;
    let depositsByDate = {};
    if (depositsSnap.exists()) {
      const deposits = Object.values(depositsSnap.val());
      totalDeposits = deposits.reduce((sum, d) => sum + (d.amount || 0), 0);
      depositsByDate = groupByDate(deposits);
    }

    // 3️⃣ Withdrawals
    const withdrawSnap = await get(ref(rtdb, "withdrawals"));
    let totalWithdrawals = 0;
    let withdrawalsByDate = {};
    if (withdrawSnap.exists()) {
      const withdrawals = Object.values(withdrawSnap.val());
      totalWithdrawals = withdrawals.reduce((sum, w) => sum + (w.amount || 0), 0);
      withdrawalsByDate = groupByDate(withdrawals);
    }

    // 4️⃣ Revenues
    const revenueSnap = await get(ref(rtdb, "revenue"));
    let totalRevenue = 0;
    let revenueByDate = {};
    if (revenueSnap.exists()) {
      const revenues = Object.values(revenueSnap.val());
      for (const r of revenues) {
        const date = new Date(r.datetime).toISOString().split("T")[0];
        if (!revenueByDate[date]) {
          revenueByDate[date] = { drawned: 0, undrawned: 0 };
        }

        if (r.drawned) {
          revenueByDate[date].drawned += r.amount || 0;
        } else {
          revenueByDate[date].undrawned += r.amount || 0;
        }
        totalRevenue += r.amount || 0;
      }
    }

    // ✅ Return as JSON
    res.json({
      totalBalance,
      deposits: { total: totalDeposits, byDate: depositsByDate },
      withdrawals: { total: totalWithdrawals, byDate: withdrawalsByDate },
      revenue: { total: totalRevenue, byDate: revenueByDate },
    });

  } catch (err) {
    console.error("❌ Error fetching transaction summary:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
