import GameManager from './game-manager.js';

// Initialize game manager
const gameManager = new GameManager();

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { roomId, reason = 'manual' } = req.body;
  if (!roomId) {
    return res.status(400).json({ error: 'Missing roomId' });
  }

  try {
    // Get current game ID from room
    const { rtdb } = await import('../bot/firebaseConfig.js');
    const { ref, get } = await import('firebase/database');
    
    const roomRef = ref(rtdb, `rooms/${roomId}`);
    const roomSnap = await get(roomRef);
    const room = roomSnap.val();

    if (!room || !room.gameId) {
      return res.status(400).json({ error: 'No active game found' });
    }

    await gameManager.endGame(roomId, room.gameId, reason);
    
    res.json({ success: true, message: 'Game ended successfully' });
  } catch (error) {
    console.error('Error ending game:', error);
    res.status(500).json({ error: 'Failed to end game' });
  }
}
