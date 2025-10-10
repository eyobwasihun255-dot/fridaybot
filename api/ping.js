// /api/ping.js
import { ref, update } from "firebase/database";
import { rtdb } from "../bot/firebaseConfig.js";

export default async function handler(req, res) {
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  const { telegramId } = req.body;
  if (!telegramId)
    return res.status(400).json({ error: "Missing telegramId" });

  try {
    await update(ref(rtdb, `users/${telegramId}`), {
      lastActiveAt: Date.now(),
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("🔥 Failed to update activity:", err);
    return res.status(500).json({ error: "Failed to update activity" });
  }
}
