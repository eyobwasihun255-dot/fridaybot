import express from 'express';
import cors from 'cors';
import { rtdb } from '../bot/firebaseConfig.js';
import { ref, get, onValue } from 'firebase/database';
import createSocketServer from './socket-server.js';
import botHandler from './bot.js';
import path from 'path';
import { fileURLToPath } from 'url';
import verifyUserHandler from './verifyUser.js';
import startGameHandler from './start-game.js';
import endGameHandler from './end-game.js';
import checkBingoHandler from './check-bingo.js';
import resetRoomHandler from './reset-room.js';

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'Server running', timestamp: new Date().toISOString() });
});

// Telegram webhook endpoint
app.all('/api/bot', (req, res) => botHandler(req, res));

// API routes
app.get('/api/verifyUser', (req, res) => verifyUserHandler(req, res));
app.post('/api/start-game', (req, res) => startGameHandler(req, res));
app.post('/api/end-game', (req, res) => endGameHandler(req, res));
app.post('/api/check-bingo', (req, res) => checkBingoHandler(req, res));
app.post('/api/reset-room', (req, res) => resetRoomHandler(req, res));

// Serve frontend (Vite build in /dist)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distPath = path.resolve(__dirname, '../dist');

app.use(express.static(distPath));

// Fallback to index.html for client-side routing (exclude /api/*)
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.sendFile(path.join(distPath, 'index.html'));
});

// Auto-start games when countdown ends
const startGameIfCountdownEnded = async () => {
  try {
    const roomsRef = ref(rtdb, 'rooms');
    const roomsSnap = await get(roomsRef);
    const rooms = roomsSnap.val() || {};

    for (const [roomId, room] of Object.entries(rooms)) {
      if (room.gameStatus === 'countdown' && 
          room.countdownEndAt && 
          room.countdownEndAt <= Date.now()) {
        
        console.log(`⏰ Auto-starting game for room ${roomId}`);
        
        // Import and call start-game handler
        const { default: startGameHandler } = await import('./start-game.js');
        const mockReq = { body: { roomId } };
        const mockRes = {
          status: (code) => ({ json: (data) => console.log(`Game start result:`, data) }),
          json: (data) => console.log(`Game start result:`, data)
        };
        
        await startGameHandler(mockReq, mockRes);
      }
    }
  } catch (error) {
    console.error('Error in auto-start check:', error);
  }
};

// Check for countdowns every 5 seconds
setInterval(startGameIfCountdownEnded, 5000);

// Auto-reset rooms after game ends
const resetRoomIfGameEnded = async () => {
  try {
    const roomsRef = ref(rtdb, 'rooms');
    const roomsSnap = await get(roomsRef);
    const rooms = roomsSnap.val() || {};

    for (const [roomId, room] of Object.entries(rooms)) {
      if (room.gameStatus === 'ended' && 
          room.nextGameCountdownEndAt && 
          room.nextGameCountdownEndAt <= Date.now()) {
        
        console.log(`♻️ Auto-resetting room ${roomId}`);
        
        // Import and call reset-room handler
        const { default: resetRoomHandler } = await import('./reset-room.js');
        const mockReq = { body: { roomId } };
        const mockRes = {
          status: (code) => ({ json: (data) => console.log(`Room reset result:`, data) }),
          json: (data) => console.log(`Room reset result:`, data)
        };
        
        await resetRoomHandler(mockReq, mockRes);
      }
    }
  } catch (error) {
    console.error('Error in auto-reset check:', error);
  }
};

// Check for room resets every 5 seconds
setInterval(resetRoomIfGameEnded, 5000);

// Create Socket.IO server
const server = createSocketServer(app);

server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🔌 Socket.IO server ready`);
  console.log(`🎮 Game manager initialized`);
});

export default app;
