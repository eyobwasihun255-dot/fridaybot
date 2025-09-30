import GameManager from './game-manager.js';

// Initialize game manager
const gameManager = new GameManager();

export default async function checkbingohandler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { roomId, cardId, userId, pattern } = req.body;
  
  if (!roomId || !cardId || !userId || !pattern) {
    return res.status(400).json({ error: 'Missing required parameters' });
  }

  try {
    const result = await gameManager.checkBingo(roomId, cardId, userId, pattern);
    res.json(result);
  } catch (error) {
    console.error('Error checking bingo:', error);
    res.status(500).json({ error: 'Failed to check bingo' });
  }
}
