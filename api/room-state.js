import { gameManager } from "./game-manager.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { roomId } = req.query || {};

  if (!roomId) {
    return res.status(400).json({ error: "Missing roomId" });
  }

  try {
    const room = await gameManager.getFullRoom(roomId);
    return res.json({ room });
  } catch (err) {
    console.error("❌ Error in room-state handler:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}


