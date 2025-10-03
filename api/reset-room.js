import { gameManager } from './game-manager.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { roomId } = req.body;
  if (!roomId) {
    return res.status(400).json({ error: 'Missing roomId' });
  }

  try {
    await gameManager.resetRoom(roomId);
    res.json({ success: true, message: 'Room reset successfully' });
  } catch (error) {
    console.error('Error resetting room:', error);
    res.status(500).json({ error: 'Failed to reset room' });
  }
}
