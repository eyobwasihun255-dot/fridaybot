import { gameManager } from "./game-manager.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { roomId, cardId } = req.query || {};
  if (!roomId || !cardId) {
    return res.status(400).json({ error: "Missing roomId or cardId" });
  }

  try {
    const room = await gameManager.getFullRoom(roomId);
    const cards = room?.bingoCards || {};
    const card = cards[cardId];
    if (!card) {
      return res.status(404).json({ error: "Card not found" });
    }
    return res.json({ card });
  } catch (err) {
    console.error("❌ Error fetching card data:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}


