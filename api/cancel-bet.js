import { gameManager } from "./game-manager.js";

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
    const result = await gameManager.cancelBetForPlayer(roomId, cardId, userId);

    if (!result.success) {
      return res.status(400).json(result);
    }

    return res.json({ success: true });
  } catch (err) {
    console.error("❌ Error in cancel-bet handler:", err);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
}


