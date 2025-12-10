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

  /**
   * Fetch permanent room config stored in RTDB (allowed by requirements).
   */
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

  /**
   * Merge permanent room config from RTDB with ephemeral runtime state from Redis.
   * - RTDB: permanent data (id, name, betAmount, bingoCards, isDemoRoom, etc.)
   * - Redis: roomStatus, countdowns, players, calledNumbers, currentGameId, etc.
   */
  async getFullRoom(roomId) {
    const baseRoom = (await this.getRoomConfig(roomId)) || {};
    const runtime = (await this.getRoomState(roomId)) || {};
    const players = runtime.players || {};
    const claimedCards = runtime.claimedCards || {};
    const bingoCards = this.hydrateCards(baseRoom.bingoCards || {}, claimedCards);
    return {
      ...baseRoom,
      ...runtime,
      players,
      bingoCards,
    };
  }

  async setRoomState(roomId, patch) {
    try {
      const current = (await this.getRoomState(roomId)) || {};
      const next = { ...current, ...patch };
      await redis.set(`room:${roomId}`, JSON.stringify(next));
      // Optional TTL so old rooms are cleaned automatically
      await redis.expire(`room:${roomId}`, 60 * 60); // 1 hour
    } catch (e) {
      console.error("⚠️ setRoomState Redis error:", e);
    }
  }

  // Get room players from Redis (runtime data)
  async getRoomPlayers(roomId) {
    try {
      const roomState = await this.getRoomState(roomId);
      return roomState?.players || {};
    } catch (e) {
      console.error("⚠️ getRoomPlayers Redis error:", e);
      return {};
    }
  }

  // Set room players in Redis (runtime data)
  async setRoomPlayers(roomId, players) {
    try {
      await this.setRoomState(roomId, { players });
    } catch (e) {
      console.error("⚠️ setRoomPlayers Redis error:", e);
    }
  }

  // Add/update a player in Redis
  async addRoomPlayer(roomId, playerId, playerData) {
    try {
      const players = await this.getRoomPlayers(roomId);
      players[playerId] = playerData;
      await this.setRoomPlayers(roomId, players);
    } catch (e) {
      console.error("⚠️ addRoomPlayer Redis error:", e);
    }
  }

  // Remove a player from Redis
  async removeRoomPlayer(roomId, playerId) {
    try {
      const players = await this.getRoomPlayers(roomId);
      delete players[playerId];
      await this.setRoomPlayers(roomId, players);
    } catch (e) {
      console.error("⚠️ removeRoomPlayer Redis error:", e);
    }
  }

  async updateRoomPlayer(roomId, playerId, patch) {
    try {
      const players = await this.getRoomPlayers(roomId);
      if (!players[playerId]) return;
      players[playerId] = { ...players[playerId], ...patch };
      await this.setRoomPlayers(roomId, players);
    } catch (e) {
      console.error("⚠️ updateRoomPlayer Redis error:", e);
    }
  }

  // Get claimed cards (non-auto) from Redis
  async getClaimedCards(roomId) {
    try {
      const roomState = await this.getRoomState(roomId);
      return roomState?.claimedCards || {};
    } catch (e) {
      console.error("⚠️ getClaimedCards Redis error:", e);
      return {};
    }
  }

  // Set claimed cards (non-auto) in Redis
  async setClaimedCards(roomId, claimedCards) {
    try {
      await this.setRoomState(roomId, { claimedCards });
    } catch (e) {
      console.error("⚠️ setClaimedCards Redis error:", e);
    }
  }

  // Claim a card in Redis (non-auto only)
  async claimCard(roomId, cardId, userId, extras = {}) {
    try {
      const claimedCards = await this.getClaimedCards(roomId);
      claimedCards[cardId] = {
        claimed: true,
        claimedBy: userId,
        claimedAt: Date.now(),
        auto: extras.auto || false,
        autoUntil: extras.autoUntil || null,
      };
      await this.setClaimedCards(roomId, claimedCards);
    } catch (e) {
      console.error("⚠️ claimCard Redis error:", e);
    }
  }

  // Unclaim a card in Redis (non-auto only)
  async unclaimCard(roomId, cardId) {
    try {
      const claimedCards = await this.getClaimedCards(roomId);
      delete claimedCards[cardId];
      await this.setClaimedCards(roomId, claimedCards);
    } catch (e) {
      console.error("⚠️ unclaimCard Redis error:", e);
    }
  }

  async setCardAutoState(roomId, cardId, options = {}) {
    try {
      const claimedCards = await this.getClaimedCards(roomId);
      if (!claimedCards[cardId]) {
        console.warn(`setCardAutoState: card ${cardId} not claimed in room ${roomId}`);
        return { success: false, message: "Card not claimed" };
      }
      claimedCards[cardId] = {
        ...claimedCards[cardId],
        auto: !!options.auto,
        autoUntil: options.auto ? options.autoUntil || Date.now() + 24 * 60 * 60 * 1000 : null,
      };
      await this.setClaimedCards(roomId, claimedCards);
      return { success: true };
    } catch (e) {
      console.error("⚠️ setCardAutoState error:", e);
      return { success: false, message: "Server error" };
    }
  }

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

  async getMultiWinStats() {
    try {
      const raw = await redis.get("global:multiWinStats");
      return raw ? JSON.parse(raw) : { lastMultiGame: 0, gameCount: 0 };
    } catch (e) {
      console.error("⚠️ getMultiWinStats error:", e);
      return { lastMultiGame: 0, gameCount: 0 };
    }
  }

  async setMultiWinStats(stats) {
    try {
      await redis.set("global:multiWinStats", JSON.stringify(stats));
    } catch (e) {
      console.error("⚠️ setMultiWinStats error:", e);
    }
  }

  async reshuffleDemoAutoPlayers(roomId, baseRoom = null) {
    try {
      const roomConfig = baseRoom || (await this.getRoomConfig(roomId)) || {};
      const players = await this.getRoomPlayers(roomId);
      const claimedCards = await this.getClaimedCards(roomId);
      const bingoCards = roomConfig.bingoCards || {};

      const demoPlayers = Object.entries(players).filter(([id, p]) =>
        (p?.telegramId || id)?.toLowerCase().startsWith("demo")
      );
      if (demoPlayers.length === 0) return { done: false, reason: "no-demo" };
      const demoIds = new Set(demoPlayers.map(([id]) => id));

      const demoClaimedCards = Object.entries(claimedCards)
        .filter(
          ([, card]) =>
            card?.claimed &&
            card?.auto &&
            card?.claimedBy &&
            demoIds.has(card.claimedBy)
        )
        .map(([cardId, card]) => ({ cardId, ...card }));

      if (demoClaimedCards.length === 0) {
        return { done: false, reason: "none" };
      }

      const unclaimedPool = Object.keys(bingoCards).filter(
        (cardId) => !claimedCards[cardId]?.claimed
      );
      if (unclaimedPool.length === 0) {
        return { done: false, reason: "no-unclaimed" };
      }

      const numToReshuffle = Math.min(3, demoClaimedCards.length);
      const selected = demoClaimedCards
        .sort(() => 0.8 - Math.random())
        .slice(0, numToReshuffle);

      for (const card of selected) {
        const demoId = card.claimedBy;
        const username = players[demoId]?.username || `demo_${demoId}`;

        await this.unclaimCard(roomId, card.cardId);
        await this.removeRoomPlayer(roomId, demoId);

        if (unclaimedPool.length === 0) break;
        const randomIndex = Math.floor(Math.random() * unclaimedPool.length);
        const newCardId = unclaimedPool.splice(randomIndex, 1)[0];
        if (!newCardId) continue;

        await this.claimCard(roomId, newCardId, demoId, {
          auto: true,
          autoUntil: Date.now() + 24 * 60 * 60 * 1000,
        });

        await this.addRoomPlayer(roomId, demoId, {
          telegramId: demoId,
          username,
          betAmount: roomConfig.betAmount || 0,
          cardId: newCardId,
          attemptedBingo: false,
        });
      }

      return { done: true };
    } catch (err) {
      console.error(`❌ Demo reshuffle error for ${roomId}:`, err);
      return { done: false, reason: "error", err };
    }
  }

  /**
   * Place bet: record player + claimed card in Redis only.
   * RTDB is used only to read permanent room/card data and financial operations elsewhere.
   */
  async placeBet(roomId, cardId, user) {
    try {
      const room = await this.getRoomConfig(roomId);
      if (!room) {
        return { success: false, message: "Room not found" };
      }
      const betAmount = room.betAmount || 0;

      // Basic validation
      if (!room.bingoCards || !room.bingoCards[cardId]) {
        return { success: false, message: "Invalid card" };
      }

      // Auto cards remain in RTDB; Redis only tracks per-game manual claims
      const existingClaims = await this.getClaimedCards(roomId);
      if (existingClaims[cardId]?.claimed) {
        return { success: false, message: "Card already claimed" };
      }

      const playerId = user.telegramId;
      const players = await this.getRoomPlayers(roomId);

      // If player already has a bet, prevent double-bet for now
      if (players[playerId]?.betAmount && players[playerId].betAmount > 0) {
        return { success: false, message: "Bet already placed" };
      }

      // Record in Redis
      await this.claimCard(roomId, cardId, playerId);
      await this.addRoomPlayer(roomId, playerId, {
        telegramId: playerId,
        username: user.username,
        betAmount,
        cardId,
        attemptedBingo: false,
      });

      // Notify clients in this room
      if (this.io) {
        this.io.to(roomId).emit("playerBetPlaced", {
          roomId,
          playerId,
          cardId,
          betAmount,
          username: user.username,
        });
      }

      return { success: true };
    } catch (e) {
      console.error("❌ placeBet error:", e);
      return { success: false, message: "Server error" };
    }
  }

  async cancelBetForPlayer(roomId, cardId, playerId) {
    try {
      await this.unclaimCard(roomId, cardId);
      await this.removeRoomPlayer(roomId, playerId);

      if (this.io) {
        this.io.to(roomId).emit("playerBetCancelled", {
          roomId,
          playerId,
          cardId,
        });
      }

      return { success: true };
    } catch (e) {
      console.error("❌ cancelBetForPlayer error:", e);
      return { success: false, message: "Server error" };
    }
  }

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
  async startCountdown(room, roomId, players, durationMs = 30000, startedBy = "auto") {
    try {
      console.log(`🎮 Room ${roomId} snapshot received for countdown`);

      // --- Basic validations ---
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

      // --- Start countdown in Redis (ephemeral room state) ---
      await this.setRoomState(roomId, {
        roomStatus: "countdown",
        countdownEndAt,
        countdownStartedBy: startedBy,
      });
      console.log(`⏳ Countdown started for room ${roomId} (${durationMs / 1000}s)`);

      // --- Start countdown timer to auto-start game ---
      if (this.countdownTimers.has(roomId)) clearTimeout(this.countdownTimers.get(roomId));
      const tid = setTimeout(async () => {
        try {
          const latest = await this.getRoomState(roomId);
          if (latest?.roomStatus === "countdown") {
            console.log(`🎮 Countdown ended → starting game for room ${roomId}`);
            await this.startGame(roomId, latest);
          } else {
            console.log(`⚠️ Skipping startGame for room ${roomId}, state changed to ${latest?.roomStatus}`);
          }
        } catch (err) {
          console.error(`❌ Auto startGame error for room ${roomId}:`, err);
        } finally {
          this.countdownTimers.delete(roomId);
        }
      }, durationMs);
      this.countdownTimers.set(roomId, tid);

      if (this.io) this.io.to(roomId).emit("countdownStarted", { roomId, countdownEndAt });



      const reshuffleResult = await this.reshuffleDemoAutoPlayers(roomId, room);
      if (!reshuffleResult.done) {
        console.log(`ℹ️ Demo reshuffle for ${roomId} did not complete:`, reshuffleResult.reason || reshuffleResult);
      }
      console.log(`🔄 Reshuffle result for ${roomId}:`, reshuffleResult);
      // --- Return countdown info ---
      return { success: true, countdownEndAt };
    } catch (err) {
      console.error(`❌ Error starting countdown for room ${roomId}:`, err);
      return { success: false, message: "Server error" };
    }
  }








  async cancelCountdown(roomId) {
    try {
      if (this.countdownTimers.has(roomId)) {
        clearTimeout(this.countdownTimers.get(roomId));
        this.countdownTimers.delete(roomId);
      }
      await this.setRoomState(roomId, {
        roomStatus: "waiting",
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


  // Start a new game
  async startGame(roomId) {
    console.log("➡️ startGame(): entered for", roomId);

    try {
      const roomConfig = await this.getRoomConfig(roomId);
      if (!roomConfig) {
        console.log("❌ startGame(): room not found");
        return { success: false, message: "Room not found" };
      }
      const runtime = (await this.getRoomState(roomId)) || {};
      const players = runtime.players || {};
      const claimedCards = runtime.claimedCards || {};
      const bingoCards = this.hydrateCards(
        roomConfig.bingoCards || {},
        claimedCards
      );
      const room = {
        ...roomConfig,
        ...runtime,
        players,
        bingoCards,
      };
      console.log("🧩 Room data:", {
        status: room.roomStatus || room.gameStatus,
        players: Object.keys(room.players || {}).length,
        cards: Object.keys(room.bingoCards || {}).length,
      });

      const currentStatus = room.roomStatus || room.gameStatus;

      if (currentStatus !== "countdown") {
        console.log("⚠️ Room not in countdown, aborting startGame()");
        return { success: false, message: "Room not in countdown state" };
      }

      // Generate a new gameId
      const gameId = uuidv4();
      console.log("🎲 New gameId:", gameId);

      await this.setRoomState(roomId, {
        roomStatus: "playing",
        currentGameId: gameId,
        calledNumbers: [],
        countdownEndAt: null,
        countdownStartedBy: null,
      });

      // ✅ Prepare players
     // ✅ Prepare players with valid cards
// --- Prepare cards from players ---
const allPlayers = Object.entries(room.players || {});
const validPlayers = allPlayers.filter(
  ([pid, p]) => p?.cardId && room.bingoCards?.[p.cardId]
);

if (validPlayers.length < 2) {
  console.log(`❌ Not enough valid players with cards: ${validPlayers.length}`);
  return { success: false, message: "Not enough valid players with cards" };
}

const cards = validPlayers.map(([pid, p]) => ({
  id: p.cardId,
  ...room.bingoCards[p.cardId],
}));
console.log(`cards${cards}`)
// --- Generate drawn numbers ---
console.log(`🎰 Generating drawn numbers for ${cards.length} cards...`);
const { drawnNumbers, winners } =  await this.generateDrawnNumbersMultiWinner(roomId,cards);

if (!drawnNumbers || drawnNumbers.length === 0) {
  console.error(`❌ Invalid drawnNumbers generated for room ${roomId}`);
  await this.setRoomState(roomId, { roomStatus: "waiting", currentGameId: null });
  return { success: false, message: "No valid drawn numbers generated" };
}

console.log(`✅ Generated ${drawnNumbers.length} numbers, winners: ${winners}`);

// ✅ Construct game data
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
  totalPayout: Math.floor((validPlayers.length ) * (room.betAmount || 0) * 0.8 ),
  betsDeducted: false,
  winners: winners.map((cardId) => ({
    id: uuidv4(),
    cardId,
    userId: room.bingoCards[cardId]?.claimedBy,
    username: room.players[room.bingoCards[cardId]?.claimedBy]?.username || "Unknown",
    checked: false,
  })),
  
  gameStatus: "playing",
};
      console.log("💾 Writing full game data to Redis (ephemeral)...");
      await this.setGameState(gameId, gameData);
      console.log("✅ Game data cached in Redis.");

      // ✅ Deduct player bets
      console.log("💰 Deducting bets...");
      await this.deductBets(roomId, gameData);
      console.log("✅ Bets deducted.");

      // ✅ Start number drawing
      console.log("🎯 Starting number drawing...");
      await this.lockRoom(roomId, async () => {
        this.startNumberDrawing(roomId, gameId);
      });


      console.log("✅ Number drawing started.");

      // ✅ Notify clients
      if (this.io) {
        this.io.to(roomId).emit("gameStarted", { roomId, gameId });
        console.log("📡 Emitted 'gameStarted' to clients");
      }

      console.log("🏁 startGame(): completed successfully for", roomId);
      return { success: true, gameId };
    } catch (error) {
      console.error("💥 Error in startGame():", error);
      return { success: false, message: error.message };
    }
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
  startNumberDrawing(roomId, gameId, room) {
    if (this.numberDrawIntervals.has(roomId)) {

      if (room.gameStatus !== "playing") {
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
          this.endGame(roomId, gameId, "allNumbersDrawn");
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
          const roomData = await this.getFullRoom(roomId);
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

  // Stop number drawing

  // 🧮 Collect demo balances and distribute to real players before reset
  



  // End game
  async endGame(roomId, gameId, reason = "manual") {
      const nextGameCountdownMs = 3000; // 5 seconds before reset
    const nextGameCountdownEndAt = Date.now() + nextGameCountdownMs;

    try {
      // Stop drawing numbers and cleanup
      this.stopNumberDrawing(roomId);

      // Clear countdown timer if active
      if (this.countdownTimers.has(roomId)) {
        clearTimeout(this.countdownTimers.get(roomId));
        this.countdownTimers.delete(roomId);
      }

      // Clear previous reset timer if active
      if (this.resetRoomTimers.has(roomId)) {
        clearTimeout(this.resetRoomTimers.get(roomId));
        this.resetRoomTimers.delete(roomId);
      }

      // Schedule room reset after 5 seconds
      const resetTimer = setTimeout(async () => {
        try {
          await this.lockRoom(roomId, async () => {
            await this.resetRoom(roomId);
          });

        } catch (e) {
          console.error("Error in scheduled resetRoom:", e);
        } finally {
          this.resetRoomTimers.delete(roomId);
        }
      }, nextGameCountdownMs);

      this.resetRoomTimers.set(roomId, resetTimer);

      // Fetch game data from Redis
      const gameData = await this.getGameState(gameId);
      if (!gameData) return;

      // ✅ Get current room state to check if already paid
      const currentRoomState = await this.getRoomState(roomId);
      const alreadyPaid = currentRoomState?.payed === true;

      await this.setRoomState(roomId, {
        roomStatus: "ended",
        nextGameCountdownEndAt,
        countdownEndAt: null,
        countdownStartedBy: null,
      });

      // ✅ Only process winners if not already paid (bingo winner was already paid in checkBingo)
      if (!alreadyPaid) {
        const hasConfirmedWinner = !!gameData.winner || (gameData.winners && gameData.winners.length > 0);
        if (reason === "allNumbersDrawn" && !hasConfirmedWinner) {
          // No winner - record revenue
          const { winners, totalPayout, id } = gameData;
      console.log(`REVENUE ADDING ***** winners=${JSON.stringify(winners)}, totalPayout=${totalPayout}, id=${id}`);

      const revenue = Math.floor((totalPayout || 0) * 1.25);

      await this.saveRevenueEntry(id, roomId, revenue);

          await this.setRoomState(roomId, {
            winner: null,
            payout: gameData.totalPayout || 0,
            payed: true,
          });
        } else if (gameData.winners && gameData.winners.length > 0 && reason !== "bingo") {
          console.log("oricesswininer sstart")
          // Multi-winner case (if not already handled in checkBingo)
          await this.processWinners(roomId, gameData);
        }
      }

      // Notify connected clients
      if (this.io) {
        this.io.to(roomId).emit("gameEnded", {
          roomId,
          gameId,
          reason,
          winners: gameData.winners || [],
          nextGameCountdownEndAt,
        });
      }

      // Clean up per-game Redis state
      try {
        await redis.del(`game:${gameId}`);
      } catch (e) {
        console.error(`⚠️ Failed to delete game state for ${gameId} from Redis:`, e);
      }

      console.log(`🔚 Game ended in room ${roomId}: ${reason}. Room will reset in 5s.`);
    } catch (error) {
      console.error("Error ending game:", error);
    }
  }


  // Process winners and payouts
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
 
  
  // Check bingo claim
  async checkBingo(roomId, cardId, userId, pattern) {
    try {
      const room = await this.getFullRoom(roomId);
      if (!room || (room.roomStatus || room.gameStatus) !== "playing") {
        return { success: false, message: "Game not in playing state" };
      }
  
      const players = room.players || {};
      const player = players[userId];
  
      if (player?.attemptedBingo) {
        return { success: false, message: "Already attempted bingo" };
      }
  
      const valid = this.validateBingoPattern(
        cardId,
        room,
        pattern,
        room.calledNumbers || []
      );
  
      if (!valid) {
        await this.updateRoomPlayer(roomId, userId, { attemptedBingo: true });
        return { success: false, message: "Invalid bingo pattern" };
      }
  
      // ✅ STOP NUMBER DRAWING IMMEDIATELY
      this.stopNumberDrawing(roomId);
  
      // ⭕ If valid — we immediately end the game with this single winner
      const gameId = room.currentGameId;
      let gameData = await this.getGameState(gameId);
  
      if (!gameData) {
        return { success: false, message: "Game not found" };
      }
  
      // Compute payout
      const totalPlayers = Object.keys(players).length;
      const bet = room.betAmount || 0;
      const totalPayout = Math.floor(totalPlayers * bet * 0.8);
  
      // ✅ Update game state with winner BEFORE endGame
      gameData.winners = [{
        id: uuidv4(),
        cardId,
        userId,
        username: player?.username || "Unknown",
        checked: true,
      }];
      gameData.totalPayout = totalPayout;
      gameData.winner = userId;
      await this.setGameState(gameId, gameData);
  
      await this.saveRevenueEntry(gameId, roomId, Math.floor((totalPayout || 0) / 4));

      // ✅ Apply payout (batched)
      await this.applyBalanceAdjustments({
        [userId]: totalPayout,
      });
  
      // ✅ Update room state with winner info
      await this.setRoomState(roomId, {
        winner: userId,
        winners: [userId],
        payout: totalPayout,
        payed: true,
      });
  
      // ✅ Notify UI with correct payload structure
      if (this.io) {
        this.io.to(roomId).emit("winnerConfirmed", {
          roomId,
          gameId,
          userId,
          cardId,
          patternIndices: pattern,
          payout: totalPayout,
        });
      }
  
      // Mark this player as having attempted (prevents double-claim spam)
      await this.updateRoomPlayer(roomId, userId, { attemptedBingo: true });

      // ✅ End the game (this will emit gameEnded and schedule reset)
      await this.endGame(roomId, gameId, "bingo");
  
      return {
        success: true,
        isWinner: true,
        payout: totalPayout,
        winner: userId,
        cardId,
      };
  
    } catch (e) {
      console.error("checkBingo error:", e);
      return { success: false, message: "Server error" };
    }
  }
  
  


  // Validate bingo pattern
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
  async deductBets(roomId, gameData) {
    try {
      const roomConfig = await this.getRoomConfig(roomId);
      const players = await this.getRoomPlayers(roomId);
      if (!roomConfig || !players) return;
  
      const betAmount = roomConfig.betAmount || 0;
      const adjustments = {};
      const updates = {}; // will store gamesPlayed increments
  
      for (const playerId of Object.keys(players)) {
        const player = players[playerId];
  
        // Skip demo players
        if (!player || player.isDemo) continue;
  
        // Deduct bet
        adjustments[playerId] = (adjustments[playerId] || 0) - betAmount;
  
        // Increase games played
        updates[playerId] = {
          gamesPlayed: (player.gamesPlayed || 0) + 1,
        };
      }
  
      // Apply balance deductions
      await this.applyBalanceAdjustments(adjustments);
  
      // Apply gamesPlayed increments
      for (const playerId of Object.keys(updates)) {
        await update(ref(rtdb, `users/${playerId}`), updates[playerId]);
      }
  
      // Mark bets as deducted
      const storedGame = await this.getGameState(gameData.id);
      if (storedGame) {
        storedGame.betsDeducted = true;
        await this.setGameState(gameData.id, storedGame);
      }
  
    } catch (error) {
      console.error("Error deducting bets:", error);
    }
  }
  

  async generateDrawnNumbersMultiWinner(roomId, cards = []) {

    try {
      const winners = [];
      const usedNumbers = new Set();
      const drawnNumbers = [];

      // --- Validate cards ---
      if (!Array.isArray(cards) || cards.length === 0) {
        console.warn(`⚠️ No cards found for room ${roomId}`);
        return { drawnNumbers: [], winners: [] };
      }

      // --- Valid cards ---
      const validCards = cards.filter(c => c && Array.isArray(c.numbers) && c.claimedBy);
      if (validCards.length === 0) {
        console.warn(`⚠️ No valid cards for room ${roomId}`);
        return { drawnNumbers: [], winners: [] };
      }

      // --- Recent winners memory map ---
      if (!this.recentWinnersByRoom) this.recentWinnersByRoom = new Map();
      if (!this.recentWinnersByRoom.has(roomId)) this.recentWinnersByRoom.set(roomId, []);

      const recentWinners = this.recentWinnersByRoom.get(roomId);
      const playerIds = [...new Set(validCards.map(c => c.claimedBy))];
      const playerCount = playerIds.length;
      const cooldown = Math.max(1, Math.floor(playerCount / 2));

      // --- Pick eligible winners ---
      // ------------------------
// DEMO > NORMAL RULE LOGIC
// ------------------------

// Count demo vs normal players
const demoCards = validCards.filter(c => c.claimedBy.startsWith("demo"));
const normalCards = validCards.filter(c => !c.claimedBy.startsWith("demo"));

const demoCount = demoCards.length;
const normalCount = normalCards.length;

// If demo > normal, apply 5-game requirement
let eligibleCards = validCards.filter(c => !recentWinners.includes(c.claimedBy));

if (demoCount > normalCount) {
  console.log("🟡 Demo players > Normal players → enforcing 5-game minimum");

  // Get user data (from cache or DB)
  // if you already have players loaded elsewhere, use that instead
  const playersData = await this.getRoomPlayers(roomId); // or wherever user data is stored

  eligibleCards = eligibleCards.filter(card => {
    const userId = card.claimedBy;

    // demo cards are always allowed
    if (userId.startsWith("demo")) return true;

    const player = playersData[userId];
    const gamesPlayed = player?.gamesPlayed || 0;

    return gamesPlayed >= 5; // enforce rule
  });
}

// If no eligible users remain, fallback to ANY valid non-cooldown card
if (eligibleCards.length === 0) {
  console.log("⚠️ No players meet 5-game rule → falling back to all valid cards");
  eligibleCards = validCards.filter(c => !recentWinners.includes(c.claimedBy));
}

      let winnerCard;

      if (eligibleCards.length === 0) {
        console.log(`♻️ All players on cooldown in ${roomId}, resetting`);
        winnerCard = validCards[Math.floor(Math.random() * validCards.length)];
        this.recentWinnersByRoom.set(roomId, []);
      } else {
        winnerCard = eligibleCards[Math.floor(Math.random() * eligibleCards.length)];
      }

      if (!winnerCard) {
        console.error(`❌ No winnerCard selected for room ${roomId}`);
        return { drawnNumbers: [], winners: [] };
      }

      const newWinnerUserId = winnerCard.claimedBy;

      // --- Get winning pattern ---
      const winnerPatterns = this.pickPatternNumbers(winnerCard) || [];
      const winnerPattern = winnerPatterns[Math.floor(Math.random() * winnerPatterns.length)] || [];
      if (!Array.isArray(winnerPattern) || winnerPattern.length === 0) {
        console.error(`❌ Invalid winner pattern for room ${roomId}`);
        return { drawnNumbers: [], winners: [] };
      }

      // --- Winner's pattern numbers in first 25 ---
      for (const n of winnerPattern) {
        if (n > 0 && n <= 75 && !usedNumbers.has(n)) {
          usedNumbers.add(n);
          drawnNumbers.push(n);
        }
      }

      // --- Losers: one missing number ---
      const loserMissingNumbers = [];
      for (const card of validCards) {
        if (card.id === winnerCard.id) continue;
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

      // --- Fill remaining to 25 numbers ---
      let safety = 0;
      while (drawnNumbers.length < 25 && safety++ < 500) {
        const rand = Math.floor(Math.random() * 75) + 1;
        if (!usedNumbers.has(rand)) {
          usedNumbers.add(rand);
          drawnNumbers.push(rand);
        }
      }



      const first25 = this.shuffleArray(drawnNumbers.slice(0, 25));

      // --- Fill rest to 75 ---
      const after25 = [];
      for (const n of loserMissingNumbers) {
        if (n > 0 && n <= 75 && !usedNumbers.has(n)) {
          usedNumbers.add(n);
          after25.push(n);
        }
      }
      let safety2 = 0;
      while (after25.length + first25.length < 75 && safety2++ < 500) {
        const rand = Math.floor(Math.random() * 75) + 1;
        if (!usedNumbers.has(rand)) {
          usedNumbers.add(rand);
          after25.push(rand);
        }
      }


      const finalDrawn = [...first25, ...this.shuffleArray(after25)];

      // --- Update cooldown history ---
      const updated = [...recentWinners, newWinnerUserId];
      if (updated.length > cooldown) updated.splice(0, updated.length - cooldown);
      this.recentWinnersByRoom.set(roomId, updated);

      console.log(
        `🏆 Winner ${newWinnerUserId} in ${roomId} | Cooldown=${cooldown} | Recent=[${updated.join(", ")}]`
      );

      winners.push(winnerCard.id);
      return { drawnNumbers: finalDrawn, winners };
    } catch (err) {
      console.error(`❌ Error in generateDrawnNumbersMultiWinner for ${roomId}:`, err);
      // Always return safe structure
      return { drawnNumbers: [], winners: [] };
    }
  }






  // Pick winning patterns from a card
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

  // Shuffle array
  shuffleArray(array) {
    const arr = array.slice();
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // Reset room for next game
  async resetRoom(roomId) {
    try {
      if (this.resetRoomTimers && this.resetRoomTimers.has(roomId)) {
        clearTimeout(this.resetRoomTimers.get(roomId));
        this.resetRoomTimers.delete(roomId);
      }
      if (this.countdownTimers && this.countdownTimers.has(roomId)) {
        clearTimeout(this.countdownTimers.get(roomId));
        this.countdownTimers.delete(roomId);
      }

      const roomConfig = await this.getRoomConfig(roomId);
      if (!roomConfig) {
        console.error(`❌ Room ${roomId} not found`);
        return;
      }

      const betAmount = roomConfig.betAmount || 0;
      const players = await this.getRoomPlayers(roomId);
      const claimedCards = await this.getClaimedCards(roomId);
      const keepPlayers = new Set();

      for (const [cardId, card] of Object.entries(claimedCards)) {
        if (!card?.claimed) continue;
        const claimedBy = card.claimedBy;
        let keepClaimed = false;
        if (claimedBy && card.auto) {
          const autoUntil = card.autoUntil || 0;
          const balanceSnap = await get(
            ref(rtdb, `users/${claimedBy}/balance`)
          );
          const balance = balanceSnap.val() || 0;
          const autoActive =
            autoUntil > Date.now() &&
            autoUntil - Date.now() <= 24 * 60 * 60 * 1000;
          const hasEnoughBalance = balance >= betAmount;
          if (autoActive && hasEnoughBalance) {
            await this.updateRoomPlayer(roomId, claimedBy, {
              attemptedBingo: false,
            });
            keepClaimed = true;
            keepPlayers.add(claimedBy);
          }
        }
        if (!keepClaimed) {
          await this.unclaimCard(roomId, cardId);
        }
      }

      for (const playerId of Object.keys(players)) {
        if (!keepPlayers.has(playerId)) {
          await this.removeRoomPlayer(roomId, playerId);
        }
      }

      await this.setRoomState(roomId, {
        roomStatus: "waiting",
        currentGameId: null,
        calledNumbers: [],
        countdownEndAt: null,
        nextGameCountdownEndAt: null,
        winner: null,
        payout: null,
        payed: false,
      });

      if (this.io) {
        this.io.to(roomId).emit("roomReset", { roomId });
      }

      console.log(
        `♻️ Room ${roomId} reset for next game (kept ${keepPlayers.size} players with valid auto-bet & balance)`
      );
    } catch (error) {
      console.error("Error resetting room:", error);
    }
  }


}

// Export both the class and singleton instance
export default GameManager;
export const gameManager = GameManager.getInstance();
