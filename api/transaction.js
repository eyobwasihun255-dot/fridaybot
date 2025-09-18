import express from "express";
import { rtdb } from "../bot/firebaseConfig.js"; // adjust path
import { ref, get } from "firebase/database";

const router = express.Router();

// Utility: format timestamp → YYYY-MM-DD
function formatDate(ts) {
  const d = new Date(ts);
  return d.toISOString().split("T")[0];
}

router.get("/transaction", async (req, res) => {
  try {
    // --- 1. User balances ---
    const usersRef = ref(rtdb, "users");
    const usersSnap = await get(usersRef);
    let totalBalance = 0;
    if (usersSnap.exists()) {
      const users = usersSnap.val();
      Object.values(users).forEach((u) => {
        totalBalance += u?.balance || 0;
      });
    }

    // --- 2. Deposits ---
    const depositsRef = ref(rtdb, "deposits");
    const depositsSnap = await get(depositsRef);
    const depositsByDate = {};
    let totalDeposits = 0;
    if (depositsSnap.exists()) {
      const deposits = depositsSnap.val();
      Object.values(deposits).forEach((dep) => {
        if (!dep?.amount || !dep?.datetime) return;
        const dateKey = formatDate(dep.datetime);
        depositsByDate[dateKey] = (depositsByDate[dateKey] || 0) + dep.amount;
        totalDeposits += dep.amount;
      });
    }

    // --- 3. Withdrawals ---
    const withdrawalsRef = ref(rtdb, "withdrawals");
    const withdrawalsSnap = await get(withdrawalsRef);
    const withdrawalsByDate = {};
    let totalWithdrawals = 0;
    if (withdrawalsSnap.exists()) {
      const withdrawals = withdrawalsSnap.val();
      Object.values(withdrawals).forEach((wd) => {
        if (!wd?.amount || !wd?.datetime) return;
        const dateKey = formatDate(wd.datetime);
        withdrawalsByDate[dateKey] = (withdrawalsByDate[dateKey] || 0) + wd.amount;
        totalWithdrawals += wd.amount;
      });
    }

    // --- 4. Revenues ---
    const revenueRef = ref(rtdb, "revenue");
    const revenueSnap = await get(revenueRef);
    const revenueByDate = {};
    const drawnedByDate = {};
    const undrawnedByDate = {};
    let totalRevenue = 0;
    let totalDrawned = 0;
    let totalUndrawned = 0;

    if (revenueSnap.exists()) {
      const revenues = revenueSnap.val();
      Object.values(revenues).forEach((rev) => {
        if (!rev?.amount || !rev?.datetime) return;
        const dateKey = formatDate(rev.datetime);

        // Total revenue
        revenueByDate[dateKey] = (revenueByDate[dateKey] || 0) + rev.amount;
        totalRevenue += rev.amount;

        if (rev.drawned) {
          drawnedByDate[dateKey] = (drawnedByDate[dateKey] || 0) + rev.amount;
          totalDrawned += rev.amount;
        } else {
          undrawnedByDate[dateKey] = (undrawnedByDate[dateKey] || 0) + rev.amount;
          totalUndrawned += rev.amount;
        }
      });
    }

    res.json({
      balances: {
        totalBalance,
      },
      deposits: {
        totalDeposits,
        depositsByDate,
      },
      withdrawals: {
        totalWithdrawals,
        withdrawalsByDate,
      },
      revenue: {
        totalRevenue,
        revenueByDate,
        totalDrawned,
        drawnedByDate,
        totalUndrawned,
        undrawnedByDate,
      },
    });
  } catch (err) {
    console.error("Error fetching transaction data:", err);
    res.status(500).json({ error: "Failed to fetch transaction data" });
  }
});

export default router;
