import GameManager from './game-manager.js';

// Initialize game manager
const gameManager = new GameManager();


// --- API Handler ---
export default async function handler(req, res) {
  const { roomId } = req.body;
  if (!roomId) return res.status(400).json({ error: "Missing roomId" });

  try {
    const result = await gameManager.startGame(roomId);
    res.json(result);
  } catch (err) {
    console.error("❌ Error starting game:", err);
    res.status(500).json({ error: "Failed to start game" });
  }
}
