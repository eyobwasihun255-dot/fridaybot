import { rtdb } from "../bot/firebaseConfig.js";
import { ref, get, set, update, runTransaction } from "firebase/database";
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
  async claimCard(roomId, cardId, userId) {
    try {
      const claimedCards = await this.getClaimedCards(roomId);
      claimedCards[cardId] = { claimed: true, claimedBy: userId, claimedAt: Date.now() };
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



      const performDemoReshuffle = async () => {
        const STOP_THRESHOLD_MS = 2000;
        const INTERVAL_MS = 400; // delay between demo reshuffles

        try {
          const snap = await get(roomRef);
          const current = snap.val();
          if (!current) {
            console.log(`⚠️ No room data for ${roomId}`);
            return { done: false, reason: "no-room" };
          }

          let cards = current.bingoCards || {};
          let players = current.players || {};

          // 1️⃣ Identify demo players currently having auto-claimed cards
          const demoPlayers = Object.entries(players)
            .filter(([_, p]) => p?.telegramId?.toLowerCase().startsWith("demo"))
            .map(([id, p]) => ({ id, ...p }));

          const demoCards = Object.entries(cards)
            .filter(([_, c]) => c?.claimed && c?.auto && c?.claimedBy)
            .filter(([_, c]) => demoPlayers.some(dp => dp.id === c.claimedBy))
            .map(([id, c]) => ({ id, ...c }));

          if (demoCards.length === 0) {
            console.log(`⚠️ No demo players with auto-claimed cards to reshuffle in ${roomId}`);
            return { done: false, reason: "none" };
          }

          // 2️⃣ Select a few demo players to reshuffle
          const numToReshuffle = Math.min(3, demoCards.length);
          const selected = demoCards
            .sort(() => 0.5 - Math.random())
            .slice(0, numToReshuffle);

          console.log(`🎲 Selected ${selected.length} demo players to reshuffle:`, selected.map(d => d.claimedBy));

          // Helper delay function
          const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

          // 3️⃣ Process each demo player one-by-one
          for (const demo of selected) {
            const demoId = demo.claimedBy;
            const oldCardId = demo.id;

            console.log(`♻️ Reshuffling demo player: ${demoId}`);

            // 🔹 Step 1: Unclaim old card
            if (cards[oldCardId]) {
              cards[oldCardId] = {
                ...cards[oldCardId],
                claimed: false,
                claimedBy: null,
                auto: false,
                autoUntil: null,
              };
            }
            const username = players[demoId].username
            // 🔹 Step 2: Temporarily remove demo player from the room
            delete players[demoId];

            // 🔹 Step 3: Pick a random new unclaimed card
            const unclaimedList = Object.entries(cards)
              .filter(([_, c]) => !c.claimed)
              .map(([id, c]) => ({ id, ...c }));

            if (unclaimedList.length === 0) {
              console.log(`⚠️ No unclaimed cards available for demo ${demoId}`);
              continue;
            }

            const newCard = unclaimedList[Math.floor(Math.random() * unclaimedList.length)];

            // 🔹 Step 4: Claim the new card
            cards[newCard.id] = {
              ...cards[newCard.id],
              claimed: true,
              claimedBy: demoId,
              auto: true,
              autoUntil: Date.now() + 24 * 60 * 60 * 1000,

            };

            // 🔹 Step 5: Re-add demo player to the room with updated card
            const oldInfo = current.players?.[demoId] || {};
            players[demoId] = {
              ...oldInfo,
              cardId: newCard.id,
              attemptedBingo: false,
              betAmount: current.betAmount,
              telegramId: demoId,
              username: username,
            };

            console.log(`✅ Demo ${demoId} moved from ${oldCardId} → ${newCard.id}`);

            // 🔹 Step 6: Update RTDB incrementally (after each demo reshuffle)
            await update(roomRef, {
              bingoCards: cards,
              players: players,
            });

            // 🔹 Step 7: Wait before next reshuffle
            await delay(INTERVAL_MS);
          }

          console.log(`🎯 Demo reshuffle complete for ${roomId}`);
          return { done: true };

        } catch (err) {
          console.error(`❌ Demo reshuffle error for ${roomId}:`, err);
          return { done: false, reason: "error", err };
        }
      };





      // Kick off the demo reshuffle but ensure it completes before countdownEndAt - STOP_THRESHOLD_MS
      // We'll await it now (synchronous for the rest of the function) so it stops before return.
      // If you prefer this to run in background, remove the await and handle cancellations differently.
      const reshuffleResult = await performDemoReshuffle();
      if (!reshuffleResult.done) {
        console.log(`ℹ️ Demo reshuffle for ${roomId} did not complete:`, reshuffleResult.reason || reshuffleResult);
      }

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
      const roomRef = ref(rtdb, `rooms/${roomId}`);
      const roomSnap = await get(roomRef);
      console.log("✅ startGame(): roomSnap fetched");

      if (!roomSnap.exists()) {
        console.log("❌ startGame(): room not found");
        return { success: false, message: "Room not found" };
      }

      const room = roomSnap.val();
      console.log("🧩 Room data:", {
        status: room.gameStatus,
        players: Object.keys(room.players || {}).length,
        cards: Object.keys(room.bingoCards || {}).length,
      });

      if (room.gameStatus !== "countdown") {
        console.log("⚠️ Room not in countdown, aborting startGame()");
        return { success: false, message: "Room not in countdown state" };
      }

      // Generate a new gameId
      const gameId = uuidv4();
      console.log("🎲 New gameId:", gameId);

      // ✅ Minimal RTDB snapshot for crash-safety
      console.log("✅ startGame(): writing minimal snapshot to RTDB");
      await set(ref(rtdb, `games/${gameId}`), {
        id: gameId,
        roomId,
        startedAt: Date.now(),
        status: "active",
        totalPayout: Math.floor(
          (Object.keys(room.players || {}).length - 1) *
            (room.betAmount || 0) *
            0.85 +
            (room.betAmount || 0)
        ),
      });

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
const { drawnNumbers, winners } = this.generateDrawnNumbersMultiWinner(roomId,cards);

if (!drawnNumbers || drawnNumbers.length === 0) {
  console.error(`❌ Invalid drawnNumbers generated for room ${roomId}`);
  await update(roomRef, { gameStatus: "waiting" });
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
  totalPayout: Math.floor((validPlayers.length - 1) * (room.betAmount || 0) * 0.85 + (room.betAmount || 0)),
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

        // Periodically sync a minimal snapshot back to RTDB for crash safety
        if ((currentNumberIndex + 1) % 10 === 0) {
          const gameRef = ref(rtdb, `games/${gameId}`);
          const lastTen = newDrawnNumbers.slice(-10);
          update(gameRef, {
            currentNumberIndex: currentNumberIndex + 1,
            lastDrawnNumbers: lastTen,
          }).catch(console.error);
        }

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
          const roomSnap = await get(ref(rtdb, `rooms/${roomId}`));
          const room = roomSnap.val() || {};
          const bingoCards = room.bingoCards || {};
          const calledSet = new Set(newDrawnNumbers);
          const patterns = this.generateValidPatterns();

          for (const [cardId, card] of Object.entries(bingoCards)) {
            if (!card?.auto) continue;
            const autoUntil = card.autoUntil || 0;
            if (autoUntil <= Date.now()) continue;
            if (!card.claimed || !card.claimedBy) continue;

            const flat = card.numbers.flat();

            // find first winning pattern
            let winningPattern = null;
            for (const pat of patterns) {
              const ok = pat.every((idx) => flat[idx] === 0 || calledSet.has(flat[idx]));
              if (ok) { winningPattern = pat; break; }
            }
            if (winningPattern) {
              // Trigger server bingo
              this.checkBingo(roomId, cardId, card.claimedBy, winningPattern, room, room.players[card.claimedBy]);
              break; // stop loop after first auto-winner
            }
          }
        } catch (e) {
          console.error('Auto-bingo error:', e);
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
  async distributeDemoBalances(roomId) {
    try {
      const usersRef = ref(rtdb, "users");
      const usersSnap = await get(usersRef);
      if (!usersSnap.exists()) {
        console.log("⚠️ No users found in database");
        return;
      }

      const users = usersSnap.val();

      // 🎯 1️⃣ Collect all global demo users with balance > 100
      const demoUsers = Object.entries(users)
        .filter(([_, u]) => u.telegramId?.startsWith("demo") && (u.balance || 0) > 50)
        .map(([id, u]) => ({ id, balance: u.balance || 0 }));

      if (demoUsers.length === 0) {
        console.log("⚠️ No demo users with balance > 100 found globally");
        return;
      }

      // 💰 2️⃣ Total up all demo balances
      const total = demoUsers.reduce((sum, u) => sum + u.balance, 0);

      // 🧹 3️⃣ Reset their balances to zero
      for (const demo of demoUsers) {
        await update(ref(rtdb, `users/${demo.id}`), { balance: 0 });
      }

      console.log(`♻️ Collected total demo pool: ${total} from ${demoUsers.length} demo users`);

      // 👥 4️⃣ Get all players in this room
      const playersSnap = await get(ref(rtdb, `rooms/${roomId}/players`));
      if (!playersSnap.exists()) {
        console.log("⚠️ No players in room");
        return;
      }

      const roomPlayers = playersSnap.val();

      // 🎯 5️⃣ Filter only demo players currently in the room
      const demoPlayersInRoom = Object.entries(roomPlayers)
        .filter(([pid, p]) => p.telegramId?.startsWith("demo"))
        .map(([pid]) => pid);

      if (demoPlayersInRoom.length === 0) {
        console.log("⚠️ No demo players found in this room to distribute to");
        return;
      }

      // 💸 6️⃣ Divide total equally among demo players in this room
      const perPlayer = Math.floor(total / demoPlayersInRoom.length);

      for (const pid of demoPlayersInRoom) {
        const balRef = ref(rtdb, `users/${pid}/balance`);
        await runTransaction(balRef, (current) => (current || 0) + perPlayer);
      }

      console.log(
        `💰 Distributed total ${total} equally (${perPlayer} each) among ${demoPlayersInRoom.length} demo players in room ${roomId}`
      );

    } catch (err) {
      console.error("❌ Error in distributeDemoBalances:", err);
    }
  }



  // End game
  async endGame(roomId, gameId, reason = "manual") {
    const roomRef = ref(rtdb, `rooms/${roomId}`);
    const nextGameCountdownMs = 3000; // 5 seconds before reset
    const nextGameCountdownEndAt = Date.now() + nextGameCountdownMs;

    try {
      // Stop drawing numbers and cleanup
      this.stopNumberDrawing(roomId);
      await this.distributeDemoBalances(roomId);

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

      // Fetch game data (prefer Redis, fall back to RTDB snapshot)
      let gameData = await this.getGameState(gameId);
      if (!gameData) {
      const gameRef = ref(rtdb, `games/${gameId}`);
      const gameSnap = await get(gameRef);
        gameData = gameSnap.val();
      }
      if (!gameData) return;

      // Mark game as ended
      await update(ref(rtdb, `games/${gameId}`), {
        status: "ended",
        endedAt: Date.now(),
        endReason: reason,
      });

      await this.setRoomState(roomId, {
        roomStatus: "ended",
        nextGameCountdownEndAt,
        countdownEndAt: null,
        countdownStartedBy: null,
      });

      // Handle payout or revenue recording
      const hasConfirmedWinner = !!gameData.winner;
      if (reason === "allNumbersDrawn" && !hasConfirmedWinner) {
        try {
          const revenueRef = ref(rtdb, `revenue/${gameId}`);
          await set(revenueRef, {
            gameId,
            roomId,
            datetime: Date.now(),
            amount: gameData.totalPayout || 0,
            drawned: false,
          });

          await update(roomRef, {
            winner: null,
            payout: gameData.totalPayout || 0,
            payed: true,
          });
        } catch (e) {
          console.error("Error recording revenue on no-winner case:", e);
        }
      } else if (gameData.winners && gameData.winners.length > 0) {
        this.processWinners(roomId, gameData);
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

      console.log(`🔚 Game ended in room ${roomId}: ${reason}. Room will reset in 5s.`);
    } catch (error) {
      console.error("Error ending game:", error);
    }
  }


  // Process winners and payouts
  async processWinners(roomId, gameData) {
    try {
      const { winners, totalPayout } = gameData;
      const payoutPerWinner = Math.floor(totalPayout / winners.length);

      // Get room data for revenue calculation
      const roomRef = ref(rtdb, `rooms/${roomId}`);
      const roomSnap = await get(roomRef);
      const room = roomSnap.val();

      for (const winner of winners) {
        if (winner.userId) {
          // Update user balance
          const userRef = ref(rtdb, `users/${winner.userId}`);
          await runTransaction(userRef, (currentBalance) => {
            return (currentBalance || 0) + payoutPerWinner;
          });

          // Record winning
          const winningRef = ref(rtdb, `winningHistory/${uuidv4()}`);
          await set(winningRef, {
            playerId: winner.userId,
            gameId: gameData.id,
            roomId,
            payout: payoutPerWinner,
            cardId: winner.cardId,
            date: Date.now()
          });
        }
      }

      // Calculate and record revenue
      if (room && winners.length > 0) {
        const playerCount = Object.keys(room.players || {}).length;
        const roomAmount = room.betAmount || 0;
        const totalBets = playerCount * roomAmount;
        const revenueAmount = totalBets - totalPayout;

        const revenueRef = ref(rtdb, `revenue/${gameData.id}`);
        await set(revenueRef, {
          gameId: gameData.id,
          roomId,
          datetime: Date.now(),
          amount: revenueAmount,
          drawned: false,
        });
      }

      // Update room with winner info
      update(roomRef, {
        winner: winners[0]?.userId,
        payout: totalPayout,
        payed: true
      });

      console.log(`🏆 Processed ${winners.length} winners in room ${roomId}`);
    } catch (error) {
      console.error("Error processing winners:", error);
    }
  }

  // Check bingo claim
  async checkBingo(roomId, cardId, userId, pattern, room, player) {
    try {
      if (!room || room.gameStatus !== "playing") {
        return { success: false, message: "Game not in playing state" };
      }
  
      if (player?.attemptedBingo) {
        return { success: false, message: "Already attempted bingo" };
      }
  
      const playerRef = ref(rtdb, `rooms/${roomId}/players/${userId}`);
  
      const isValidBingo = this.validateBingoPattern(
        cardId,
        room,
        pattern,
        room.calledNumbers
      );
  
      if (!isValidBingo) {
        update(playerRef, { attemptedBingo: true });
        return { success: false, message: "Invalid bingo pattern" };
      }
  
      // ✅ Calculate number of winners for this game
      const playerCount = Object.keys(room.players || {}).length;
      const multiWinDataRef = ref(rtdb, "global/multiWinStats");
      const multiWinDataSnap = await get(multiWinDataRef);
      const multiWinData = multiWinDataSnap.val() || { lastMultiGame: 0, gameCount: 0 };
  
      const currentGameNumber = multiWinData.gameCount + 1;
      const gamesSinceLastMulti = currentGameNumber - (multiWinData.lastMultiGame || 0);
  
      let winnerCount = 1;
      let forceMulti = false;
  
      if (playerCount > 180) {
        // 3 winners possible, with ~30% chance
        if (Math.random() < 0.3) winnerCount = 3;
        else if (Math.random() < 0.5) winnerCount = 2;
      } else if (playerCount > 80) {
        // 2 winners possible, with ~40% chance
        if (Math.random() < 0.4) winnerCount = 2;
      }
  
      // Force 2 winners if none occurred in last 5 games
      if (gamesSinceLastMulti >= 5 && winnerCount === 1) {
        winnerCount = 2;
        forceMulti = true;
      }
  
      // Update stats
      await set(multiWinDataRef, {
        gameCount: currentGameNumber,
        lastMultiGame: winnerCount > 1 ? currentGameNumber : multiWinData.lastMultiGame,
      });
  
      // ✅ Add this player as confirmed winner
      const gameRef = ref(rtdb, `games/${room.gameId}`);
      const existingWinnersSnap = await get(child(gameRef, "winnerList"));
      const existingWinners = existingWinnersSnap.val() || [];
  
      // If already enough winners, reject new ones
      if (existingWinners.length >= winnerCount) {
        return { success: false, message: "Winners already confirmed" };
      }
  
      // Add winner
      const newWinners = [...existingWinners, { userId, cardId, pattern }];
      await update(gameRef, { winnerList: newWinners });
  
      // ✅ If we reached the allowed winner count → proceed to payout
      if (newWinners.length === winnerCount) {
        const totalBets = playerCount * (room.betAmount || 0);
        const totalPayout = totalBets * 0.85;
        const payoutPerWinner = totalPayout / winnerCount;
        const revenueAmount = totalBets * 0.15;
  
        const roomRef = ref(rtdb, `rooms/${roomId}`);
  
        // Pay each winner
        for (const winner of newWinners) {
          const balanceRef = ref(rtdb, `users/${winner.userId}/balance`);
          await runTransaction(balanceRef, (current) => (current || 0) + payoutPerWinner);
  
          const winRef = ref(rtdb, `winningHistory/${uuidv4()}`);
          await set(winRef, {
            playerId: winner.userId,
            gameId: room.gameId,
            roomId,
            payout: payoutPerWinner,
            cardId: winner.cardId,
            date: Date.now(),
          });
        }
  
        // Log revenue
        const revenueRef = ref(rtdb, `revenue/${room.gameId}`);
        await set(revenueRef, {
          gameId: room.gameId,
          roomId,
          datetime: Date.now(),
          amount: revenueAmount,
          drawned: false,
        });
  
        // Update room
        update(roomRef, {
          winnerCount,
          winners: newWinners.map((w) => w.userId),
          payoutPerWinner,
          totalPayout,
          payed: true,
        });
  
        // Broadcast final results
        if (this.io) {
          this.io.to(roomId).emit("multiWinnersConfirmed", {
            roomId,
            gameId: room.gameId,
            winners: newWinners.map((w) => w.userId),
            count: winnerCount,
            message: `🎉 ${winnerCount} Winner${winnerCount > 1 ? "s" : ""}!`,
          });
        }
  
        await new Promise((res) => setTimeout(res, 800));
        this.endGame(roomId, room.gameId, "bingo");
      }
  
      return { success: true, message: `Bingo confirmed for ${userId}` };
    } catch (error) {
      console.error("Error checking bingo:", error);
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
      const roomRef = ref(rtdb, `rooms/${roomId}`);
      const roomSnap = await get(roomRef);
      const room = roomSnap.val();

      if (!room?.players) return;

      for (const playerId of Object.keys(room.players)) {
        const betAmount = room.betAmount || 0;
        const balanceRef = ref(rtdb, `users/${playerId}/balance`);

        // Deduct balance
        const snap = await get(balanceRef);
        const current = snap.val() || 0;
        await set(balanceRef, current - betAmount);


        // Record deduction
        const deductRef = ref(rtdb, `deductRdbs/${uuidv4()}`);
        await set(deductRef, {
          id: uuidv4(),
          username: room.players[playerId].username,
          userId: playerId,
          amount: betAmount,
          gameId: gameData.id,
          roomId,
          date: Date.now()
        });
      }

      update(ref(rtdb, `games/${gameData.id}`), { betsDeducted: true });
    } catch (error) {
      console.error("Error deducting bets:", error);
    }
  }

  generateDrawnNumbersMultiWinner(roomId, cards = []) {
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
      const eligibleCards = validCards.filter(c => !recentWinners.includes(c.claimedBy));
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
      // Clear any scheduled reset timer for this room
      if (this.resetRoomTimers && this.resetRoomTimers.has(roomId)) {
        clearTimeout(this.resetRoomTimers.get(roomId));
        this.resetRoomTimers.delete(roomId);
      }
      // Also clear any countdown timer if present
      if (this.countdownTimers && this.countdownTimers.has(roomId)) {
        clearTimeout(this.countdownTimers.get(roomId));
        this.countdownTimers.delete(roomId);
      }

      const roomRef = ref(rtdb, `rooms/${roomId}`);
      const snap = await get(roomRef);

      if (!snap.exists()) {
        console.error(`❌ Room ${roomId} not found`);
        return;
      }

      const room = snap.val() || {};
      const { bingoCards = {}, players = {}, betAmount = 0 } = room;

      // Track players that should be kept
      const keepPlayers = new Set();

      // First pass: check each card
      for (const [cardId, card] of Object.entries(bingoCards)) {
        const claimedBy = card.claimedBy;
        let keepClaimed = false;

        if (claimedBy && card?.auto === true) {
          const autoUntil = card?.autoUntil || 0;
          const balanceRef = ref(rtdb, `users/${claimedBy}/balance`);
          const balanceSnap = await get(balanceRef);
          const balance = balanceSnap.val() || 0;
          // ✅ keep only if auto is still active, less than 24h, and player has enough balance
          const autoActive = autoUntil > Date.now() && autoUntil - Date.now() <= 24 * 60 * 60 * 1000;
          const hasEnoughBalance = balance >= betAmount;

          if (autoActive && hasEnoughBalance) {
            const playerRef = ref(
              rtdb,
              `rooms/${roomId}/players/${claimedBy}`
            );
            update(playerRef, { attemptedBingo: false });
            keepClaimed = true;
            keepPlayers.add(claimedBy);
          }
        }

        if (!keepClaimed) {
          // Reset the card if not valid auto-bet
          update(ref(rtdb, `rooms/${roomId}/bingoCards/${cardId}`), {
            claimed: false,
            claimedBy: null,
            auto: false,
            autoUntil: null,
          });
        }
      }

      // Second pass: remove players not in keepPlayers
      for (const [playerId] of Object.entries(players)) {
        if (!keepPlayers.has(playerId)) {
          update(roomRef, {
            [`players/${playerId}`]: null
          });
        }
      }

      // Reset room state (RTDB minimal, Redis full runtime)
      await update(roomRef, {
        gameStatus: "waiting",
        gameId: null,
        winner: null,
        payout: null,
        payed: false,
        nextGameCountdownEndAt: null,
      });

      await this.setRoomState(roomId, {
        roomStatus: "waiting",
        currentGameId: null,
        calledNumbers: [],
        countdownEndAt: null,
        nextGameCountdownEndAt: null,
      });

      // Reset attemptedBingo for remaining players
      const updates = {};
      keepPlayers.forEach(pid => {
        updates[`players/${pid}/attemptedBingo`] = false;
      });
      if (Object.keys(updates).length > 0) {
        update(roomRef, updates);
      }

      // Notify clients
      if (this.io) {
        this.io.to(roomId).emit("roomReset", { roomId });
      }

      console.log(`♻️ Room ${roomId} reset for next game (kept ${keepPlayers.size} players with valid auto-bet & balance)`);
    } catch (error) {
      console.error("Error resetting room:", error);
    }
  }


}

// Export both the class and singleton instance
export default GameManager;
export const gameManager = GameManager.getInstance();
