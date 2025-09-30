const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const { Server } = require('socket.io');
const http = require('http');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Middleware
app.use(cors());
app.use(express.json());

// Initialize Firebase Admin
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DATABASE_URL
});

const db = admin.database();

// Game state management
class GameManager {
  constructor() {
    this.activeGames = new Map(); // roomId -> gameState
    this.gameIntervals = new Map(); // roomId -> intervalId
  }

  async startGame(roomId) {
    try {
      console.log(`🎮 Starting game for room: ${roomId}`);
      
      // Get room data
      const roomRef = db.ref(`rooms/${roomId}`);
      const roomSnapshot = await roomRef.once('value');
      const roomData = roomSnapshot.val();
      
      if (!roomData) {
        throw new Error('Room not found');
      }

      // Check if enough players
      const players = roomData.players || {};
      const activePlayers = Object.values(players).filter(p => 
        roomData.isDemoRoom ? p.cardId : (p.betAmount && p.cardId)
      );

      if (activePlayers.length < 2) {
        throw new Error('Not enough players to start game');
      }

      // Generate game ID
      const gameId = `game_${roomId}_${Date.now()}`;
      
      // Generate random numbers for drawing
      const drawnNumbers = this.generateRandomNumbers();
      const drawIntervalMs = 3000; // 3 seconds between numbers
      const startedAt = Date.now();

      // Create game record
      const gameData = {
        id: gameId,
        roomId,
        drawnNumbers,
        startedAt,
        drawIntervalMs,
        gameStatus: 'playing',
        players: activePlayers,
        winner: null,
        winners: [],
        totalPayout: 0
      };

      // Save game to database
      await db.ref(`games/${gameId}`).set(gameData);

      // Update room status
      await roomRef.update({
        gameStatus: 'playing',
        gameId,
        countdownEndAt: null,
        countdownStartedBy: null
      });

      // Store game state locally
      this.activeGames.set(roomId, gameData);

      // Start number drawing
      this.startNumberDrawing(roomId, gameId, drawnNumbers, drawIntervalMs);

      // Deduct balance for non-demo rooms
      if (!roomData.isDemoRoom) {
        await this.deductPlayerBalances(activePlayers, roomData.betAmount);
      }

      console.log(`✅ Game started successfully for room: ${roomId}`);
      
      // Emit game started event
      io.to(roomId).emit('gameStarted', { gameId, roomId });

      return { success: true, gameId, drawnNumbers: [] };

    } catch (error) {
      console.error(`❌ Error starting game for room ${roomId}:`, error);
      throw error;
    }
  }

  generateRandomNumbers() {
    const numbers = [];
    for (let i = 1; i <= 75; i++) {
      numbers.push(i);
    }
    
    // Fisher-Yates shuffle
    for (let i = numbers.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [numbers[i], numbers[j]] = [numbers[j], numbers[i]];
    }
    
    return numbers;
  }

  startNumberDrawing(roomId, gameId, drawnNumbers, drawIntervalMs) {
    let currentIndex = 0;
    
    const interval = setInterval(async () => {
      if (currentIndex >= drawnNumbers.length) {
        // All numbers drawn, end game
        clearInterval(interval);
        this.gameIntervals.delete(roomId);
        await this.endGame(roomId, 'completed');
        return;
      }

      const currentNumber = drawnNumbers[currentIndex];
      currentIndex++;

      // Update game with current drawn numbers
      await db.ref(`games/${gameId}`).update({
        currentDrawnNumbers: drawnNumbers.slice(0, currentIndex),
        lastDrawnNumber: currentNumber,
        lastDrawnAt: Date.now()
      });

      // Emit number drawn event
      io.to(roomId).emit('numberDrawn', {
        number: currentNumber,
        drawnNumbers: drawnNumbers.slice(0, currentIndex),
        totalNumbers: drawnNumbers.length,
        currentIndex
      });

      console.log(`🎲 Room ${roomId}: Drew number ${currentNumber} (${currentIndex}/${drawnNumbers.length})`);

    }, drawIntervalMs);

    this.gameIntervals.set(roomId, interval);
  }

  async deductPlayerBalances(players, betAmount) {
    const updates = {};
    
    for (const player of players) {
      if (player.telegramId) {
        // Get current balance
        const userRef = db.ref(`users/${player.telegramId}`);
        const userSnapshot = await userRef.once('value');
        const userData = userSnapshot.val();
        
        if (userData && userData.balance >= betAmount) {
          updates[`users/${player.telegramId}/balance`] = userData.balance - betAmount;
        }
      }
    }

    if (Object.keys(updates).length > 0) {
      await db.ref().update(updates);
    }
  }

  async checkBingo(roomId, cardId, userId, pattern) {
    try {
      console.log(`🎯 Checking bingo for room: ${roomId}, card: ${cardId}, user: ${userId}`);

      const gameState = this.activeGames.get(roomId);
      if (!gameState || gameState.gameStatus !== 'playing') {
        return { success: false, message: 'Game not active' };
      }

      // Get card data
      const cardRef = db.ref(`rooms/${roomId}/bingoCards/${cardId}`);
      const cardSnapshot = await cardRef.once('value');
      const cardData = cardSnapshot.val();

      if (!cardData || cardData.claimedBy !== userId) {
        return { success: false, message: 'Invalid card or not owned by user' };
      }

      // Get current drawn numbers
      const gameRef = db.ref(`games/${gameState.id}`);
      const gameSnapshot = await gameRef.once('value');
      const gameData = gameSnapshot.val();
      const drawnNumbers = gameData.currentDrawnNumbers || [];

      // Validate bingo pattern
      const isValidBingo = this.validateBingoPattern(cardData.numbers, pattern, drawnNumbers);

      if (!isValidBingo) {
        // Mark player as attempted bingo (disqualified)
        await db.ref(`rooms/${roomId}/players/${userId}`).update({
          attemptedBingo: true,
          disqualified: true
        });
        
        return { success: false, message: 'Invalid bingo pattern' };
      }

      // Valid bingo! End the game
      await this.endGameWithWinner(roomId, userId, cardId, pattern, drawnNumbers);
      
      return { success: true, message: 'Bingo! You won!' };

    } catch (error) {
      console.error(`❌ Error checking bingo:`, error);
      return { success: false, message: 'Error checking bingo' };
    }
  }

  validateBingoPattern(cardNumbers, pattern, drawnNumbers) {
    const drawnSet = new Set(drawnNumbers);
    const flatCard = cardNumbers.flat();

    // Check if all numbers in the pattern are either drawn or free space (center)
    return pattern.every(index => {
      const number = flatCard[index];
      return number === 0 || drawnSet.has(number); // 0 represents free space
    });
  }

  async endGameWithWinner(roomId, winnerId, cardId, winningPattern, drawnNumbers) {
    try {
      console.log(`🏆 Ending game with winner for room: ${roomId}`);

      // Stop number drawing
      const interval = this.gameIntervals.get(roomId);
      if (interval) {
        clearInterval(interval);
        this.gameIntervals.delete(roomId);
      }

      // Get room data for payout calculation
      const roomRef = db.ref(`rooms/${roomId}`);
      const roomSnapshot = await roomRef.once('value');
      const roomData = roomSnapshot.val();

      const players = roomData.players || {};
      const activePlayers = Object.values(players).filter(p => 
        roomData.isDemoRoom ? p.cardId : (p.betAmount && p.cardId)
      );

      const totalPayout = roomData.isDemoRoom ? 0 : activePlayers.length * roomData.betAmount;

      // Update game with winner
      const gameState = this.activeGames.get(roomId);
      if (gameState) {
        await db.ref(`games/${gameState.id}`).update({
          gameStatus: 'ended',
          winner: {
            winnerId,
            cardId,
            winningPattern,
            drawnNumbers: drawnNumbers.length
          },
          winners: [{
            userId: winnerId,
            cardId,
            payout: totalPayout
          }],
          totalPayout,
          endedAt: Date.now()
        });
      }

      // Update room status
      await roomRef.update({
        gameStatus: 'ended',
        winner: winnerId,
        payout: totalPayout,
        payed: true
      });

      // Award payout to winner (non-demo rooms)
      if (!roomData.isDemoRoom && totalPayout > 0) {
        const userRef = db.ref(`users/${winnerId}`);
        const userSnapshot = await userRef.once('value');
        const userData = userSnapshot.val();
        
        if (userData) {
          await userRef.update({
            balance: (userData.balance || 0) + totalPayout
          });
        }
      }

      // Emit game ended event
      io.to(roomId).emit('gameEnded', {
        winner: winnerId,
        cardId,
        winningPattern,
        totalPayout
      });

      // Schedule room reset
      setTimeout(() => {
        this.resetRoom(roomId);
      }, 30000); // 30 seconds cooldown

      console.log(`✅ Game ended with winner for room: ${roomId}`);

    } catch (error) {
      console.error(`❌ Error ending game with winner:`, error);
    }
  }

  async endGame(roomId, reason = 'completed') {
    try {
      console.log(`🔚 Ending game for room: ${roomId}, reason: ${reason}`);

      // Stop number drawing
      const interval = this.gameIntervals.get(roomId);
      if (interval) {
        clearInterval(interval);
        this.gameIntervals.delete(roomId);
      }

      // Update game status
      const gameState = this.activeGames.get(roomId);
      if (gameState) {
        await db.ref(`games/${gameState.id}`).update({
          gameStatus: 'ended',
          endedAt: Date.now(),
          endReason: reason
        });
      }

      // Update room status
      const roomRef = db.ref(`rooms/${roomId}`);
      await roomRef.update({
        gameStatus: 'ended',
        nextGameCountdownEndAt: Date.now() + 30000 // 30 seconds cooldown
      });

      // Emit game ended event
      io.to(roomId).emit('gameEnded', { reason });

      // Schedule room reset
      setTimeout(() => {
        this.resetRoom(roomId);
      }, 30000);

      console.log(`✅ Game ended for room: ${roomId}`);

    } catch (error) {
      console.error(`❌ Error ending game:`, error);
    }
  }

  async resetRoom(roomId) {
    try {
      console.log(`♻️ Resetting room: ${roomId}`);

      const roomRef = db.ref(`rooms/${roomId}`);
      const roomSnapshot = await roomRef.once('value');
      const roomData = roomSnapshot.val();

      if (!roomData) return;

      // Reset cards and players
      await this.resetAllCardsAndPlayers(roomId, roomData.betAmount, roomData.isDemoRoom);

      // Reset room state
      await roomRef.update({
        gameStatus: 'waiting',
        winner: null,
        calledNumbers: [],
        gameId: null,
        payed: false,
        winners: null,
        payout: null,
        countdownEndAt: null,
        countdownStartedBy: null,
        nextGameCountdownEndAt: null
      });

      // Clean up local state
      this.activeGames.delete(roomId);

      // Emit room reset event
      io.to(roomId).emit('roomReset');

      console.log(`✅ Room reset completed: ${roomId}`);

    } catch (error) {
      console.error(`❌ Error resetting room:`, error);
    }
  }

  async resetAllCardsAndPlayers(roomId, betAmount, isDemoRoom) {
    try {
      const cardsRef = db.ref(`rooms/${roomId}/bingoCards`);
      const playersRef = db.ref(`rooms/${roomId}/players`);

      const cardsSnapshot = await cardsRef.once('value');
      const autoCardsByPlayer = {};
      const cardUpdates = {};

      if (cardsSnapshot.exists()) {
        const cardsData = cardsSnapshot.val();
        
        for (const cardKey in cardsData) {
          const cardData = cardsData[cardKey];
          
          if (cardData.auto && !isDemoRoom) {
            const userId = cardData.claimedBy;
            const userSnapshot = await db.ref(`users/${userId}`).once('value');
            const userBalance = userSnapshot.val()?.balance || 0;

            if (userBalance >= betAmount) {
              // Keep auto card
              autoCardsByPlayer[userId] = true;
            } else {
              // Reset card due to insufficient balance
              cardUpdates[`rooms/${roomId}/bingoCards/${cardKey}`] = {
                ...cardData,
                claimed: false,
                claimedBy: null,
                auto: false,
                autoUntil: null
              };
            }
          } else {
            // Reset non-auto cards
            cardUpdates[`rooms/${roomId}/bingoCards/${cardKey}`] = {
              ...cardData,
              claimed: false,
              claimedBy: null
            };
          }
        }

        if (Object.keys(cardUpdates).length > 0) {
          await db.ref().update(cardUpdates);
        }
      }

      // Reset players
      const playersSnapshot = await playersRef.once('value');
      if (playersSnapshot.exists()) {
        const playerUpdates = {};

        playersSnapshot.forEach((playerSnapshot) => {
          const playerId = playerSnapshot.key;
          
          if (autoCardsByPlayer[playerId]) {
            // Reset attemptedBingo for auto players
            playerUpdates[`rooms/${roomId}/players/${playerId}/attemptedBingo`] = false;
            playerUpdates[`rooms/${roomId}/players/${playerId}/disqualified`] = false;
          } else {
            // Remove players without valid auto cards
            playerUpdates[`rooms/${roomId}/players/${playerId}`] = null;
          }
        });

        if (Object.keys(playerUpdates).length > 0) {
          await db.ref().update(playerUpdates);
        }
      }

    } catch (error) {
      console.error(`❌ Error resetting cards and players:`, error);
    }
  }

  async checkGameCountdowns() {
    try {
      const roomsSnapshot = await db.ref('rooms').once('value');
      const rooms = roomsSnapshot.val() || {};

      for (const roomId in rooms) {
        const room = rooms[roomId];
        
        // Check if countdown has ended and should start game
        if (room.gameStatus === 'countdown' && 
            room.countdownEndAt && 
            Date.now() >= room.countdownEndAt) {
          
          const players = room.players || {};
          const activePlayers = Object.values(players).filter(p => 
            room.isDemoRoom ? p.cardId : (p.betAmount && p.cardId)
          );

          if (activePlayers.length >= 2) {
            await this.startGame(roomId);
          } else {
            // Cancel countdown if not enough players
            await db.ref(`rooms/${roomId}`).update({
              gameStatus: 'waiting',
              countdownEndAt: null,
              countdownStartedBy: null
            });
          }
        }
      }
    } catch (error) {
      console.error('❌ Error checking game countdowns:', error);
    }
  }
}

// Initialize game manager
const gameManager = new GameManager();

// Check countdowns every second
setInterval(() => {
  gameManager.checkGameCountdowns();
}, 1000);

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('👤 User connected:', socket.id);

  socket.on('joinRoom', (roomId) => {
    socket.join(roomId);
    console.log(`👤 User ${socket.id} joined room: ${roomId}`);
  });

  socket.on('leaveRoom', (roomId) => {
    socket.leave(roomId);
    console.log(`👤 User ${socket.id} left room: ${roomId}`);
  });

  socket.on('disconnect', () => {
    console.log('👤 User disconnected:', socket.id);
  });
});

// API Routes
app.post('/api/start-game', async (req, res) => {
  try {
    const { roomId } = req.body;
    
    if (!roomId) {
      return res.status(400).json({ error: 'Room ID is required' });
    }

    const result = await gameManager.startGame(roomId);
    res.json(result);
  } catch (error) {
    console.error('❌ Error in start-game API:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/check-bingo', async (req, res) => {
  try {
    const { roomId, cardId, userId, pattern } = req.body;
    
    if (!roomId || !cardId || !userId || !pattern) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    const result = await gameManager.checkBingo(roomId, cardId, userId, pattern);
    res.json(result);
  } catch (error) {
    console.error('❌ Error in check-bingo API:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/end-game', async (req, res) => {
  try {
    const { roomId, reason } = req.body;
    
    if (!roomId) {
      return res.status(400).json({ error: 'Room ID is required' });
    }

    await gameManager.endGame(roomId, reason);
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Error in end-game API:', error);
    res.status(500).json({ error: error.message });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Start server
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`🚀 Bingo server running on port ${PORT}`);
});

module.exports = { app, gameManager };
