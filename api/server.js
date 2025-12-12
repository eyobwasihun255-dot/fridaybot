import express from 'express';
import cors from 'cors';
import { rtdb } from '../bot/firebaseConfig.js';
import { ref, get } from 'firebase/database';
import createSocketServer from './socket-server.js';
import { gameManager } from './game-manager.js';
import botHandler from './bot.js';
import path from 'path';
import { fileURLToPath } from 'url';
import verifyUserHandler from './verifyUser.js';
import startGameHandler from './start-game.js';
import endGameHandler from './end-game.js';
import resetRoomHandler from './reset-room.js';
import checkbingohandler from './check-bingo.js';
import placeBetHandler from './place-bet.js';
import cancelBetHandler from './cancel-bet.js';
import roomStateHandler from './room-state.js';
import playerHandler from './player.js';
import roomsHandler from './rooms.js';
import cardHandler from './card.js';
import toggleAutoHandler from './toggle-auto.js';
const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'Server running', timestamp: new Date().toISOString() });
});

// Telegram webhook endpoint
app.all('/api/bot', async (req, res) => {
  try {
    await botHandler(req, res);
  } catch (err) {
    console.error('❌ Error in bot handler:', err);
    if (!res.headersSent) {
      res.status(500).json({ ok: false, error: 'Internal server error' });
    }
  }
});

// Webhook status endpoint (for debugging)
app.get('/api/bot/status', async (req, res) => {
  try {
    const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    if (!TOKEN) {
      return res.status(500).json({ error: 'TELEGRAM_BOT_TOKEN not set' });
    }
    
    const response = await fetch(`https://api.telegram.org/bot${TOKEN}/getWebhookInfo`);
    const data = await response.json();
    
    res.json({
      webhookInfo: data,
      mode: process.env.BOT_POLLING === "true" ? "polling" : "webhook",
      nodeEnv: process.env.NODE_ENV,
      webappUrl: process.env.WEBAPP_URL || 'not set',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API routes
app.get('/api/verifyUser', (req, res) => verifyUserHandler(req, res));
app.post('/api/start-game', (req, res) => startGameHandler(req, res));
app.post('/api/end-game', (req, res) => endGameHandler(req, res));
app.post('/api/reset-room', (req, res) => resetRoomHandler(req, res));
app.post('/api/check-bingo', (req, res) => checkbingohandler(req, res));
app.post('/api/player', (req, res) => playerHandler(req, res));
app.get('/api/rooms', (req, res) => roomsHandler(req, res));
app.get('/api/card', (req, res) => cardHandler(req, res));
app.post('/api/toggle-auto', (req, res) => toggleAutoHandler(req, res));
app.post('/api/place-bet', (req, res) => placeBetHandler(req, res));
app.post('/api/cancel-bet', (req, res) => cancelBetHandler(req, res));
app.get('/api/room-state', (req, res) => roomStateHandler(req, res));
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



// Create Socket.IO server
const server = createSocketServer(app);
// Reuse same io instance from socket-server
// Hack: socket-server internally creates and owns io; expose by setting on connection
// We can set it via a small timeout after server starts by attaching to globalThis.io if set there.

// Optimized auto-countdown monitor with caching and batch operations
let roomCache = new Map();
let lastCacheUpdate = 0;
const CACHE_TTL = 5000; // 5 seconds cache

const autoCountdownCheck = async () => {
  try {
    const now = Date.now();
    
    // Use cache if still valid, otherwise refresh
    if (now - lastCacheUpdate > CACHE_TTL) {
      const roomsSnap = await get(ref(rtdb, "rooms"));
      const rooms = roomsSnap.val() || {};
      
      // Update cache with base RTDB config only; runtime state comes from Redis.
      roomCache.clear();
      Object.entries(rooms).forEach(([roomId, room]) => {
        roomCache.set(roomId, {
          ...room,
          lastChecked: now,
        });
      });
      lastCacheUpdate = now;
    }

    // Process rooms in parallel batches
    const roomEntries = Array.from(roomCache.entries());
    const batchSize = 5;
    
    for (let i = 0; i < roomEntries.length; i += batchSize) {
      const batch = roomEntries.slice(i, i + batchSize);
      await Promise.allSettled(
        batch.map(async ([roomId, room]) => {
          try {
            await processRoomCountdown(roomId, room, now);
          } catch (error) {
            console.error(`❌ Error processing room ${roomId}:`, error);
          }
        })
      );
    }
  } catch (error) {
    console.error("⚠️ autoCountdownCheck error:", error);
  }
};

const processRoomCountdown = async (roomId, roomFromCache, now) => {
  try {
    // 1) Load state from Redis via GameManager
    let roomState = await gameManager.getRoomState(roomId);

    // Fallback to RTDB base config
    if (!roomState) {
      roomState = { ...roomFromCache, players: {} };
    }

    // 2) Get players (Redis → RTDB fallback)
    let players = roomState.players || {};

    if (!players || Object.keys(players).length === 0) {
      const snap = await get(ref(rtdb, `rooms/${roomId}/players`));
      players = snap.val() || {};
    }

    const playerList = Object.keys(players);
    const playerCount = playerList.length;

    // ❌ REMOVED:
    // - countdown stale auto-reset
    // - ended stale auto-reset

    // Do nothing if already in countdown, ended, or playing
    if (
      roomState.roomStatus === "countdown" ||
      roomState.roomStatus === "ended" ||
      roomState.roomStatus === "playing"
    ) {
      return;
    }

    // 4) Not enough players → do nothing
    if (playerCount < 2) return;
    if(roomState.roomStatus === "waiting"){
    // 5) START official countdown through GameManager
    console.log(`🚀 Triggering GameManager countdown for room ${roomId}`);

    await gameManager.startCountdown(
      roomId,
      playerList,
      30000,  // countdown duration
      "auto"
    );}
  } catch (err) {
    console.error(`❌ processRoomCountdown error for room ${roomId}:`, err);
  }
};



// 🔁 Run optimized loop every 3 seconds
setInterval(autoCountdownCheck, 3000);


server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🔌 Socket.IO server ready`);
  console.log(`🎮 Game manager initialized`);
});

export default app;
