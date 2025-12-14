import { rtdb } from "../bot/firebaseConfig.js";
import { ref, get, update, set } from "firebase/database";
import redis from "./redisClient.js";
import { v4 as uuidv4 } from "uuid";
class GameManager {
  constructor() {
    this.activeGames = new Map(); // roomId -> game data
    this.numberDrawIntervals = new Map(); // roomId -> interval ID
    this.countdownTimers = new Map(); // roomId -> timeout ID
    this.resetRoomTimers = new Map(); // roomId -> timeout ID for scheduled reset
    this.lastWinnerUserByRoom = new Map(); // roomId -> userId
    this.roomLocks = new Set();


    this.io = null; // Will be set when Socket.IO is initialized
  }

  // -------- Redis helpers (ephemeral state) --------
  async getRoomState(roomId) {
    try {
      const raw = await redis.get(`room:${roomId}`);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      console.error("⚠️ getRoomState Redis error:", e);
      return null;
    }
  }
// -----------RDTBS ROOM
  async getRoomConfig(roomId) {
    const roomRef = ref(rtdb, `rooms/${roomId}`);
    const snap = await get(roomRef);
    return snap.exists() ? snap.val() : null;
  }

  hydrateCards(baseCards = {}, claimedCards = {}) {
    const hydrated = {};
    for (const [cardId, card] of Object.entries(baseCards)) {
      const claim = claimedCards[cardId];
      hydrated[cardId] = {
        ...card,
        claimed: !!claim,
        claimedBy: claim?.claimedBy || null,
        auto: claim?.auto || false,
        autoUntil: claim?.autoUntil || null,
      };
    }
    return hydrated;
  }
  async ensureRoomExists(roomId) {
    const state = await this.getRoomState(roomId);
    if (state) return;
  
    const initial = {
      gameStatus: "waiting",
      claimedCards: {},
      calledNumbers: [],
      payout: null,
      payed: false,
      winner: null,
    };
  
    await redis.set(`room:${roomId}`, JSON.stringify(initial));
    await redis.expire(`room:${roomId}`, 60 * 60);
  }
  
/// REDIS AND RDTBS TOGETHER
  async getFullRoom(roomId) {
    const baseRoom = (await this.getRoomConfig(roomId)) || {};
    const runtime = (await this.getRoomState(roomId)) || {};
    const claimedCards = runtime.claimedCards || {};
    const bingoCards = this.hydrateCards(baseRoom.bingoCards || {}, claimedCards);
    return {
      ...baseRoom,
      ...runtime,
      bingoCards,
    };
  }
// SET ROOM STATE IN REDIS
  async setRoomState(roomId, patch) {
    try {
      const current = (await this.getRoomState(roomId)) || {};
      const next = { ...current, ...patch };
      await redis.set(`room:${roomId}`, JSON.stringify(next));
       // 1 hour
    } catch (e) {
      console.error("⚠️ setRoomState Redis error:", e);
    }
  }
  // GET ROOM PLAYERS FROM REDIS
  async getRoomPlayers(roomId) {
    try {
      const roomState = await this.getRoomState(roomId);
      const claimedCards = roomState?.claimedCards || {};
  
      const players = {};
  
      for (const [cardId, card] of Object.entries(claimedCards)) {
        if (!card?.claimed || !card.claimedBy) continue;
  
        const userId = card.claimedBy;
  
        players[userId] = {
          telegramId: userId,
          username: card.username || "Unknown",
          betAmount: card.betAmount || 0,
          cardId: card.cardId || cardId,
          attemptedBingo: !!card.attemptedBingo,
        };
      }
  
      return players;
    } catch (e) {
      console.error("⚠️ getRoomPlayers (derived) error:", e);
      return {};
    }
  }
  
  async getRoomPlayersrdtbs(roomId) {
    try {
      // 1️⃣ Get room state (so we know which players are in the room)
      const roomState = await this.getRoomState(roomId);
      const roomPlayers = await this.getRoomPlayers(roomId);
  
      if (!roomPlayers || Object.keys(roomPlayers).length === 0) {
        return {};
      }
  
      const result = {};
  
      // 2️⃣ Fetch each player from RTDB
      for (const userId of Object.keys(roomPlayers)) {
        try {
          const snap = await get(ref(rtdb, `users/${userId}`));
          if (snap.exists()) {
            result[userId] = snap.val();
          } else {
            console.warn(`⚠️ User record missing in RTDB: ${userId}`);
            result[userId] = { gamesPlayed: 0 }; // safe fallback
          }
        } catch (err) {
          console.error(`⚠️ Error fetching user ${userId} from RTDB:`, err);
          result[userId] = { gamesPlayed: 0 }; // safe fallback
        }
      }
  
      return result; // key → userId, value → full user data from RTDB
  
    } catch (e) {
      console.error("⚠️ getRoomPlayers RTDB fallback error:", e);
      return {};
    }
  }

  // Add/update a player in Redis
  

  // Get claimed cards  from Redis
  async getClaimedCards(roomId) {
    try {
      const roomState = await this.getRoomState(roomId);
      return roomState?.claimedCards || {};
    } catch (e) {
      console.error("⚠️ getClaimedCards Redis error:", e);
      return {};
    }
  }

  // Set claimed cards on Redis
  async setClaimedCards(roomId, claimedCards) {
    try {
      await this.setRoomState(roomId, { claimedCards });
    } catch (e) {
      console.error("⚠️ setClaimedCards Redis error:", e);
    }
  }


// SET CARD AUTO STATE IN REDIS
async setCardAutoState(roomId, cardId, options = {}) {
  try {
    const claimedCards = await this.getClaimedCards(roomId);

    const targetCard = claimedCards[cardId];
    if (!targetCard) {
      return { success: false, message: "Card not found" };
    }

    const autoEnabled = !!options.auto;
    const autoUntil = autoEnabled
      ? options.autoUntil || Date.now() + 24 * 60 * 60 * 1000
      : null;

    claimedCards[cardId] = {
      ...targetCard,
      auto: autoEnabled,
      autoUntil,
    };

    await this.setClaimedCards(roomId, claimedCards);

    return {
      success: true,
      cardId,
      auto: autoEnabled,
      autoUntil,
    };
  } catch (e) {
    console.error("⚠️ setCardAutoState error:", e);
    return { success: false, message: "Server error" };
  }
}


// APPLY BALANCE ADJUSTMENTS TO RDTBS
  async applyBalanceAdjustments(adjustments = {}) {
    const entries = Object.entries(adjustments);
    if (entries.length === 0) return;

    const updates = {};
    await Promise.all(
      entries.map(async ([userId, delta]) => {
        const balanceRef = ref(rtdb, `users/${userId}/balance`);
        const snap = await get(balanceRef);
        const current = snap.exists() ? snap.val() : 0;
        updates[`users/${userId}/balance`] = current + delta;
      })
    );

    if (Object.keys(updates).length > 0) {
      await update(ref(rtdb), updates);
    }
  }
// GET MULTI WIN STATS FROM REDIS
  async getMultiWinStats() {
    try {
      const raw = await redis.get("global:multiWinStats");
      return raw ? JSON.parse(raw) : { lastMultiGame: 0, gameCount: 0 };
    } catch (e) {
      console.error("⚠️ getMultiWinStats error:", e);
      return { lastMultiGame: 0, gameCount: 0 };
    }
  }
// SET MULTI WIN STATS IN REDIS
  async setMultiWinStats(stats) {
    try {
      await redis.set("global:multiWinStats", JSON.stringify(stats));
    } catch (e) {
      console.error("⚠️ setMultiWinStats error:", e);
    }
  }


  async placeBet(roomId, cardId, user) {
    try {
      await this.ensureRoomExists(roomId);
  
      const roomState = await this.getRoomState(roomId);
      const gameStatus = roomState?.gameStatus || "waiting";
  
      // Only allow bets in waiting or countdown
      if (gameStatus !== "waiting" && gameStatus !== "countdown") {
        return { success: false, message: "Room not accepting bets right now" };
      }
  
      const roomConfig = await this.getRoomConfig(roomId);
      if (!roomConfig) {
        return { success: false, message: "Room not found" };
      }
  
      // Validate card exists
      if (!roomConfig.bingoCards?.[cardId]) {
        return { success: false, message: "Invalid card" };
      }
  
      const claimedCards = await this.getClaimedCards(roomId);
  
      // ❌ Card already taken
      if (claimedCards[cardId]) {
        return { success: false, message: "Card already claimed" };
      }
  
      const userId = user.telegramId;
  
      // ❌ User already has a card (NO double betting)
      const alreadyClaimed = Object.values(claimedCards).some(
        c => c.claimedBy === userId
      );
      if (alreadyClaimed) {
        return { success: false, message: "You already placed a bet" };
      }
  
      // ✅ Claim card = player joins game
      claimedCards[cardId] = {
        cardId,
        claimed: true,
        claimedBy: userId,
        username: user.username,
        telegramId: user.telegramId,
        claimedAt: Date.now(),
        betAmount: roomConfig.betAmount || 0,
        attemptedBingo: false,
        auto: false,
        autoUntil: null,
      };
  
      await this.setClaimedCards(roomId, claimedCards);
  
      // Notify clients
      if (this.io) {
        this.io.to(roomId).emit("cardClaimed", {
          roomId,
          cardId,
          userId,
          username: user.username,
          betAmount: roomConfig.betAmount || 0,
        });
      }
  
      return { success: true };
  
    } catch (err) {
      console.error("❌ placeBet error:", err);
      return { success: false, message: "Server error" };
    }
  }
  

  async cancelBetForPlayer(roomId, cardId, userId) {
    try {
      await this.ensureRoomExists(roomId);
  
      const roomState = await this.getRoomState(roomId);
      const gameStatus = roomState?.gameStatus || "waiting";
  
      // ❌ Cannot cancel once game started
      if (gameStatus !== "waiting" && gameStatus !== "countdown") {
        return { success: false, message: "Cannot cancel bet right now" };
      }
  
      const claimedCards = await this.getClaimedCards(roomId);
      const card = claimedCards[cardId];
  
      // ❌ Card not claimed
      if (!card) {
        return { success: false, message: "Card not claimed" };
      }
  
      // ❌ Not the owner
      if (card.claimedBy !== userId) {
        return { success: false, message: "Not your card" };
      }
  
      // ✅ Remove card (this IS removing the player)
      delete claimedCards[cardId];
      await this.setClaimedCards(roomId, claimedCards);
  
      // 🔁 If countdown is running and cards < 2 → revert to waiting
      const remainingCount = Object.keys(claimedCards).length;
      if (gameStatus === "countdown" && remainingCount < 2) {
        await this.setRoomState(roomId, {
          gameStatus: "waiting",
          countdownEndAt: null,
        });
  
        if (this.countdownTimers?.has(roomId)) {
          clearTimeout(this.countdownTimers.get(roomId));
          this.countdownTimers.delete(roomId);
        }
  
        if (this.io) {
          this.io.to(roomId).emit("countdownStopped", { roomId });
        }
      }
  
      // Notify clients
      if (this.io) {
        this.io.to(roomId).emit("cardUnclaimed", {
          roomId,
          cardId,
          userId,
        });
      }
  
      return { success: true };
  
    } catch (err) {
      console.error("❌ cancelBet error:", err);
      return { success: false, message: "Server error" };
    }
  }
  

  /**
   * Sync players and claimed cards to ensure:
   * 1. Number of players equals number of claimed cards
   * 2. Remove cards that don't have a corresponding player
   * 3. Remove players that don't have a claimed card
   * 4. If one user has multiple cards, unclaim all but one (keep the one matching player.cardId)
   */

  async getGameState(gameId) {
    try {
      const raw = await redis.get(`game:${gameId}`);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      console.error("⚠️ getGameState Redis error:", e);
      return null;
    }
  }

  async setGameState(gameId, state) {
    try {
      await redis.set(`game:${gameId}`, JSON.stringify(state));
      await redis.expire(`game:${gameId}`, 60 * 60); // 1 hour
    } catch (e) {
      console.error("⚠️ setGameState Redis error:", e);
    }
  }

  // Singleton pattern
  static getInstance() {
    if (!GameManager.instance) {
      GameManager.instance = new GameManager();
    }
    return GameManager.instance;
  }

  setSocketIO(io) {
    this.io = io;
  }
  stopNumberDrawing(roomId) {
    const interval = this.numberDrawIntervals.get(roomId);
    if (interval) {
      clearInterval(interval);
      this.numberDrawIntervals.delete(roomId);
    }
  }
  async startGamingProcess(roomId, durationMs = 30000, startedBy = "auto") {
    try {
      await this.ensureRoomExists(roomId);
      if (this.countdownTimers.has(roomId)) {
        return { success: false, message: "Countdown already running" };
      }
      const room = await this.getRoomState(roomId);
      const claimedCards = await this.getClaimedCards(roomId);
      const playerCount = Object.keys(claimedCards).length;
  
      // ❌ Basic guards
      if (room.gameStatus !== "waiting") {
        return { success: false, message: "Room not in waiting state" };
      }
  
      if (playerCount < 2) {
        return { success: false, message: "Not enough players" };
      }
  
      const countdownEndAt = Date.now() + durationMs;
  
      // ✅ Set countdown state
      await this.setRoomState(roomId, {
        gameStatus: "countdown",
        countdownEndAt,
        countdownStartedBy: startedBy,
      });
  
      if (this.io) {
        this.io.to(roomId).emit("countdownStarted", { roomId, countdownEndAt });
      }
  
      // Clear existing timer
      if (this.countdownTimers?.has(roomId)) {
        clearTimeout(this.countdownTimers.get(roomId));
      }
  
      const tick = async () => {
        const state = await this.getRoomState(roomId);
        const cards = await this.getClaimedCards(roomId);
        const count = Object.keys(cards).length;
  
        // ❌ Abort countdown if players drop
        if (count < 2) {
          await this.setRoomState(roomId, {
            gameStatus: "waiting",
            countdownEndAt: null,
          });
  
          if (this.io) {
            this.io.to(roomId).emit("countdownStopped", { roomId });
          }
  
          this.countdownTimers.delete(roomId);
          return;
        }
  
        // ✅ Countdown finished → last validation
        if (Date.now() >= countdownEndAt) {
          this.countdownTimers.delete(roomId);
  
          const finalCards = await this.getClaimedCards(roomId);
          if (Object.keys(finalCards).length < 2) {
            await this.setRoomState(roomId, {
              gameStatus: "waiting",
              countdownEndAt: null,
            });
            return;
          }
          const roomData= await this.getFullRoom(roomId);
    const rooms = await this.getRoomState(roomId);
    
    const claimedCards = await this.getClaimedCards(roomId);
          // 🎮 START GAME
          await this.startGame(roomId,roomData,rooms,claimedCards);
          return;
        }
  
        // Continue ticking
        this.countdownTimers.set(roomId, setTimeout(tick, 500));
      };
  
      this.countdownTimers.set(roomId, setTimeout(tick, 500));
  
      return { success: true, countdownEndAt };
  
    } catch (err) {
      console.error(`❌ startGamingProcess error (${roomId}):`, err);
      return { success: false, message: "Server error" };
    }
  }
  
  


  async lockRoom(roomId, fn) {
    while (this.roomLocks.has(roomId)) {
      await new Promise(r => setTimeout(r, 100)); // wait 100ms
    }
    this.roomLocks.add(roomId);
    try {
      return await fn();
    } finally {
      this.roomLocks.delete(roomId);
    }
  }

  async startGame(roomId, roomData,rooms,claimedCards) {
    
    const roomConfig = await this.getRoomConfig(roomId);
    const players = await this.getRoomPlayersrdtbs(roomId);
    const playerCount = Object.keys(claimedCards).length;
    
    if (playerCount < 2) {
      await this.setRoomState(roomId, { gameStatus: "waiting" });
      return;
    }
  
    const gameId = `game_${Date.now()}`
    const totalPayout = rooms.betAmount * playerCount;
    const cards = Object.values(claimedCards);

const { drawnNumbers, winners } =
  await this.generateDrawnNumbersMultiWinner(roomId, cards);

  console.log(drawnNumbers)
  console.log(claimedCards)
    const gameState = {
      id: gameId,
      roomId,
      drawnNumbers,
      currentNumberIndex: 0,
      createdAt: Date.now(),
      startedAt: Date.now(),
      drawIntervalMs: 5000,
      totalPayout,
      status: "active",
    };
  
    // ✅ Persist game
    await this.setGameState(gameId, gameState);
    await this.deductBets(roomId, gameId,roomConfig,players );
    await this.setRoomState(roomId, {
      gameStatus: "playing",
      currentGameId: gameId,
      calledNumbers: [],
      winners,
    });
  
    if (this.io) {
      this.io.to(roomId).emit("gameStarted", { roomId, gameId });
    }
  
    // 🔢 Start number drawing loop
    this.startNumberDrawing(roomId, gameId ,rooms, roomData);
  }
  
  async saveRevenueEntry(gameId, roomId, amount) {
    try {
      const revenueRef = ref(rtdb, `revenue/${gameId}`);
      const existing = await get(revenueRef);
      if (existing.exists()) {
        console.log(`ℹ️ Revenue already saved for game ${gameId}`);
        return;
      }

      await set(revenueRef, {
        gameId,
        roomId,
        amount,
        datetime: Date.now(),
        drawned: false,
      });

      console.log(`💰 Revenue successfully saved for game ${gameId}: ${amount}`);
    } catch (err) {
      console.error("❌ Failed to save revenue:", err);
    }
  }
  // Start number drawing process
  startNumberDrawing(roomId, gameId, rooms ,roomData) {
    if (this.numberDrawIntervals.has(roomId)) {

      if (rooms.gameStatus !== "playing" ) {
        this.stopNumberDrawing(roomId);
        return;
      }
    }
    const drawInterval = setInterval(() => {
        setImmediate(async () => {
      try {
        let gameData = await this.getGameState(gameId);

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
          this.stopGame(roomId, "allNumbersDrawn");
          return;
        }

        const currentNumber = drawnNumbers[currentNumberIndex];
        const newDrawnNumbers = drawnNumbers.slice(0, currentNumberIndex + 1);

        // Update game data
        // Persist in Redis
        gameData.currentDrawnNumbers = newDrawnNumbers;
        gameData.currentNumberIndex = currentNumberIndex + 1;
        await this.setGameState(gameId, gameData);
        await this.setRoomState(roomId, {
          calledNumbers: newDrawnNumbers,
        });

        // Notify clients
        if (this.io) {
          this.io.to(roomId).emit('numberDrawn', {
            number: currentNumber,
            drawnNumbers: newDrawnNumbers,
            roomId
          });
        }

        // Auto-bingo for auto players
        try {
          const bingoCards = roomData?.bingoCards || {};
          const calledSet = new Set(newDrawnNumbers);
          const patterns = this.generateValidPatterns();

          for (const [cardId, card] of Object.entries(bingoCards)) {
            if (!card?.auto) continue;
            const autoUntil = card.autoUntil || 0;
            if (autoUntil <= Date.now()) continue;
            if (!card.claimed || !card.claimedBy) continue;

            const flat = card.numbers.flat();

            let winningPattern = null;
            for (const pat of patterns) {
              const ok = pat.every(
                (idx) => flat[idx] === 0 || calledSet.has(flat[idx])
              );
              if (ok) {
                winningPattern = pat;
                break;
              }
            }
            if (winningPattern) {
              this.checkBingo(roomId, cardId, card.claimedBy, winningPattern);
              break;
            }
          }
        } catch (e) {
          console.error("Auto-bingo error:", e);
        }

        console.log(`🎲 Room ${roomId}: Drew number ${currentNumber}`);
      } catch (error) {
        console.error("Error in number drawing:", error);
        this.stopNumberDrawing(roomId);
      }
    });
    }, 3000); // 5 second intervals

    this.numberDrawIntervals.set(roomId, drawInterval);
  }

  async stopGame(roomId, reason = "manual") {
    try {
      // 🛑 Stop number drawing
      this.stopNumberDrawing(roomId);
    
      // 💰 Finalize payouts / revenue
      await this.finalizeGame(roomId, reason);
  
      // 🔚 Mark game ended
      await this.setRoomState(roomId, {
        gameStatus: "ended",
        countdownEndAt: null,
        countdownStartedBy: null,
      });
  
      if (this.io) {
        this.io.to(roomId).emit("gameEnded", {
          roomId,
          reason,
        });
      }
  
      // ♻️ Reset room (auto cards only)
      const resetTimer = setTimeout(async () => {
        try {
          await this.lockRoom(roomId, async () => {
            await this.resetRoom(roomId);
          });
        } catch (e) {
          console.error("❌ resetRoom failed:", e);
        }
      }, 3000);
  
      this.resetRoomTimers?.set(roomId, resetTimer);
  
      // 🧼 Clean per-game Redis
      
  
      console.log(`🔚 Game stopped in room ${roomId} (${reason})`);
    } catch (err) {
      console.error(`❌ stopGame error (${roomId}):`, err);
    }
  }
  
  async finalizeGame(roomId, reason = "manual") {
    const roomState = await this.getRoomState(roomId);
    const gameId = roomState?.currentGameId;
    if (!gameId) return;
  
    const gameData = await this.getGameState(gameId);
    if (!gameData) return;
  
    const alreadyPaid = roomState?.payed === true;
  
    if (alreadyPaid) return;
  
    // 🎯 No winner case
    if (reason === "allNumbersDrawn" && (!gameData.winners || gameData.winners.length === 0)) {
      const revenue = Math.floor((gameData.totalPayout || 0) * 1.25);
  
      await this.saveRevenueEntry(gameId, roomId, revenue);
  
      await this.setRoomState(roomId, {
        winner: null,
        payout: gameData.totalPayout || 0,
        payed: true,
      });
  
      return;
    }
  
    // 🏆 Winners exist
    if (gameData.winners && gameData.winners.length > 0) {
      await this.processWinners(roomId, gameData);
    }
  }
  

  async processWinners(roomId, gameData) {
    try {
      const { winners, totalPayout, id } = gameData;
      console.log(`REVENUE ADDING ***** `);

      const revenue = Math.floor((totalPayout || 0) / 4);

      await this.saveRevenueEntry(id, roomId, revenue);

      const payoutPerWinner = winners && winners.length > 0 ? Math.floor(totalPayout / winners.length) : 0;
      const adjustments = {}; // balance adjustments

      // Increase gamesWon for each winner and prepare adjustments
      for (const winner of winners || []) {
        if (!winner.userId) continue;
        const userId = winner.userId;
        adjustments[userId] = (adjustments[userId] || 0) + payoutPerWinner;

        // Fetch user to read gamesWon
        try {
          const userSnap = await get(ref(rtdb, `users/${userId}`));
          const userData = userSnap.val() || {};
          const currentGamesWon = userData.gamesWon || 0;

          // Update gamesWon += 1
          await update(ref(rtdb, `users/${userId}`), {
            gamesWon: currentGamesWon + 1,
            lastWinDate: new Date().toISOString()  // ✅ store last win time
          });
          
        } catch (err) {
          console.error(`⚠️ Failed updating gamesWon for ${userId}:`, err);
        }
      }

      // Update room state (mark as paid)
      await this.setRoomState(roomId, {
        payout: totalPayout,
        payed: true,
        winner: winners && winners[0] ? winners[0].userId : null,
        winners: winners ? winners.map(w => w.userId) : [],
      });

      console.log(`🏆 Processed ${winners ? winners.length : 0} winners in room ${roomId}`);

      // Apply balance adjustments (outside DB update loop for efficiency)
      if (Object.keys(adjustments).length > 0) {
        await this.applyBalanceAdjustments(adjustments);
      }

    } catch (error) {
      console.error("Error processing winners:", error);
    }
  }
 // Acquire a lock for checkBingo
 async acquireBingoLock(roomId, timeoutMs = 10000) {
  const key = `lock:bingo:${roomId}`;
  const now = Date.now();

  const result = await redis.set(key, now, "NX", "PX", timeoutMs);
  return result === "OK";
}

async releaseBingoLock(roomId) {
  const key = `lock:bingo:${roomId}`;
  await redis.del(key);
}

async checkBingo(roomId, userId, pattern) {
 const start = Date.now();
while (Date.now() - start < 3000) {
  if (await this.acquireBingoLock(roomId)) break;
  await new Promise(r => setTimeout(r, 120));
}
if (Date.now() - start >= 3000) {
  return { success: false, message: "Lock timeout" };
}

  try {
    // 🔎 Load room + validate state
    const room = await this.getFullRoom(roomId);
    if (!room || room.gameStatus !== "playing") {
      return { success: false, message: "Game not in playing state" };
    }

    const gameId = room.currentGameId;
    if (!gameId) {
      return { success: false, message: "Game not found" };
    }

    // 🔎 Load claimed cards
    const claimedCards = await this.getClaimedCards(roomId);
    const cardEntry = Object.values(claimedCards).find(
      c => c.claimedBy === userId
    );

    if (!cardEntry) {
      return { success: false, message: "No claimed card found for user" };
    }

    const cardId = cardEntry.cardId;

    // ❌ Prevent repeat attempts
    if (cardEntry.attemptedBingo) {
      return { success: false, message: "Bingo already attempted" };
    }

    // 🧠 Validate bingo pattern BEFORE mutating state
    const isValid = this.validateBingoPattern(
      cardId,
      room,
      pattern,
      room.calledNumbers || []
    );

    // ❌ Invalid bingo → mark attempted, allow game to continue
    if (!isValid) {
      claimedCards[cardId].attemptedBingo = true;
      await this.setClaimedCards(roomId, claimedCards);

      return { success: false, message: "Invalid bingo pattern" };
    }

    // 🛑 Valid bingo → stop number drawing
    this.stopNumberDrawing(roomId);

    // 🔎 Load game state
    const gameData = await this.getGameState(gameId);
    if (!gameData || gameData.status !== "active") {
      return { success: false, message: "Game not active" };
    }

    // 🧮 Compute payout ONCE
    const totalPlayers = Object.keys(claimedCards).length;
    const betAmount = room.betAmount || 0;
    const totalPayout = Math.floor(totalPlayers * betAmount * 0.8);

    // 🏆 Record winner ONLY (no payments here)
    gameData.winners = [{
      id: uuidv4(),
      cardId,
      userId,
      username: cardEntry.username,
      checked: true,
      pattern
    }];

    gameData.totalPayout = totalPayout;
    gameData.winner = userId;
    gameData.status = "ended";

    await this.setGameState(gameId, gameData);

    // 🏁 Update room (settlement handled later)
    await this.setRoomState(roomId, {
      winner: userId,
      winners: [userId],
      payout: totalPayout,
      payed: false
    });

    // 📣 Notify clients
    if (this.io) {
      this.io.to(roomId).emit("winnerConfirmed", {
        roomId,
        gameId,
        userId,
        cardId,
        patternIndices: pattern,
        payout: totalPayout
      });
    }

    // 🔚 End game → finalizeGame() will pay & record revenue
    await this.stopGame(roomId, "bingo");

    return {
      success: true,
      isWinner: true,
      payout: totalPayout,
      winner: userId,
      cardId
    };

  } catch (err) {
    console.error("❌ checkBingo error:", err);
    return { success: false, message: "Server error" };
  } finally {
    await this.releaseBingoLock(roomId);
  }
}

  // Check bingo clai
  validateBingoPattern(cardId, room, pattern, calledNumbers) {
    try {
      const card = room.bingoCards[cardId];
      if (!card) return false;

      const flatCard = card.numbers.flat();
      const calledSet = new Set(calledNumbers);

      // Check if pattern is valid (complete row, column, diagonal, etc.)
      const validPatterns = this.generateValidPatterns();

      for (const validPattern of validPatterns) {
        const isMatch = validPattern.every(index => pattern.includes(index));
        if (isMatch) {
          // Check if all numbers in pattern were called
          const patternNumbers = validPattern.map(index => flatCard[index]);
          const allCalled = patternNumbers.every(num => num === 0 || calledSet.has(num)); // 0 is free space

          if (allCalled) {
            return true;
          }
        }
      }

      return false;
    } catch (error) {
      console.error("Error validating bingo pattern:", error);
      return false;
    }
  }

  // Generate valid winning patterns
  generateValidPatterns() {
    const patterns = [];
    const size = 5;

    // Rows
    for (let r = 0; r < size; r++) {
      patterns.push([...Array(size)].map((_, c) => r * size + c));
    }

    // Columns
    for (let c = 0; c < size; c++) {
      patterns.push([...Array(size)].map((_, r) => r * size + c));
    }

    // Diagonals
    patterns.push([...Array(size)].map((_, i) => i * size + i));
    patterns.push([...Array(size)].map((_, i) => i * size + (size - 1 - i)));

    // Four corners
    patterns.push([0, 4, 20, 24]);

    // Small X (center + 4 adjacent)
    patterns.push([12, 6, 8, 16, 18]);

    return patterns;
  }

  // Deduct bets from players
  async deductBets(roomId, id ,roomConfig,players) {
    try {
      const storedGame = await this.getGameState(id);
      if (!storedGame || storedGame.betsDeducted) {
        console.log("ℹ️ Bets already deducted, skipping");
        return;
      }
  
      if (!roomConfig || !players) return;
  
      const betAmount = roomConfig.betAmount || 0;
      const adjustments = {};
      const updates = {};
  
      for (const playerId of Object.keys(players)) {
        const player = players[playerId];
        if (!player || player.isDemo) continue;
  
        adjustments[playerId] = (adjustments[playerId] || 0) - betAmount;
        updates[playerId] = {
          gamesPlayed: (player.gamesPlayed || 0) + 1,
        };
      }
  
      await this.applyBalanceAdjustments(adjustments);
  
      for (const playerId of Object.keys(updates)) {
        await update(ref(rtdb, `users/${playerId}`), updates[playerId]);
      }
  
      storedGame.betsDeducted = true;
      await this.setGameState(id, storedGame);
  
      console.log(`💸 Bets deducted for game ${id}`);
  
    } catch (error) {
      console.error("Error deducting bets:", error);
      throw error; // 🔑 fail hard so game does NOT start
    }
  }
  
  

  async generateDrawnNumbersMultiWinner(roomId, cards = []) {
    try {
      const winners = [];
      const usedNumbers = new Set();
      const drawnNumbers = [];
  
      // --- Validate card list ---
      if (!Array.isArray(cards) || cards.length === 0) {
        console.warn(`⚠️ No cards found for room ${roomId}`);
        return { drawnNumbers: [], winners: [] };
      }
  
      const validCards = cards.filter(c => c && Array.isArray(c.numbers) && c.claimedBy);
      if (validCards.length === 0) {
        console.warn(`⚠️ No valid cards for room ${roomId}`);
        return { drawnNumbers: [], winners: [] };
      }
  
      // --- Load recent cooldown memory ---
      if (!this.recentWinnersByRoom) this.recentWinnersByRoom = new Map();
      if (!this.recentWinnersByRoom.has(roomId)) this.recentWinnersByRoom.set(roomId, []);
  
      const recentWinners = this.recentWinnersByRoom.get(roomId);
      const playerIds = [...new Set(validCards.map(c => c.claimedBy))];
      const playerCount = playerIds.length;
      const cooldown = Math.max(1, Math.floor(playerCount / 2));
  
      // --- Decide number of winners ---
      let desiredWinners = 1;
      if (playerCount > 150) {
        desiredWinners = Math.random() < 0.4 ? 3 : 2;
      } else if (playerCount > 80) {
        desiredWinners = Math.random() < 0.5 ? 2 : 1;
      }
  
      // --- Count demo vs normal players ---
      const demoCards = validCards.filter(c => c.claimedBy.startsWith("demo"));
      const normalCards = validCards.filter(c => !c.claimedBy.startsWith("demo"));
  
      const demoCount = demoCards.length;
      const normalCount = normalCards.length;
  
      // --- Get players' gamesPlayed from DB ---
      const playersData = await this.getRoomPlayersrdtbs(roomId);

      // Expected structure: playersData[userId].gamesPlayed
  
      // --- Build list restricted by 5-game rule ---
      let fiveGameEligibleCards;
  
      if (demoCount > normalCount) {
        console.log("🟡 Demo players > Normal players → enforcing 5-game minimum rule");
  
        fiveGameEligibleCards = validCards.filter(card => {
          const userId = card.claimedBy;
  
          if (userId.startsWith("demo")) return true;
  
          const gamesPlayed = playersData[userId]?.gamesPlayed || 0;
          return gamesPlayed >= 5;
        });
      } else {
        fiveGameEligibleCards = [...validCards]; // no restriction
      }
  
      // fallback: if all are removed (rare), allow all validCards
      if (fiveGameEligibleCards.length === 0) {
        console.log("⚠️ All players blocked by rules — fallback to validCards");
        fiveGameEligibleCards = [...validCards];
      }
  
      // --- Start picking winners ---
      let eligibleCards = fiveGameEligibleCards.filter(c => !recentWinners.includes(c.claimedBy));
      if (eligibleCards.length === 0) {
        eligibleCards = fiveGameEligibleCards.filter(c => !recentWinners.includes(c.claimedBy));
      }
  
      const winnerCards = [];
      const winnerPlayers = new Set();
  
      // -----------------------------
      // Winner selection logic
      // -----------------------------
      const pickWinnerCard = () => {
        // PRIMARY: eligible and unique
        let pool = eligibleCards.filter(c => !winnerPlayers.has(c.claimedBy));
  
        // SECOND: restricted fallback
        if (pool.length === 0) {
          pool = fiveGameEligibleCards.filter(c => !winnerPlayers.has(c.claimedBy));
        }
  
        // FINAL: any allowed restricted card
        if (pool.length === 0) {
          pool = [...fiveGameEligibleCards];
        }
  
        if (pool.length === 0) return null;
        return pool[Math.floor(Math.random() * pool.length)];
      };
  
      // Pick winner cards
      while (winnerCards.length < desiredWinners) {
        const next = pickWinnerCard();
        if (!next) break;
  
        winnerCards.push(next);
        winnerPlayers.add(next.claimedBy);
  
        eligibleCards = eligibleCards.filter(c => c.id !== next.id);
      }
  
      // Absolute final fallback (never allow zero winners)
      if (winnerCards.length === 0 && fiveGameEligibleCards.length > 0) {
        const fallback = fiveGameEligibleCards[Math.floor(Math.random() * fiveGameEligibleCards.length)];
        winnerCards.push(fallback);
        winnerPlayers.add(fallback.claimedBy);
      }
  
      if (winnerCards.length === 0) {
        console.error(`❌ Failed to select any winner for room ${roomId}`);
        return { drawnNumbers: [], winners: [] };
      }
  
      // ----------------------------
      // Inject winning numbers
      // ----------------------------
      for (const winnerCard of winnerCards) {
        const winnerPatterns = this.pickPatternNumbers(winnerCard) || [];
        const winnerPattern = winnerPatterns[Math.floor(Math.random() * winnerPatterns.length)] || [];
  
        for (const n of winnerPattern) {
          if (n > 0 && n <= 75 && !usedNumbers.has(n)) {
            usedNumbers.add(n);
            drawnNumbers.push(n);
          }
        }
      }
  
      // ----------------------------
      // Losers: one missing number
      // ----------------------------
      const loserMissingNumbers = [];
      for (const card of validCards) {
        if (winnerCards.some(wc => wc.id === card.id)) continue;
  
        const pats = this.pickPatternNumbers(card);
        if (!Array.isArray(pats) || pats.length === 0) continue;
  
        const chosen = pats[Math.floor(Math.random() * pats.length)];
        if (!Array.isArray(chosen) || chosen.length === 0) continue;
  
        const missIndex = Math.floor(Math.random() * chosen.length);
        const missingNum = chosen[missIndex];
  
        for (let i = 0; i < chosen.length; i++) {
          const n = chosen[i];
          if (i !== missIndex && n > 0 && n <= 75 && !usedNumbers.has(n)) {
            usedNumbers.add(n);
            drawnNumbers.push(n);
          }
        }
  
        if (missingNum > 0 && missingNum <= 75) loserMissingNumbers.push(missingNum);
      }
  
      // --- Fill to 25 numbers ---
      let safety = 0;
      while (drawnNumbers.length < 25 && safety++ < 500) {
        const rand = Math.floor(Math.random() * 75) + 1;
        if (!usedNumbers.has(rand)) {
          usedNumbers.add(rand);
          drawnNumbers.push(rand);
        }
      }
  
      const first25 = this.shuffleArray(drawnNumbers.slice(0, 25));
  
      // --- Add missing numbers AFTER 25 ---
      const after25 = [];
      for (const n of loserMissingNumbers) {
        if (!usedNumbers.has(n)) {
          usedNumbers.add(n);
          after25.push(n);
        }
      }
  
      let safety2 = 0;
      while (first25.length + after25.length < 75 && safety2++ < 500) {
        const rand = Math.floor(Math.random() * 75) + 1;
        if (!usedNumbers.has(rand)) {
          usedNumbers.add(rand);
          after25.push(rand);
        }
      }
  
      const finalDrawn = [...first25, ...this.shuffleArray(after25)];
  
      // --- Save updated cooldown history ---
      const updated = [...recentWinners, ...winnerCards.map(w => w.claimedBy)];
      if (updated.length > cooldown) updated.splice(0, updated.length - cooldown);
      this.recentWinnersByRoom.set(roomId, updated);
  
      console.log(
        `🏆 Winners [${winnerCards.map(w => w.claimedBy).join(", ")}] in ${roomId} | Cooldown=${cooldown}`
      );
  
      winners.push(...winnerCards.map(w => w.id));
      return { drawnNumbers: finalDrawn, winners };
  
    } catch (err) {
      console.error(`❌ Error in generateDrawnNumbersMultiWinner for ${roomId}:`, err);
      return { drawnNumbers: [], winners: [] };
    }
  }
  
  pickPatternNumbers(card) {
    const numbers = card.numbers;
    const size = numbers.length;
    const center = Math.floor(size / 2);
    const patterns = [];

    // Rows
    for (let r = 0; r < size; r++) patterns.push(numbers[r]);

    // Columns
    for (let c = 0; c < size; c++) patterns.push(numbers.map(row => row[c]));

    // Diagonals
    patterns.push(numbers.map((row, i) => row[i]));
    patterns.push(numbers.map((row, i) => row[size - 1 - i]));

    // Small X
    patterns.push([
      numbers[center][center],
      numbers[center - 1][center - 1],
      numbers[center - 1][center + 1],
      numbers[center + 1][center - 1],
      numbers[center + 1][center + 1],
    ]);

    // Four corners
    patterns.push([
      numbers[0][0],
      numbers[0][size - 1],
      numbers[size - 1][0],
      numbers[size - 1][size - 1],
    ]);

    return patterns;
  }

  shuffleArray(array) {
    const arr = array.slice();
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  async resetRoom(roomId) {
    try {
      // Clear timers
      if (this.resetRoomTimers?.has(roomId)) {
        clearTimeout(this.resetRoomTimers.get(roomId));
        this.resetRoomTimers.delete(roomId);
      }
      if (this.countdownTimers?.has(roomId)) {
        clearTimeout(this.countdownTimers.get(roomId));
        this.countdownTimers.delete(roomId);
      }
  
      const roomConfig = await this.getRoomConfig(roomId);
      if (!roomConfig) {
        console.error(`❌ Room ${roomId} not found`);
        return;
      }
  
      const betAmount = roomConfig.betAmount || 0;
      const claimedCards = await this.getClaimedCards(roomId);
  
      const now = Date.now();
      let keptAutoCards = 0;
  
      for (const [cardId, card] of Object.entries(claimedCards)) {
        if (!card?.claimed) {
          delete claimedCards[cardId];
          continue;
        }
  
        // ❌ Non-auto cards are always removed
        if (!card.auto) {
          delete claimedCards[cardId];
          continue;
        }
  
        // Auto card validation
        const autoUntil = card.autoUntil || 0;
        const autoActive = autoUntil > now;
  
        let hasEnoughBalance = false;
        if (autoActive && card.claimedBy) {
          const balanceSnap = await get(
            ref(rtdb, `users/${card.claimedBy}/balance`)
          );
          const balance = balanceSnap.val() || 0;
          hasEnoughBalance = balance >= betAmount;
        }
  
        // ❌ Auto invalid → remove
        if (!autoActive || !hasEnoughBalance) {
          delete claimedCards[cardId];
          continue;
        }
  
        // ✅ Keep auto card, reset per-game state
        claimedCards[cardId] = {
          ...card,
          attemptedBingo: false,
        };
        keptAutoCards++;
      }
  
      // Save cleaned cards
      await this.setClaimedCards(roomId, claimedCards);
  
      // Reset room runtime state
      await this.setRoomState(roomId, {
        gameStatus: "waiting",
        currentGameId: null,
        calledNumbers: [],
        countdownEndAt: null,
        nextGameCountdownEndAt: null,
        winner: null,
        payout: null,
        payed: false,
      });
  
      if (this.io) {
        this.io.to(roomId).emit("roomReset", {
          roomId,
          keptAutoCards,
        });
      }
      // 🧼 Clean per-game Redis AFTER reset is complete
      try {
        const roomState = await this.getRoomState(roomId);
        const gameId = roomState?.currentGameId;

        if (gameId) {
          await redis.del(`game:${gameId}`);
          console.log(`🧹 Deleted game state game:${gameId}`);
        }
      } catch (e) {
        console.error(`⚠️ Failed to cleanup game state for room ${roomId}`, e);
      }

      console.log(
        `♻️ Room ${roomId} reset (kept ${keptAutoCards} auto cards)`
      );
    } catch (error) {
      console.error("❌ resetRoom error:", error);
    }
  }
  


}

// Export both the class and singleton instance
export default GameManager;
export const gameManager = GameManager.getInstance();
