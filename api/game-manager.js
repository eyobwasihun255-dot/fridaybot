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
 
  // Start countdown if conditions allow
 
  
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

  // --- inside GameManager ---

async startCountdown(room, roomId, players, durationMs = 29000, startedBy = "auto") {
  try {
    console.log(`🎮 startCountdown() called for ${roomId} with ${players.length} players`);

    if (room.gameStatus === "countdown") return console.log(`⏳ already counting down ${roomId}`);
    if (players.length < 2) return console.log(`❌ not enough players ${roomId}`);
    if (room.gameStatus !== "waiting") return console.log(`⚠️ room ${roomId} not waiting (${room.gameStatus})`);

    const countdownEndAt = Date.now() + durationMs;
    const roomRef = ref(rtdb, `rooms/${roomId}`);

    await update(roomRef, {
      gameStatus: "countdown",
      countdownEndAt,
      countdownStartedBy: startedBy,
    });

    console.log(`✅ countdown saved to RTDB for ${roomId}`);

    if (this.countdownTimers.has(roomId)) clearTimeout(this.countdownTimers.get(roomId));

    const tid = setTimeout(async () => {
      console.log(`🕒 Countdown timer fired for ${roomId}`);
      try {
        const snap = await get(roomRef);
        const latest = snap.val();
        console.log(`📡 latest RTDB state for ${roomId}:`, latest?.gameStatus);

        if (latest?.gameStatus === "countdown") {
          console.log(`➡️ calling startGame(${roomId})`);
          await this.startGame(roomId);
        } else {
          console.log(`🚫 Skipping startGame, state=${latest?.gameStatus}`);
        }
      } catch (err) {
        console.error(`💥 error in countdown timeout for ${roomId}:`, err);
      } finally {
        this.countdownTimers.delete(roomId);
      }
    }, durationMs);

    this.countdownTimers.set(roomId, tid);

  } catch (err) {
    console.error(`❌ startCountdown() fatal for ${roomId}:`, err);
  }
}


async startGame(roomId) {
  console.log(`🚀 startGame() entered for ${roomId}`);
  try {
    const roomRef = ref(rtdb, `rooms/${roomId}`);
    const snap = await get(roomRef);
    const room = snap.val();

    console.log(`📡 fetched room ${roomId}:`, room ? `status=${room.gameStatus}` : "❌ no room");

    if (!room) return console.error(`❌ no room data for ${roomId}`);
    if (room.gameStatus !== "countdown") return console.warn(`⚠️ room ${roomId} state=${room.gameStatus}, aborting startGame`);

    const playerIds = Object.keys(room.players || {});
    console.log(`👥 ${playerIds.length} players in ${roomId}`);

    if (playerIds.length < 2) return console.warn(`🚫 not enough players`);

    const gameId = uuidv4();
    const cards = playerIds
      .map(pid => room.bingoCards?.[room.players?.[pid]?.cardId])
      .filter(Boolean);
    console.log(`🃏 ${cards.length} valid cards`);

    const { drawnNumbers, winners } = this.generateDrawnNumbersMultiWinner(roomId, cards);
    console.log(`🎯 drawnNumbers=${drawnNumbers.length}, winners=${winners.length}`);

    const gameData = {
      id: gameId,
      roomId,
      drawnNumbers,
      currentDrawnNumbers: [],
      currentNumberIndex: 0,
      createdAt: Date.now(),
      startedAt: Date.now(),
      drawIntervalMs: 3000,
      status: "active",
      totalPayout: Math.floor((playerIds.length - 1) * (room.betAmount || 0) * 0.85 + (room.betAmount || 0)),
      betsDeducted: false,
      winners: winners.map(cid => ({
        id: uuidv4(),
        cardId: cid,
        userId: room.bingoCards[cid]?.claimedBy || null,
        username: room.players?.[room.bingoCards[cid]?.claimedBy]?.username || "Unknown",
        checked: false
      })),
      gameStatus: "playing"
    };

    console.log(`🧾 built gameData for ${roomId}`);

    await runTransaction(roomRef, cr => {
      if (!cr || cr.gameStatus !== "countdown") return cr;
      cr.gameStatus = "playing";
      cr.gameId = gameId;
      cr.calledNumbers = [];
      cr.countdownEndAt = null;
      return cr;
    });

    console.log(`💾 room ${roomId} set to playing`);

    await set(ref(rtdb, `games/${gameId}`), gameData);
    console.log(`💾 game ${gameId} saved`);

    this.deductBets(roomId, gameData);
    this.startNumberDrawing(roomId, gameId);
    if (this.io) this.io.to(roomId).emit("gameStarted", { roomId, gameId });

    console.log(`✅ game ${gameId} started successfully for ${roomId}`);
  } catch (e) {
    console.error(`💥 startGame() failed for ${roomId}:`, e);
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

  // End game
  async endGame(roomId, gameId, reason = "manual") {
          // Update room status and set nextGameCountdownEndAt so clients can transition
          const roomRef = ref(rtdb, `rooms/${roomId}`);
          const nextGameCountdownMs = 10; // 10s until reset (tunable)
          const nextGameCountdownEndAt = Date.now() + nextGameCountdownMs;
    try {
      // Stop drawing numbers for this room
      this.stopNumberDrawing(roomId);

      // Clear any countdown timer for this room
      if (this.countdownTimers.has(roomId)) {
        clearTimeout(this.countdownTimers.get(roomId));
        this.countdownTimers.delete(roomId);
      }

      
      try {
        if (this.resetRoomTimers.has(roomId)) {
          clearTimeout(this.resetRoomTimers.get(roomId));
          this.resetRoomTimers.delete(roomId);
        }
        const rid = setTimeout(async () => {
          try {
            this.resetRoom(roomId);
          } catch (e) {
            console.error('Error in scheduled resetRoom:', e);
          } finally {
            this.resetRoomTimers.delete(roomId);
          }
        }, nextGameCountdownMs );
        this.resetRoomTimers.set(roomId, rid);
      } catch (e) {
        console.error('Error scheduling resetRoom timer:', e);
      }
      const gameRef = ref(rtdb, `games/${gameId}`);
      const gameSnap = await get(gameRef);
      const gameData = gameSnap.val();

      if (!gameData) return;

      // Update game status
      update(gameRef, {
        status: "ended",
        endedAt: Date.now(),
        endReason: reason,
      });



      update(roomRef, {
        gameStatus: "ended",
        nextGameCountdownEndAt,
        countdownEndAt: null,
        countdownStartedBy: null,
      });


      // If numbers finished and no winner confirmed, add revenue and skip payouts
      const hasConfirmedWinner = !!gameData.winner;
      if (reason === 'allNumbersDrawn' && !hasConfirmedWinner) {
        try {
          const revenueRef = ref(rtdb, `revenue/${gameId}`);
          await set(revenueRef, {
            gameId,
            roomId,
            datetime: Date.now(),
            amount: gameData.totalPayout || 0,
            drawned: false,
          });

          // Mark room payout fields for record consistency
          update(roomRef, {
            winner: null,
            payout: gameData.totalPayout || 0,
            payed: true,
          });
          this.resetRoom(roomId);
        } catch (e) {
          console.error('Error recording revenue on no-winner case:', e);
        }
      } else {
        // Process winners and payouts when there is a winner list
        if (gameData.winners && gameData.winners.length > 0) {
          this.processWinners(roomId, gameData);
        }
      }

      // Notify clients and include nextGameCountdownEndAt so clients can transition immediately
      if (this.io) {
        this.io.to(roomId).emit('gameEnded', {
          roomId,
          gameId,
          reason,
          winners: gameData.winners || [],
          nextGameCountdownEndAt,
        });
      }
     

      console.log(`🔚 Game ended in room ${roomId}: ${reason}`);
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
        await runTransaction(balanceRef, current => (current || 0) - betAmount);

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
  
    if (!Array.isArray(cards) || cards.length === 0) {
      console.warn(`⚠️ No cards found for room ${roomId}`);
      return { drawnNumbers: [], winners: [] };
    }
  
    if (!this.lastWinnerUserByRoom) this.lastWinnerUserByRoom = new Map();
    const lastWinnerUserId = this.lastWinnerUserByRoom.get(roomId) || null;
  
    // Filter valid cards
    const validCards = cards.filter(c => c && Array.isArray(c.numbers) && c.claimedBy);
    if (validCards.length === 0) {
      console.warn(`⚠️ No valid cards for room ${roomId}`);
      return { drawnNumbers: [], winners: [] };
    }
  
    // --- Filter out last winner’s user ---
    let possibleWinners = validCards.filter(
      c => c.claimedBy !== lastWinnerUserId
    );
  
    // --- Edge case: all cards belong to last winner ---
    const allSameUser = validCards.every(c => c.claimedBy === lastWinnerUserId);
    if (possibleWinners.length === 0 || allSameUser) {
      possibleWinners = [...validCards];
    }
  
    const winnerCard = possibleWinners[Math.floor(Math.random() * possibleWinners.length)];
    if (!winnerCard) {
      console.error(`❌ Could not select a winner card for room ${roomId}`);
      return { drawnNumbers: [], winners: [] };
    }
  
    const newWinnerUserId = winnerCard.claimedBy;
  
    // --- Safe pattern selection ---
    const patterns = this.pickPatternNumbers(winnerCard) || [];
    const winnerPattern = patterns[Math.floor(Math.random() * patterns.length)] || [];
    if (winnerPattern.length === 0) {
      console.error(`❌ Invalid pattern for winnerCard in room ${roomId}`);
      return { drawnNumbers: [], winners: [] };
    }
  
    const winnerMissIndex = Math.floor(Math.random() * winnerPattern.length);
    const winnerMissing = winnerPattern[winnerMissIndex] || 0;
  
    winnerPattern.forEach((n, i) => {
      if (i !== winnerMissIndex && n > 0 && n <= 75 && !usedNumbers.has(n)) {
        usedNumbers.add(n);
        drawnNumbers.push(n);
      }
    });
  
    const loserMissingNumbers = [];
    validCards.forEach(card => {
      if (card.id === winnerCard.id) return;
      const pats = this.pickPatternNumbers(card) || [];
      const chosen = pats[Math.floor(Math.random() * pats.length)] || [];
      const missIndex = Math.floor(Math.random() * chosen.length);
      const missingNum = chosen[missIndex] || 0;
  
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
  
    while (drawnNumbers.length < 24) {
      const rand = Math.floor(Math.random() * 75) + 1;
      if (!usedNumbers.has(rand)) {
        usedNumbers.add(rand);
        drawnNumbers.push(rand);
      }
    }
  
    const first24 = this.shuffleArray(drawnNumbers.slice(0, 24));
    const first25 = [...first24, winnerMissing];
    usedNumbers.add(winnerMissing);
  
    const neutralAfterWinner = [];
    while (neutralAfterWinner.length < 2) {
      const rand = Math.floor(Math.random() * 75) + 1;
      if (!usedNumbers.has(rand)) {
        usedNumbers.add(rand);
        neutralAfterWinner.push(rand);
      }
    }
  
    const rest = [];
    loserMissingNumbers.forEach(n => {
      if (n > 0 && n <= 75 && !usedNumbers.has(n)) {
        usedNumbers.add(n);
        rest.push(n);
      }
    });
  
    while (first25.length + neutralAfterWinner.length + rest.length < 75) {
      const rand = Math.floor(Math.random() * 75) + 1;
      if (!usedNumbers.has(rand)) {
        usedNumbers.add(rand);
        rest.push(rand);
      }
    }
  
    const finalDrawn = [
      ...first25,
      ...neutralAfterWinner,
      ...this.shuffleArray(rest),
    ];
  
    winners.push(winnerCard.id);
    console.log(`last winner before current drawn${this.lastWinnerUserByRoom.get(roomId) || null}`)
    this.lastWinnerUserByRoom.set(roomId, newWinnerUserId);
    console.log(`last winner after current drawn${this.lastWinnerUserByRoom.get(roomId) || null}`)
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
