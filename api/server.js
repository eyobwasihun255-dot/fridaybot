import express from 'express';
import cors from 'cors';
import { rtdb } from '../bot/firebaseConfig.js';
import { ref, get, onValue } from 'firebase/database';
import createSocketServer from './socket-server.js';
import { gameManager } from './game-manager.js';
import botHandler from './bot.js';
import path from 'path';
import { fileURLToPath } from 'url';
import verifyUserHandler from './verifyUser.js';
import startGameHandler from './start-game.js';
import endGameHandler from './end-game.js';
import resetRoomHandler from './reset-room.js';
import checkbingohandler from './check-bingo.js'
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
app.post('/api/reset-room', (req, res) => resetRoomHandler(req, res));
app.post('/api/check-bingo', (req, res) => checkbingohandler(req, res));
// Revenue summary
app.get('/api/revenue', async (req, res) => {
  try {
    const revenueRef = ref(rtdb, 'revenue');
    const snapshot = await get(revenueRef);

    if (!snapshot.exists()) {
      return res.json({ totalByDate: {}, undrawnedTotal: 0, undrawnedDetails: [] });
    }

    const data = snapshot.val();
    const totalByDate = {};
    let undrawnedTotal = 0;
    const undrawnedDetails = [];

    const formatDate = (ts) => new Date(ts).toISOString().split('T')[0];

    Object.values(data).forEach((entry) => {
      if (!entry?.datetime || !entry?.amount) return;
      const dateKey = formatDate(entry.datetime);
      totalByDate[dateKey] = (totalByDate[dateKey] || 0) + entry.amount;
      if (!entry.drawned) {
        undrawnedTotal += entry.amount;
        undrawnedDetails.push(entry);
      }
    });

    res.json({ totalByDate, undrawnedTotal, undrawnedDetails });
  } catch (err) {
    console.error('Error fetching revenue:', err);
    res.status(500).json({ error: 'Failed to fetch revenue' });
  }
});

// Transaction summary
app.get('/api/transaction', async (req, res) => {
  try {
    const formatDate = (ts) => new Date(ts).toISOString().split('T')[0];

    // Users total balance
    const usersSnap = await get(ref(rtdb, 'users'));
    let totalBalance = 0;
    if (usersSnap.exists()) {
      const users = usersSnap.val();
      Object.values(users).forEach((u) => {
        totalBalance += u?.balance || 0;
      });
    }

    // Deposits
    const depositsSnap = await get(ref(rtdb, 'deposits'));
    const depositsByDate = {};
    let totalDeposits = 0;
    if (depositsSnap.exists()) {
      const deposits = depositsSnap.val();
      Object.values(deposits).forEach((dep) => {
        if (!dep?.amount || !dep?.date) return;
        const dateKey = formatDate(dep.date);
        depositsByDate[dateKey] = (depositsByDate[dateKey] || 0) + dep.amount;
        totalDeposits += dep.amount;
      });
    }

    // Withdrawals
    const withdrawalsSnap = await get(ref(rtdb, 'withdrawals'));
    const withdrawalsByDate = {};
    let totalWithdrawals = 0;
    if (withdrawalsSnap.exists()) {
      const withdrawals = withdrawalsSnap.val();
      Object.values(withdrawals).forEach((wd) => {
        if (!wd?.amount || !wd?.date) return;
        const dateKey = formatDate(wd.date);
        withdrawalsByDate[dateKey] = (withdrawalsByDate[dateKey] || 0) + wd.amount;
        totalWithdrawals += wd.amount;
      });
    }

    // Revenue
    const revenueSnap = await get(ref(rtdb, 'revenue'));
    const revenueByDate = {};
    const drawnedByDate = {};
    const undrawnedByDate = {};
    let totalRevenue = 0;
    let totalDrawned = 0;
    let totalUndrawned = 0;
    if (revenueSnap.exists()) {
      const revenues = revenueSnap.val();
      Object.values(revenues).forEach((rev) => {
        if (!rev?.amount || !rev?.datetime) return;
        const dateKey = formatDate(rev.datetime);
        revenueByDate[dateKey] = (revenueByDate[dateKey] || 0) + rev.amount;
        totalRevenue += rev.amount;
        if (rev.drawned) {
          drawnedByDate[dateKey] = (drawnedByDate[dateKey] || 0) + rev.amount;
          totalDrawned += rev.amount;
        } else {
          undrawnedByDate[dateKey] = (undrawnedByDate[dateKey] || 0) + rev.amount;
          totalUndrawned += rev.amount;
        }
      });
    }

    res.json({
      balances: { totalBalance },
      deposits: { totalDeposits, depositsByDate },
      withdrawals: { totalWithdrawals, withdrawalsByDate },
      revenue: {
        totalRevenue,
        revenueByDate,
        totalDrawned,
        drawnedByDate,
        totalUndrawned,
        undrawnedByDate,
      },
    });
  } catch (err) {
    console.error('Error fetching transaction data:', err);
    res.status(500).json({ error: 'Failed to fetch transaction data' });
  }
});

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
        // Call game manager directly to avoid HTTP method issues
        await gameManager.resetRoom(roomId);
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
// Reuse same io instance from socket-server
// Hack: socket-server internally creates and owns io; expose by setting on connection
// We can set it via a small timeout after server starts by attaching to globalThis.io if set there.

// Auto-countdown monitor: if room is waiting, has >=2 players, and no active countdown, start one
const autoCountdownCheck = async () => {
  try {
    const roomsSnap = await get(ref(rtdb, 'rooms'));
    const rooms = roomsSnap.val() || {};
    for (const [roomId, room] of Object.entries(rooms)) {
      // Count players from room.players (those who have placed bets)
      const playersWithBets = Object.values(room.players || {}).filter((p) => {
        if (!p.cardId) return false;
        if (room.isDemoRoom) return true;
        return !!p.betAmount;
      });
      
      // Count auto-bet players from bingoCards (those who claimed cards with auto-bet but haven't bet yet)
      const autoBetPlayers = Object.values(room.bingoCards || {}).filter((card) => {
        if (!card?.claimed || !card?.auto || !card?.claimedBy) return false;
        if (room.isDemoRoom) return true;
        
        // Don't double-count players who are already in room.players
        const alreadyInRoom = room.players?.[card.claimedBy];
        return !alreadyInRoom;
      });
      
      const totalPlayers = playersWithBets.length + autoBetPlayers.length;
      const hasEnough = totalPlayers >= 2;
      const countdownActive = !!room.countdownEndAt && room.countdownEndAt > Date.now();
      const isWaiting = room.gameStatus === 'waiting';
      
      // Enhanced debug logging for rooms with players
      if (totalPlayers > 0) {
        console.log(`🔍 Room ${roomId}: status=${room.gameStatus}, totalPlayers=${totalPlayers} (${playersWithBets.length} with bets, ${autoBetPlayers.length} auto-bet), countdownActive=${countdownActive}, countdownStartedBy=${room.countdownStartedBy}`);
        console.log(`🔍 Room ${roomId} players with bets:`, playersWithBets.map(p => ({
          telegramId: p.telegramId,
          cardId: p.cardId,
          betAmount: p.betAmount,
          username: p.username
        })));
        console.log(`🔍 Room ${roomId} auto-bet players:`, autoBetPlayers.map(card => ({
          cardId: Object.keys(room.bingoCards || {}).find(id => room.bingoCards[id] === card),
          claimedBy: card.claimedBy,
          auto: card.auto,
          autoUntil: card.autoUntil
        })));
      }
      
      // Only start auto-countdown if:
      // 1. Room is waiting
      // 2. Has enough players
      // 3. No active countdown
      if (isWaiting && hasEnough && !countdownActive) {
        console.log(`🔄 Auto-starting countdown for room ${roomId} with ${totalPlayers} players`);
        const result = await gameManager.startCountdown(roomId, 30000, 'auto', room);
        if (!result.success) {
          console.log(`❌ Failed to start auto-countdown for room ${roomId}: ${result.message}`);
        }
      }
      
      // Cancel countdown if players drop below 2, but only if it was started by auto
      if (room.gameStatus === 'countdown' && !hasEnough && room.countdownStartedBy === 'auto') {
        console.log(`❌ Cancelling auto-countdown for room ${roomId} - not enough players`);
        await gameManager.cancelCountdown(roomId);
      }
    }
  } catch (e) {
    console.error('autoCountdownCheck error:', e);
  }
};
setInterval(autoCountdownCheck, 5000);

server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🔌 Socket.IO server ready`);
  console.log(`🎮 Game manager initialized`);
});

export default app;
