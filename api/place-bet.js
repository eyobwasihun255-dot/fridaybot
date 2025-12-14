import { gameManager } from "./game-manager.js";
import { rtdb } from "../bot/firebaseConfig.js";
import { ref, get } from "firebase/database";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { roomId, cardId, userId } = req.body || {};

  if (!roomId || !cardId || !userId) {
    return res
      .status(400)
      .json({ success: false, message: "Missing roomId, cardId or userId" });
  }

  try {
    // Enforce room state (waiting/countdown only) via runtime state
    const runtime = (await gameManager.getRoomState(roomId)) || {};
    const status =  runtime.gameStatus || "unknown";
    if (status !== "waiting" && status !== "countdown") {
      return res
        .status(400)
        .json({ success: false, message: "Room not accepting bets right now" });
    }

    // Fetch user from RTDB to get username (permanent store)
    const userSnap = await get(ref(rtdb, `users/${userId}`));
    if (!userSnap.exists()) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    const user = userSnap.val();

    const result = await gameManager.placeBet(roomId, cardId, {
      telegramId: userId,
      username: user.username || "",
    });

    if (!result.success) {
      return res.status(400).json(result);
    }

    return res.json({ success: true });
  } catch (err) {
    console.error("❌ Error in place-bet handler:", err);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
}


