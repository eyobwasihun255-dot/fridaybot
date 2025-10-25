import { rtdb } from "../bot/firebaseConfig.js";
import { ref, get, set, update, runTransaction, onValue } from "firebase/database";
import { platform } from "os";
import { v4 as uuidv4 } from "uuid";
class GameManager {
  constructor() {
    this.activeGames = new Map(); // roomId -> game data
    this.numberDrawIntervals = new Map(); // roomId -> interval ID
    this.countdownTimers = new Map(); // roomId -> timeout ID
    this.resetRoomTimers = new Map(); // roomId -> timeout ID for scheduled reset
    this.lastWinnerUserByRoom = new Map(); // roomId -> userId
    this.io = null; // Will be set when Socket.IO is initialized
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
  async startCountdown(room, roomId, players, durationMs = 28000, startedBy = "auto") {
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
      const roomRef = ref(rtdb, `rooms/${roomId}`);
  
      // --- Start countdown in Firebase ---
      await update(roomRef, {
        gameStatus: "countdown",
        countdownEndAt,
        countdownStartedBy: startedBy,
      });
      console.log(`⏳ Countdown started for room ${roomId} (${durationMs / 1000}s)`);
  
      // --- Start countdown timer to auto-start game ---
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
  
      // --- Start demo reshuffle (robust) ---
      // --- Start demo reshuffle sequentially ---
      (async () => {
        try {
          const cardsRef = ref(rtdb, `rooms/${roomId}/bingoCards`);
          const playersRef = ref(rtdb, `rooms/${roomId}/players`);
      
          // Fetch cards and players in parallel
          const [cardsSnap, playersSnap] = await Promise.all([get(cardsRef), get(playersRef)]);
          if (!cardsSnap.exists() || !playersSnap.exists()) {
            console.log(`⚠️ Missing cards or players for reshuffle in ${roomId}`);
            return;
          }
      
          const cards = cardsSnap.val();
          const playersData = playersSnap.val();
      
          // --- Step 1: Identify demo players ---
          const demoPlayers = Object.entries(playersData)
            .filter(([id]) => id.startsWith("demo"))
            .map(([id, p]) => ({ id, ...p }));
      
          if (demoPlayers.length === 0) {
            console.log(`ℹ️ No demo players found in room ${roomId}`);
            return;
          }
      
          // ⚙️ Limit to maximum of 10 demo reshuffles per run
          const limitedDemos = demoPlayers.slice(0, 10);
          console.log(`🎯 Reshuffling up to ${limitedDemos.length} demo players (of ${demoPlayers.length})`);
      
          // --- Step 2: Unclaim all demo-owned cards in one batch ---
          const unclaimUpdates = {};
          let unclaimedCount = 0;
      
          for (const [cardId, card] of Object.entries(cards)) {
            if (card?.claimed && card.claimedBy?.startsWith("demo")) {
              unclaimUpdates[`rooms/${roomId}/bingoCards/${cardId}/claimed`] = false;
              unclaimUpdates[`rooms/${roomId}/bingoCards/${cardId}/claimedBy`] = null;
              unclaimUpdates[`rooms/${roomId}/bingoCards/${cardId}/auto`] = false;
              unclaimUpdates[`rooms/${roomId}/bingoCards/${cardId}/autoUntil`] = null;
              unclaimedCount++;
            }
          }
      
          if (unclaimedCount > 0) {
            await update(ref(rtdb), unclaimUpdates);
            console.log(`✅ Unclaimed ${unclaimedCount} demo cards in ${roomId}`);
          }
      
          // --- Step 3: Get fresh unclaimed cards ---
          const refreshedSnap = await get(cardsRef);
          const refreshedCards = refreshedSnap.exists() ? refreshedSnap.val() : {};
          const unclaimed = Object.entries(refreshedCards).filter(([_, c]) => !c?.claimed);
      
          if (unclaimed.length === 0) {
            console.log(`⚠️ No unclaimed cards left in ${roomId}`);
            return;
          }
      
          // Shuffle both arrays
          const shuffledDemos = [...limitedDemos].sort(() => 0.5 - Math.random());
          const shuffledUnclaimed = [...unclaimed].sort(() => 0.5 - Math.random());
      
          const assignCount = Math.min(shuffledDemos.length, shuffledUnclaimed.length);
          const assignedPlayerUpdates = {};
          const cardClaimUpdates = {};
          const now = Date.now();
      
          // --- Step 4: Assign each demo one card safely ---
          for (let i = 0; i < assignCount; i++) {
            const demo = shuffledDemos[i];
            const [cardId, card] = shuffledUnclaimed[i];
            if (!cardId) continue;
      
            cardClaimUpdates[`rooms/${roomId}/bingoCards/${cardId}/claimed`] = true;
            cardClaimUpdates[`rooms/${roomId}/bingoCards/${cardId}/claimedBy`] = demo.id;
            cardClaimUpdates[`rooms/${roomId}/bingoCards/${cardId}/auto`] = true;
            cardClaimUpdates[`rooms/${roomId}/bingoCards/${cardId}/autoUntil`] = now + 24 * 60 * 60 * 1000;
      
            assignedPlayerUpdates[`rooms/${roomId}/players/${demo.id}/cardId`] = cardId;
            assignedPlayerUpdates[`rooms/${roomId}/players/${demo.id}/autoCardAssignedAt`] = now;
          }
      
          // --- Step 5: Apply all updates atomically ---
          const allUpdates = { ...cardClaimUpdates, ...assignedPlayerUpdates };
          if (Object.keys(allUpdates).length > 0) {
            await update(ref(rtdb), allUpdates);
            console.log(`✅ Assigned ${assignCount} demo players new cards (max 10 cap) in ${roomId}`);
          } else {
            console.log(`ℹ️ No demo card assignments made in ${roomId}`);
          }
        } catch (err) {
          console.error(`❌ Optimized demo reshuffle error in ${roomId}:`, err);
        }
      })();
      
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
      const roomRef = ref(rtdb, `rooms/${roomId}`);
      update(roomRef, {
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

  // Start a new game
  async startGame(roomId, room) {
    try {
      const roomRef = ref(rtdb, `rooms/${roomId}`);
      const roomSnap = await get(roomRef);
      const liveRoom = roomSnap.val();
if (!liveRoom || liveRoom.gameStatus !== "countdown") throw new Error("Room not in countdown state");


      const gameId = uuidv4();
      const playerIds = Object.keys(room.players || {}).filter(pid => {
        const player = room.players[pid];
        return player && player.cardId && room.bingoCards[player.cardId];
      });
      
      if (playerIds.length < 2) {
        console.log(`❌ Not enough valid players to start game in ${roomId}`);
        update(roomRef, { gameStatus: "waiting" });
        return;
      }
      
      // Generate drawn numbers and determine winners
      const cards = playerIds.map(pid => room.bingoCards[room.players[pid].cardId]);
      console.log("🧩 Checking players and cards for room", roomId);
for (const pid of playerIds) {
  const player = room.players[pid];
  if (!player) console.log("❌ Missing player entry for", pid);
  else if (!player.cardId) console.log("❌ Player", pid, "has no cardId");
  else if (!room.bingoCards[player.cardId]) console.log("❌ Card not found:", player.cardId);
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

      // Update room status
      await runTransaction(roomRef, (currentRoom) => {
        if (!currentRoom || currentRoom.gameStatus !== "countdown") return currentRoom;
        
        currentRoom.gameStatus = "playing";
        currentRoom.gameId = gameId;
        currentRoom.calledNumbers = [];
        currentRoom.countdownEndAt = null;
        currentRoom.countdownStartedBy = null;
        currentRoom.currentWinner = null;
        currentRoom.payed = false;
        
        return currentRoom;
      });

      // Deduct bets from players
      this.deductBets(roomId, gameData);

      // Save game data
      const gameRef = ref(rtdb, `games/${gameId}`);
      await set(gameRef, gameData);
      if (this.io) {
        this.io.to(roomId).emit('gameStarted', { roomId, gameId });
      }
     
      // Start number drawing
      this.startNumberDrawing(roomId, gameId, room);

      // Notify clients
      

      return { success: true, gameId, drawnNumbers, winners: gameData.winners };
    } catch (error) {
      console.error("Error starting game:", error);
      throw error;
    }
  }

  // Start number drawing process
  startNumberDrawing(roomId, gameId, room) {
    const gameRef = ref(rtdb, `games/${gameId}`);
    if (this.numberDrawIntervals.has(roomId)) {
      
      if (room.gameStatus !== "playing") {
        this.stopNumberDrawing(roomId);
        return;
      }
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
        Promise.allSettled([
          update(gameRef, {
            currentDrawnNumbers: newDrawnNumbers,
            currentNumberIndex: currentNumberIndex + 1,
          }),
          update(ref(rtdb, `rooms/${roomId}`), { calledNumbers: newDrawnNumbers }),
        ]).catch(console.error);

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
    }, 3000); // 5 second intervals

    this.numberDrawIntervals.set(roomId, drawInterval);
  }

  // Stop number drawing
  stopNumberDrawing(roomId) {
    const interval = this.numberDrawIntervals.get(roomId);
    if (interval) {
      clearInterval(interval);
      this.numberDrawIntervals.delete(roomId);
    }
  }
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
    const nextGameCountdownMs = 5000; // 5 seconds before reset
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
          await this.resetRoom(roomId);
        } catch (e) {
          console.error("Error in scheduled resetRoom:", e);
        } finally {
          this.resetRoomTimers.delete(roomId);
        }
      }, nextGameCountdownMs);
  
      this.resetRoomTimers.set(roomId, resetTimer);
  
      // Fetch game data
      const gameRef = ref(rtdb, `games/${gameId}`);
      const gameSnap = await get(gameRef);
      const gameData = gameSnap.val();
      if (!gameData) return;
  
      // Mark game as ended
      await update(gameRef, {
        status: "ended",
        endedAt: Date.now(),
        endReason: reason,
      });
  
      await update(roomRef, {
        gameStatus: "ended",
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
  
      // Validate bingo pattern
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
  
      // ✅ Valid bingo
      const gameRef = ref(rtdb, `games/${room.gameId}`);
      update(gameRef, {
        winner: { winnerId: userId, winningPattern: pattern },
      });
  
      if (this.io) {
        const eventData = {
          roomId,
          gameId: room.gameId,
          userId,
          cardId,
          patternIndices: pattern,
        };
        console.log("🎉 Emitting winnerConfirmed event:", eventData);
        this.io.to(roomId).emit("winnerConfirmed", eventData);
      } else {
        console.error("❌ Cannot emit winnerConfirmed event: Socket.IO instance not set!");
      }
  
      // ✅ Calculate payout & revenue (with decimal precision)
      const playerCount = Object.keys(room.players || {}).length;
      const roomAmount = room.betAmount || 0;
  
      const totalBets = playerCount * roomAmount;
      const payoutAmount = totalBets * 0.85;  // 85%
      const revenueAmount = totalBets * 0.15; // 15%
  
      const roomRef = ref(rtdb, `rooms/${roomId}`);
  
      if (payoutAmount > 0) {
        const balanceRef = ref(rtdb, `users/${userId}/balance`);
        await runTransaction(balanceRef, (current) => (current || 0) + payoutAmount);
  
        // ✅ Log winning history
        const winRef = ref(rtdb, `winningHistory/${uuidv4()}`);
        await set(winRef, {
          playerId: userId,
          gameId: room.gameId,
          roomId,
          payout: payoutAmount,
          cardId,
          date: Date.now(),
        });
  
        // ✅ Log revenue (15%)
        const revenueRef = ref(rtdb, `revenue/${room.gameId}`);
        await set(revenueRef, {
          gameId: room.gameId,
          roomId,
          datetime: Date.now(),
          amount: revenueAmount,
          drawned: false,
        });
  
        // ✅ Mark room payout metadata
        update(roomRef, {
          winner: userId,
          payout: payoutAmount,
          payed: true,
        });
      }
  
  
      update(gameRef, { winners: [], winnersChecked: true });

      // 🔊 Final guaranteed broadcast before endGame
      if (this.io) {
        this.io.to(roomId).emit("bingoChecked", {
          roomId,
          gameId: room.gameId,
          winnerId: userId,
          message: "Bingo confirmed! Game ending soon...",
        });
      }

      // Small delay to ensure all sockets receive events
      await new Promise((res) => setTimeout(res, 500));


      this.endGame(roomId, room.gameId, "bingo");
  
      return { success: true, message: "Bingo confirmed!" };
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

  // Generate drawn numbers with predetermined winners
  generateDrawnNumbersMultiWinner(roomId, cards = []) {
    const winners = [];
    const usedNumbers = new Set();
    const drawnNumbers = [];
  
    // --- Validate cards ---
    if (!Array.isArray(cards) || cards.length === 0) {
      console.warn(`⚠️ No cards found for room ${roomId}`);
      return { drawnNumbers: [], winners: [] };
    }
  
    // --- Track last winner per room ---
    if (!this.lastWinnerUserByRoom) this.lastWinnerUserByRoom = new Map();
    const lastWinnerUserId = this.lastWinnerUserByRoom.get(roomId) || null;
  
    // --- Valid cards: must have numbers + claimedBy ---
    const validCards = cards.filter(c => c && Array.isArray(c.numbers) && c.claimedBy);
    if (validCards.length === 0) {
      console.warn(`⚠️ No valid cards for room ${roomId}`);
      return { drawnNumbers: [], winners: [] };
    }
  
    // --- Filter out last winner’s cards ---
    let possibleWinners = validCards.filter(c => c.claimedBy !== lastWinnerUserId);
  
    // --- Edge case: if all cards belong to last winner, allow them ---
    if (possibleWinners.length === 0) possibleWinners = [...validCards];
  
    // --- Pick winner card ---
    const winnerCard = possibleWinners[Math.floor(Math.random() * possibleWinners.length)];
    if (!winnerCard) {
      console.error(`❌ Could not select a winner card for room ${roomId}`);
      return { drawnNumbers: [], winners: [] };
    }
  
    const newWinnerUserId = winnerCard.claimedBy;
  
    // --- Get winner pattern ---
    const winnerPatterns = this.pickPatternNumbers(winnerCard) || [];
    const winnerPattern = winnerPatterns[Math.floor(Math.random() * winnerPatterns.length)] || [];
    if (winnerPattern.length === 0) {
      console.error(`❌ Invalid pattern for winnerCard in room ${roomId}`);
      return { drawnNumbers: [], winners: [] };
    }
  
    // --- Winner: all pattern numbers will appear within first 25 ---
    winnerPattern.forEach(n => {
      if (n > 0 && n <= 75 && !usedNumbers.has(n)) {
        usedNumbers.add(n);
        drawnNumbers.push(n);
      }
    });
  
    // --- Losers: one missing number from their pattern ---
    const loserMissingNumbers = [];
    validCards.forEach(card => {
      if (card.id === winnerCard.id) return;
      const pats = this.pickPatternNumbers(card);
      if (!Array.isArray(pats) || pats.length === 0) return;
  
      const chosen = pats[Math.floor(Math.random() * pats.length)];
      if (!Array.isArray(chosen) || chosen.length === 0) return;
  
      const missIndex = Math.floor(Math.random() * chosen.length);
      const missingNum = chosen[missIndex];
  
      chosen.forEach((n, i) => {
        if (i !== missIndex && n > 0 && n <= 75 && !usedNumbers.has(n)) {
          usedNumbers.add(n);
          drawnNumbers.push(n);
        }
      });
  
      if (missingNum > 0 && missingNum <= 75) {
        loserMissingNumbers.push(missingNum);
      }
    });
  
    // --- Fill remaining spots up to 25 numbers ---
    while (drawnNumbers.length < 25) {
      const rand = Math.floor(Math.random() * 75) + 1;
      if (!usedNumbers.has(rand)) {
        usedNumbers.add(rand);
        drawnNumbers.push(rand);
      }
    }
  
    // --- Shuffle first 25 numbers for randomness ---
    const first25 = this.shuffleArray(drawnNumbers.slice(0, 25));
  
    // --- After winner (26–75): draw missing numbers + random rest ---
    const after25 = [];
  
    // Add all loser missing numbers first
    loserMissingNumbers.forEach(n => {
      if (n > 0 && n <= 75 && !usedNumbers.has(n)) {
        usedNumbers.add(n);
        after25.push(n);
      }
    });
  
    // Fill remaining till 75
    while (after25.length + first25.length < 75) {
      const rand = Math.floor(Math.random() * 75) + 1;
      if (!usedNumbers.has(rand)) {
        usedNumbers.add(rand);
        after25.push(rand);
      }
    }
  
    const finalDrawn = [...first25, ...this.shuffleArray(after25)];
  
    // --- Store and return ---
    winners.push(winnerCard.id);
    console.log(`last winner before current drawn: ${lastWinnerUserId}`);
    this.lastWinnerUserByRoom.set(roomId, newWinnerUserId);
    console.log(`last winner after current drawn: ${this.lastWinnerUserByRoom.get(roomId)}`);
  
    return { drawnNumbers: finalDrawn.slice(0, 75), winners };
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
  
      // Reset room state
      update(roomRef, {
        gameStatus: "waiting",
        gameId: null,
        calledNumbers: [],
        winner: null,
        payout: null,
        payed: false,
        nextGameCountdownEndAt: null
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
