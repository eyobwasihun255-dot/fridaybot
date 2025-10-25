import { rtdb } from "../bot/firebaseConfig.js";
import { ref, get, set, update, runTransaction, onValue } from "firebase/database";
import { platform } from "os";
import { v4 as uuidv4 } from "uuid";

class OptimizedGameManager {
  constructor() {
    this.activeGames = new Map();
    this.numberDrawIntervals = new Map(); // roomId -> interval ID
    this.countdownTimers = new Map(); // roomId -> timeout ID
    this.resetRoomTimers = new Map(); // roomId -> timeout ID for scheduled reset
    this.lastWinnerUserByRoom = new Map(); // roomId -> userId
    this.io = null; // Will be set when Socket.IO is initialized
    
    // Performance optimizations
    this.roomCache = new Map();
    this.lastCacheUpdate = 0;
    this.CACHE_TTL = 5000; // 5 seconds cache
    this.batchSize = 5;
  }

  // Singleton pattern
  static getInstance() {
    if (!OptimizedGameManager.instance) {
      OptimizedGameManager.instance = new OptimizedGameManager();
    }
    return OptimizedGameManager.instance;
  }

  setSocketIO(io) {
    this.io = io;
  }

  // Optimized countdown start with better error handling
  async startCountdown(room, roomId, players, durationMs = 28000, startedBy = "auto") {
    try {
      console.log(`🎮 Room ${roomId} snapshot received for countdown`);
  
      // Basic validations
      if (room.gameStatus === "countdown") {
        console.log(`⚠️ Countdown already active for room ${roomId}`);
        return { success: false, message: "Countdown already active" };
      }
      if (players.length < 2) {
        console.log(`❌ Not enough players for room ${roomId}: ${players.length}`);
        return { success: false, message: "Not enough players" };
      }
      if (room.gameStatus !== "waiting") {
        console.log(`⚠️ Room ${roomId} not in waiting state: ${room.gameStatus}`);
        return { success: false, message: "Room not in waiting state" };
      }
  
      const countdownEndAt = Date.now() + durationMs;
      const roomRef = ref(rtdb, `rooms/${roomId}`);
  
      // Start countdown in Firebase
      await update(roomRef, {
        gameStatus: "countdown",
        countdownEndAt,
        countdownStartedBy: startedBy,
      });
      console.log(`⏳ Countdown started for room ${roomId} (${durationMs / 1000}s)`);
  
      // Start countdown timer to auto-start game
      if (this.countdownTimers.has(roomId)) clearTimeout(this.countdownTimers.get(roomId));
      const tid = setTimeout(async () => {
        try {
          const snap = await get(roomRef);
          const latest = snap.val();
          if (latest?.gameStatus === "countdown") {
            console.log(`🎮 Countdown ended → starting game for room ${roomId}`);
            await this.startGame(roomId, latest);
          } else {
            console.log(`⚠️ Skipping startGame for room ${roomId}, state changed to ${latest?.gameStatus}`);
          }
        } catch (err) {
          console.error(`❌ Auto startGame error for room ${roomId}:`, err);
        } finally {
          this.countdownTimers.delete(roomId);
        }
      }, durationMs);
      this.countdownTimers.set(roomId, tid);
  
      if (this.io) this.io.to(roomId).emit("countdownStarted", { roomId, countdownEndAt });
  
      // Start demo reshuffle asynchronously (non-blocking)
      this.distributeDemoBalances(roomId).catch(error => {
        console.error(`❌ Error distributing demo balances for room ${roomId}:`, error);
      });
  
      return { success: true, countdownEndAt };
    } catch (error) {
      console.error("Error starting countdown:", error);
      return { success: false, message: error.message };
    }
  }

  // Optimized game start with parallel operations
  async startGame(roomId, room) {
    const startTime = Date.now();
    try {
      console.log(`🎮 Starting game for room ${roomId}`);
      
      const roomRef = ref(rtdb, `rooms/${roomId}`);
      const roomSnap = await get(roomRef);
      const liveRoom = roomSnap.val();
      
      if (!liveRoom || liveRoom.gameStatus !== "countdown") {
        throw new Error("Room not in countdown state");
      }

      const gameId = uuidv4();
      const playerIds = Object.keys(room.players || {}).filter(pid => {
        const player = room.players[pid];
        return player && player.cardId && room.bingoCards[player.cardId];
      });
      
      if (playerIds.length < 2) {
        console.log(`❌ Not enough valid players to start game in ${roomId}`);
        await update(roomRef, { gameStatus: "waiting" });
        return { success: false, message: "Not enough players" };
      }
      
      // Generate drawn numbers and determine winners
      const cards = playerIds.map(pid => room.bingoCards[room.players[pid].cardId]);
      
      // Validate cards exist
      const invalidCards = cards.filter(card => !card);
      if (invalidCards.length > 0) {
        console.error(`❌ Invalid cards found for room ${roomId}`);
        throw new Error("Invalid cards detected");
      }

      const { drawnNumbers, winners } = this.generateDrawnNumbersMultiWinner(roomId, cards);

      // Safety check: ensure drawnNumbers is always an array
      if (!Array.isArray(drawnNumbers)) {
        console.error(`❌ generateDrawnNumbersMultiWinner returned invalid drawnNumbers:`, drawnNumbers);
        throw new Error("Failed to generate valid drawn numbers");
      }

      const gameData = {
        id: gameId,
        roomId,
        drawnNumbers,
        currentDrawnNumbers: [],
        currentNumberIndex: 0,
        createdAt: Date.now(),
        startedAt: Date.now(),
        drawIntervalMs: 5000,
        status: "active",
        totalPayout: Math.floor((playerIds.length - 1) * (room.betAmount || 0) * 0.85 + (room.betAmount || 0)),
        betsDeducted: false,
        winners: winners.map(cardId => ({
          id: uuidv4(),
          cardId,
          userId: room.bingoCards[cardId]?.claimedBy,
          username: room.players[room.bingoCards[cardId]?.claimedBy]?.username || "Unknown",
          checked: false
        })),
        gameStatus: "playing"
      };

      // Parallel operations: Update room status and save game data
      const [roomUpdateResult] = await Promise.allSettled([
        runTransaction(roomRef, (currentRoom) => {
          if (!currentRoom || currentRoom.gameStatus !== "countdown") return currentRoom;
          
          currentRoom.gameStatus = "playing";
          currentRoom.gameId = gameId;
          currentRoom.calledNumbers = [];
          currentRoom.countdownEndAt = null;
          currentRoom.countdownStartedBy = null;
          currentRoom.currentWinner = null;
          currentRoom.payed = false;
          
          return currentRoom;
        }),
        set(ref(rtdb, `games/${gameId}`), gameData)
      ]);

      // Check if room update succeeded
      if (roomUpdateResult.status === 'rejected') {
        throw new Error(`Failed to update room status: ${roomUpdateResult.reason}`);
      }

      // Start number drawing immediately (non-blocking)
      this.startNumberDrawing(roomId, gameId, room);

      // Deduct bets asynchronously (non-blocking)
      this.deductBets(roomId, gameData).catch(error => {
        console.error(`❌ Error deducting bets for room ${roomId}:`, error);
      });

      // Notify clients
      if (this.io) {
        this.io.to(roomId).emit('gameStarted', { roomId, gameId });
      }

      const duration = Date.now() - startTime;
      console.log(`✅ Game started for room ${roomId} in ${duration}ms`);

      return { success: true, gameId, drawnNumbers, winners: gameData.winners };
    } catch (error) {
      console.error("Error starting game:", error);
      throw error;
    }
  }

  // Optimized number drawing with better error handling
  startNumberDrawing(roomId, gameId, room) {
    const gameRef = ref(rtdb, `games/${gameId}`);
    
    if (this.numberDrawIntervals.has(roomId)) {
      clearInterval(this.numberDrawIntervals.get(roomId));
    }
    
    const drawInterval = setInterval(async () => {
      try {
        const gameSnap = await get(gameRef);
        const gameData = gameSnap.val();

        if (!gameData || gameData.status !== "active") {
          this.stopNumberDrawing(roomId);
          return;
        }

        const { drawnNumbers, currentNumberIndex } = gameData;
        
        // Safety check for drawnNumbers
        if (!drawnNumbers || !Array.isArray(drawnNumbers)) {
          console.error(`❌ Invalid drawnNumbers for game ${gameId}:`, drawnNumbers);
          this.stopNumberDrawing(roomId);
          return;
        }
        
        // Safety check for currentNumberIndex
        if (typeof currentNumberIndex !== 'number' || currentNumberIndex < 0) {
          console.error(`❌ Invalid currentNumberIndex for game ${gameId}:`, currentNumberIndex);
          this.stopNumberDrawing(roomId);
          return;
        }
        
        if (currentNumberIndex >= drawnNumbers.length) {
          // All numbers drawn, end game
          this.endGame(roomId, gameId, "allNumbersDrawn");
          return;
        }

        const currentNumber = drawnNumbers[currentNumberIndex];
        const newDrawnNumbers = drawnNumbers.slice(0, currentNumberIndex + 1);

        // Update game data
        await update(gameRef, {
          currentNumberIndex: currentNumberIndex + 1,
          currentDrawnNumbers: newDrawnNumbers,
          lastDrawnNumber: currentNumber,
          lastDrawnAt: Date.now()
        });

        // Notify clients
        if (this.io) {
          this.io.to(roomId).emit('numberDrawn', {
            roomId,
            gameId,
            number: currentNumber,
            drawnNumbers: newDrawnNumbers,
            currentIndex: currentNumberIndex + 1
          });
        }

        console.log(`🎲 Room ${roomId}: Drew number ${currentNumber} (${currentNumberIndex + 1}/${drawnNumbers.length})`);
      } catch (error) {
        console.error("Error in number drawing:", error);
        this.stopNumberDrawing(roomId);
      }
    }, gameData?.drawIntervalMs || 5000);

    this.numberDrawIntervals.set(roomId, drawInterval);
  }

  // Optimized game end with parallel operations
  async endGame(roomId, gameId, reason = "manual") {
    const startTime = Date.now();
    try {
      console.log(`🔚 Ending game for room ${roomId}: ${reason}`);
      
      // Stop drawing numbers for this room
      this.stopNumberDrawing(roomId);
      
      // Clear any countdown timer for this room
      if (this.countdownTimers.has(roomId)) {
        clearTimeout(this.countdownTimers.get(roomId));
        this.countdownTimers.delete(roomId);
      }

      const roomRef = ref(rtdb, `rooms/${roomId}`);
      const gameRef = ref(rtdb, `games/${gameId}`);
      const nextGameCountdownMs = 10000; // 10s until reset
      const nextGameCountdownEndAt = Date.now() + nextGameCountdownMs;

      // Parallel operations: Get game data and distribute demo balances
      const [gameSnap] = await Promise.allSettled([
        get(gameRef),
        this.distributeDemoBalances(roomId)
      ]);

      const gameData = gameSnap.status === 'fulfilled' ? gameSnap.value.val() : null;
      if (!gameData) {
        console.error(`❌ Game data not found for ${gameId}`);
        return;
      }

      // Update game and room status in parallel
      await Promise.allSettled([
        update(gameRef, {
          status: "ended",
          endedAt: Date.now(),
          endReason: reason,
        }),
        update(roomRef, {
          gameStatus: "ended",
          nextGameCountdownEndAt,
          countdownEndAt: null,
          countdownStartedBy: null,
        })
      ]);

      // Process winners and payouts
      if (gameData.winners && gameData.winners.length > 0) {
        this.processWinners(roomId, gameData).catch(error => {
          console.error(`❌ Error processing winners for room ${roomId}:`, error);
        });
      }

      // Schedule room reset
      if (this.resetRoomTimers.has(roomId)) {
        clearTimeout(this.resetRoomTimers.get(roomId));
      }
      const rid = setTimeout(async () => {
        try {
          await this.resetRoom(roomId);
        } catch (e) {
          console.error('Error in scheduled resetRoom:', e);
        } finally {
          this.resetRoomTimers.delete(roomId);
        }
      }, nextGameCountdownMs);
      this.resetRoomTimers.set(roomId, rid);

      // Notify clients
      if (this.io) {
        this.io.to(roomId).emit('gameEnded', {
          roomId,
          gameId,
          reason,
          winners: gameData.winners || [],
          nextGameCountdownEndAt,
        });
      }

      const duration = Date.now() - startTime;
      console.log(`✅ Game ended for room ${roomId} in ${duration}ms: ${reason}`);
    } catch (error) {
      console.error("Error ending game:", error);
    }
  }

  // Optimized room reset with batch operations
  async resetRoom(roomId) {
    const startTime = Date.now();
    try {
      console.log(`♻️ Resetting room ${roomId}`);
      
      const roomRef = ref(rtdb, `rooms/${roomId}`);
      const roomSnap = await get(roomRef);
      const room = roomSnap.val();

      if (!room) {
        console.error(`❌ Room ${roomId} not found`);
        return;
      }

      // Get users data in parallel
      const [usersSnap] = await Promise.allSettled([
        get(ref(rtdb, "users"))
      ]);

      const users = usersSnap.status === 'fulfilled' ? usersSnap.value.val() || {} : {};

      // Filter players to keep (those with auto-bet and sufficient balance)
      const keepPlayers = new Set();
      const betAmount = room.betAmount || 0;

      Object.entries(room.players || {}).forEach(([pid, player]) => {
        if (!player.cardId || !room.bingoCards?.[player.cardId]) return;
        
        const card = room.bingoCards[player.cardId];
        const user = users[player.telegramId];
        
        if (card.auto && user && (user.balance || 0) >= betAmount) {
          keepPlayers.add(pid);
        }
      });

      // Batch update operations
      const updates = {
        gameStatus: "waiting",
        gameId: null,
        calledNumbers: [],
        currentWinner: null,
        payed: false,
        nextGameCountdownEndAt: null,
        countdownEndAt: null,
        countdownStartedBy: null,
        winner: null,
        payout: 0
      };

      // Reset attemptedBingo for remaining players
      keepPlayers.forEach(pid => {
        updates[`players/${pid}/attemptedBingo`] = false;
      });

      await update(roomRef, updates);

      // Notify clients
      if (this.io) {
        this.io.to(roomId).emit("roomReset", { roomId });
      }

      const duration = Date.now() - startTime;
      console.log(`✅ Room ${roomId} reset in ${duration}ms (kept ${keepPlayers.size} players)`);
    } catch (error) {
      console.error("Error resetting room:", error);
    }
  }

  // Utility methods (keeping existing implementations)
  stopNumberDrawing(roomId) {
    if (this.numberDrawIntervals.has(roomId)) {
      clearInterval(this.numberDrawIntervals.get(roomId));
      this.numberDrawIntervals.delete(roomId);
      console.log(`🛑 Stopped number drawing for room ${roomId}`);
    }
  }

  async cancelCountdown(roomId) {
    try {
      if (this.countdownTimers.has(roomId)) {
        clearTimeout(this.countdownTimers.get(roomId));
        this.countdownTimers.delete(roomId);
      }
      const roomRef = ref(rtdb, `rooms/${roomId}`);
      await update(roomRef, {
        gameStatus: 'waiting',
        countdownEndAt: null,
        countdownStartedBy: null,
      });
      if (this.io) this.io.to(roomId).emit('countdownCancelled', { roomId });
      return { success: true };
    } catch (err) {
      console.error('Error cancelling countdown:', err);
      return { success: false };
    }
  }

  // Placeholder methods (implement based on your existing code)
  async distributeDemoBalances(roomId) {
    // Implementation from your existing code
  }

  async deductBets(roomId, gameData) {
    // Implementation from your existing code
  }

  async processWinners(roomId, gameData) {
    // Implementation from your existing code
  }

  generateDrawnNumbersMultiWinner(roomId, cards) {
    // Implementation from your existing code
    return { drawnNumbers: [], winners: [] };
  }
}

// Export singleton instance
const optimizedGameManager = OptimizedGameManager.getInstance();
export { optimizedGameManager as gameManager };
export default OptimizedGameManager;
