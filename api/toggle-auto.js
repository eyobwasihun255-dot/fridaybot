import { gameManager } from "./game-manager.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { roomId, cardId, auto } = req.body || {};
  if (!roomId || !cardId || typeof auto !== "boolean") {
    return res
      .status(400)
      .json({ success: false, message: "Missing roomId, cardId, or auto" });
  }

  try {
    const autoUntil = auto ? Date.now() + 24 * 60 * 60 * 1000 : null;
    const result = await gameManager.setCardAutoState(roomId, cardId, {
      auto,
      autoUntil,
    });

    if (result.success && gameManager.io) {
      gameManager.io.to(roomId).emit("cardAutoUpdated", {
        roomId,
        cardId,
        auto,
        autoUntil,
      });
    }

    return res.status(result.success ? 200 : 400).json(result);
  } catch (err) {
    console.error("❌ Error toggling auto bet:", err);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
}


