import { rtdb } from "../bot/firebaseConfig.js";
import { ref, get, set, update, runTransaction, onValue } from "firebase/database";
import { v4 as uuidv4 } from "uuid";

class GameManager {
  constructor() {
    this.activeGames = new Map(); // roomId -> game data
    this.numberDrawIntervals = new Map(); // roomId -> interval ID
    this.countdownTimers = new Map(); // roomId -> timeout ID
    this.resetRoomTimers = new Map(); // roomId -> timeout ID for scheduled reset
    this.io = null; // Will be set when Socket.IO is initialized
    this.countdownIntervals = new Map(); // roomId -> interval id for periodic countdown tick

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
  clearRoomCountdownTimers(roomId) {
    if (this.countdownTimers.has(roomId)) {
      clearTimeout(this.countdownTimers.get(roomId));
      this.countdownTimers.delete(roomId);
    }
    if (this.countdownIntervals.has(roomId)) {
      clearInterval(this.countdownIntervals.get(roomId));
      this.countdownIntervals.delete(roomId);
    }
  }
  // Start countdown if conditions allow
  async startCountdown(roomId, durationMs = 30000, startedBy = null) {
    try {
      const roomRef = ref(rtdb, `rooms/${roomId}`);
  
      // Use runTransaction to ensure we only set countdown when room is in 'waiting'
      const res = await runTransaction(roomRef, (currentRoom) => {
        if (!currentRoom) return; // room missing -> abort
        // if already countdown or playing -> abort
        if (currentRoom.gameStatus && currentRoom.gameStatus !== "waiting") {
          return; // abort transaction (no change)
        }
  
        const now = Date.now();
        const countdownEndAt = now + durationMs;
  
        currentRoom.gameStatus = "countdown";
        currentRoom.countdownEndAt = countdownEndAt;
        currentRoom.countdownStartedBy = startedBy;
  
        return currentRoom;
      });
  
      if (!res.committed) {
        // someone else started it or room not waiting
        console.log(`⏰ startCountdown aborted for ${roomId} - not in waiting or already started`);
        return { success: false, message: "Countdown not started (state mismatch)" };
      }
  
      // --- schedule server-side auto-start using exact remaining ms ---
      const roomSnap = await get(roomRef);
      const room = roomSnap.val();
      const remaining = Math.max((room.countdownEndAt || 0) - Date.now(), 0);
  
      // clear any previous timers for safety
      this.clearRoomCountdownTimers(roomId);
  
      // final auto-start timeout
      const tid = setTimeout(async () => {
        try {
          // Final verification before starting
          const finalSnap = await get(roomRef);
          const finalRoom = finalSnap.val();
          const now = Date.now();
  
          // If countdownEndAt is in the future (due to race), postpone
          if (!finalRoom || finalRoom.gameStatus !== "countdown") {
            console.log(`⏰ auto-start aborted; state changed for ${roomId}`);
            return;
          }
          if (finalRoom.countdownEndAt && now < finalRoom.countdownEndAt - 250) {
            // If we're slightly early, reschedule for the exact remaining ms
            const rem = finalRoom.countdownEndAt - now;
            const t = setTimeout(() => this.startGame(roomId).catch(e => console.error(e)), rem);
            this.countdownTimers.set(roomId, t);
            return;
          }
  
          await this.startGame(roomId);
        } catch (e) {
          console.error('Auto startGame error:', e);
        } finally {
          this.countdownTimers.delete(roomId);
        }
      }, remaining);
      this.countdownTimers.set(roomId, tid);
  
      // periodic sync emitter (every 2 seconds) to keep clients in sync with server time
      const tickInterval = setInterval(async () => {
        try {
          const snap = await get(roomRef);
          const r = snap.val() || {};
          if (r.gameStatus !== "countdown") {
            this.clearRoomCountdownTimers(roomId);
            return;
          }
          const countdownEndAt = r.countdownEndAt || null;
          if (this.io) {
            this.io.to(roomId).emit("countdownTick", { roomId, countdownEndAt });
          }
        } catch (e) {
          console.error('countdownTick error:', e);
        }
      }, 2000);
      this.countdownIntervals.set(roomId, tickInterval);
  
      // Notify clients immediately
      const finalSnap2 = await get(roomRef);
      const finalRoom2 = finalSnap2.val() || {};
      if (this.io) this.io.to(roomId).emit("countdownStarted", {
        roomId,
        countdownEndAt: finalRoom2.countdownEndAt,
        countdownStartedBy: finalRoom2.countdownStartedBy
      });
  
      console.log(`⏰ Started countdown for room ${roomId} (by ${startedBy})`);
      return { success: true, countdownEndAt: finalRoom2.countdownEndAt };
    } catch (err) {
      console.error("Error starting countdown:", err);
      return { success: false, message: "Server error" };
    }
  }
  async cancelCountdown(roomId) {
    try {
      this.clearRoomCountdownTimers(roomId);
      const roomRef = ref(rtdb, `rooms/${roomId}`);
      await update(roomRef, {
        gameStatus: "waiting",
        countdownEndAt: null,
        countdownStartedBy: null,
      });
      if (this.io) this.io.to(roomId).emit("countdownCancelled", { roomId });
      return { success: true };
    } catch (err) {
      console.error("Error cancelling countdown:", err);
      return { success: false };
    }
  }

  // Start a new game
  async startGame(roomId) {
    try {
      const roomRef = ref(rtdb, `rooms/${roomId}`);
      const roomSnap = await get(roomRef);
      const room = roomSnap.val();
  
      if (!room) throw new Error("Room not found");
      if (room.gameStatus !== "countdown") {
        throw new Error("Room not in countdown state");
      }
  
      // final server-side time check
      const now = Date.now();
      if (room.countdownEndAt && now < room.countdownEndAt - 250) {
        // Too early: let the scheduled timer handle it
        throw new Error("Attempted to start game too early");
      }
  
      const gameId = uuidv4();
      const playerIds = Object.keys(room.players || {});
      if (playerIds.length < 2) throw new Error("Not enough players");
  
      // Prepare game data (generate drawn numbers & winners)
      const cards = playerIds.map(pid => room.bingoCards?.[room.players[pid]?.cardId]).filter(Boolean);
      const { drawnNumbers, winners } = this.generateDrawnNumbersMultiWinner(cards);
  
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
          userId: room.bingoCards?.[cardId]?.claimedBy || null,
          checked: false
        })),
        gameStatus: "playing"
      };
  
      // Clear countdown timers for room
      this.clearRoomCountdownTimers(roomId);
  
      // Do a single multi-path update to write both game and room updates in one roundtrip
      const rootRef = ref(rtdb, "/");
      const updates = {};
      updates[`games/${gameId}`] = gameData;
      updates[`rooms/${roomId}/gameStatus`] = "playing";
      updates[`rooms/${roomId}/gameId`] = gameId;
      updates[`rooms/${roomId}/calledNumbers`] = [];
      updates[`rooms/${roomId}/countdownEndAt`] = null;
      updates[`rooms/${roomId}/countdownStartedBy`] = null;
      updates[`rooms/${roomId}/currentWinner`] = null;
      updates[`rooms/${roomId}/payed`] = false;
  
      await update(rootRef, updates);
  
      // Deduct bets (still per-user transaction for balances) - run in parallel but not blocking room update
      this.deductBets(roomId, gameData).catch(e => console.error("deductBets error:", e));
  
      // Start number drawing (starts reading from games/${gameId})
      this.startNumberDrawing(roomId, gameId);
  
      // Immediately notify clients with game details
      if (this.io) {
        this.io.to(roomId).emit("gameStarted", { roomId, gameId, drawnNumbers: gameData.drawnNumbers, game: gameData });
      }
  
      // Send notifications to claimed-but-offline players (use notifier)
      try {
        // lazy require to avoid circular deps if any
        const { sendBotMessage } = await import("./notifier.js");
        for (const pid of Object.keys(room.players || {})) {
          const player = room.players[pid];
          // we expect frontend sets players[pid].isActive = true while miniapp is open
          const hasClaimed = Object.values(room.bingoCards || {}).some(c => c.claimedBy === pid);
          if (hasClaimed && !player?.isActive) {
            // Non-blocking
            sendBotMessage(pid, `🎯 Your game in room ${roomId} has started — open the mini app to continue playing!`).catch(e => console.error("notify error:", e));
          }
        }
      } catch (e) {
        console.error("Notifier error (non-fatal):", e);
      }
  
      return { success: true, gameId, winners: gameData.winners };
    } catch (error) {
      console.error("Error starting game:", error);
      throw error;
    }
  }

  // Start number drawing process
  startNumberDrawing(roomId, gameId) {
    const gameRef = ref(rtdb, `games/${gameId}`);
    const roomRef = ref(rtdb, `rooms/${roomId}`);
    if (this.numberDrawIntervals.has(roomId)) {
      const roomSnap =  get(roomRef);
      const room = roomSnap.val();
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
          await this.endGame(roomId, gameId, "allNumbersDrawn");
          return;
        }

        const currentNumber = drawnNumbers[currentNumberIndex];
        const newDrawnNumbers = drawnNumbers.slice(0, currentNumberIndex + 1);

        // Update game data
        await update(gameRef, {
          currentDrawnNumbers: newDrawnNumbers,
          currentNumberIndex: currentNumberIndex + 1
        });

        // Update room called numbers
        const roomRef = ref(rtdb, `rooms/${roomId}`);
        await update(roomRef, {
          calledNumbers: newDrawnNumbers
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
              await this.checkBingo(roomId, cardId, card.claimedBy, winningPattern);
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
    }, 5000); // 5 second intervals

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
    try {
      // Stop drawing numbers for this room
      this.stopNumberDrawing(roomId);

      // Clear any countdown timer for this room
      if (this.countdownTimers.has(roomId)) {
        clearTimeout(this.countdownTimers.get(roomId));
        this.countdownTimers.delete(roomId);
      }

      const gameRef = ref(rtdb, `games/${gameId}`);
      const gameSnap = await get(gameRef);
      const gameData = gameSnap.val();

      if (!gameData) return;

      // Update game status
      await update(gameRef, {
        status: "ended",
        endedAt: Date.now(),
        endReason: reason,
      });

      // Update room status and set nextGameCountdownEndAt so clients can transition
      const roomRef = ref(rtdb, `rooms/${roomId}`);
      const nextGameCountdownMs = 10000; // 10s until reset (tunable)
      const nextGameCountdownEndAt = Date.now() + nextGameCountdownMs;

      await update(roomRef, {
        gameStatus: "ended",
        nextGameCountdownEndAt,
        countdownEndAt: null,
        countdownStartedBy: null,
      });

      // Schedule per-room reset to avoid waiting for global poll
      try {
        if (this.resetRoomTimers.has(roomId)) {
          clearTimeout(this.resetRoomTimers.get(roomId));
          this.resetRoomTimers.delete(roomId);
        }
        const rid = setTimeout(async () => {
          try {
            await this.resetRoom(roomId);
          } catch (e) {
            console.error('Error in scheduled resetRoom:', e);
          } finally {
            this.resetRoomTimers.delete(roomId);
          }
        }, nextGameCountdownMs + 200);
        this.resetRoomTimers.set(roomId, rid);
      } catch (e) {
        console.error('Error scheduling resetRoom timer:', e);
      }

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
          await update(roomRef, {
            winner: null,
            payout: gameData.totalPayout || 0,
            payed: true,
          });
          await this.resetRoom(roomId);
        } catch (e) {
          console.error('Error recording revenue on no-winner case:', e);
        }
      } else {
        // Process winners and payouts when there is a winner list
        if (gameData.winners && gameData.winners.length > 0) {
          await this.processWinners(roomId, gameData);
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
      await update(roomRef, {
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
  async checkBingo(roomId, cardId, userId, pattern) {
    try {
      const roomRef = ref(rtdb, `rooms/${roomId}`);
      const roomSnap = await get(roomRef);
      const room = roomSnap.val();

      if (!room || room.gameStatus !== "playing") {
        return { success: false, message: "Game not in playing state" };
      }

      // Check if user already attempted bingo
      const playerRef = ref(rtdb, `rooms/${roomId}/players/${userId}`);
      const playerSnap = await get(playerRef);
      const player = playerSnap.val();

      if (player?.attemptedBingo) {
        return { success: false, message: "Already attempted bingo" };
      }

      // Validate bingo pattern
      const isValidBingo = this.validateBingoPattern(cardId, room, pattern, room.calledNumbers);
      
      if (!isValidBingo) {
        // Mark as attempted but failed
        await update(playerRef, { attemptedBingo: true });
        return { success: false, message: "Invalid bingo pattern" };
      }

      // Valid bingo - write winner and notify immediately
      const gameRef = ref(rtdb, `games/${room.gameId}`);
      const gameSnap = await get(gameRef);
      const gameData = gameSnap.val() || {};

      await update(gameRef, {
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
        console.log('🎉 Emitting winnerConfirmed event:', eventData);
        this.io.to(roomId).emit('winnerConfirmed', eventData);
      } else {
        console.error('❌ Cannot emit winnerConfirmed event: Socket.IO instance not set!');
      }

      // Calculate winner payout according to new formula
      const playerCount = Object.keys(room.players || {}).length;
      const roomAmount = room.betAmount || 0;
      const payoutAmount = Math.floor((playerCount - 1) * roomAmount * 0.85 + roomAmount);
      
      if (payoutAmount > 0) {
        const balanceRef = ref(rtdb, `users/${userId}/balance`);
        await runTransaction(balanceRef, (current) => (current || 0) + payoutAmount);

        // Log winning history
        const winRef = ref(rtdb, `winningHistory/${uuidv4()}`);
        await set(winRef, {
          playerId: userId,
          gameId: room.gameId,
          roomId,
          payout: payoutAmount,
          cardId,
          date: Date.now(),
        });

        // Calculate and record revenue
        const totalBets = playerCount * roomAmount;
        const revenueAmount = totalBets - payoutAmount;
        
        const revenueRef = ref(rtdb, `revenue/${room.gameId}`);
        await set(revenueRef, {
          gameId: room.gameId,
          roomId,
          datetime: Date.now(),
          amount: revenueAmount,
          drawned: false,
        });

        // Mark room payout metadata
        await update(roomRef, {
          winner: userId,
          payout: payoutAmount,
          payed: true,
        });
      }

      // Prevent double payout by clearing auto winners list
      await update(gameRef, { winners: [], winnersChecked: true });

      // End game right after confirmation
      await this.endGame(roomId, room.gameId, "bingo");
      
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

      await update(ref(rtdb, `games/${gameData.id}`), { betsDeducted: true });
    } catch (error) {
      console.error("Error deducting bets:", error);
    }
  }

  // Generate drawn numbers with predetermined winners
  generateDrawnNumbersMultiWinner(cards) {
    const winners = [];
    const usedNumbers = new Set();
    const drawnNumbers = [];
  
    if (!cards || cards.length === 0) {
      return { drawnNumbers: [], winners: [] };
    }
  
    // --- Pick random winner (different from last winner) ---
    let possibleWinners = [...cards];
    if (this.lastWinnerId) {
      possibleWinners = possibleWinners.filter(c => c.id !== this.lastWinnerId);
    }
  
    if (possibleWinners.length === 0) {
      possibleWinners = [...cards];
    }
  
    const winnerCard = possibleWinners[Math.floor(Math.random() * possibleWinners.length)];
    this.lastWinnerId = winnerCard.id;
  
    // --- Select winner pattern ---
    const patterns = this.pickPatternNumbers(winnerCard);
    const winnerPattern = patterns[Math.floor(Math.random() * patterns.length)];
  
    // --- Pick missing number for the winner ---
    const winnerMissIndex = Math.floor(Math.random() * winnerPattern.length);
    const winnerMissing = winnerPattern[winnerMissIndex];
  
    // --- Add all other numbers from winner pattern first ---
    winnerPattern.forEach((n, i) => {
      if (i !== winnerMissIndex && n > 0 && n <= 75 && !usedNumbers.has(n)) {
        usedNumbers.add(n);
        drawnNumbers.push(n);
      }
    });
  
    // --- Handle loser cards ---
    const loserMissingNumbers = [];
    cards.forEach((card) => {
      if (card.id === winnerCard.id) return;
  
      const pats = this.pickPatternNumbers(card);
      const chosen = pats[Math.floor(Math.random() * pats.length)];
  
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
  
    // --- Fill up until 24 numbers ---
    while (drawnNumbers.length < 24) {
      const rand = Math.floor(Math.random() * 75) + 1;
      if (!usedNumbers.has(rand)) {
        usedNumbers.add(rand);
        drawnNumbers.push(rand);
      }
    }
  
    // --- Shuffle first 24 numbers ---
    const first24 = this.shuffleArray(drawnNumbers.slice(0, 24));
  
    // --- Make 25th number = winner’s missing number ---
    const first25 = [...first24, winnerMissing];
    usedNumbers.add(winnerMissing);
  
    // ✅ Up to here, after 25 numbers → 1 winner only
  
    // --- Losers’ missing numbers drawn *after* 25th ---
    const rest = [];
    this.shuffleArray(loserMissingNumbers).forEach((n) => {
      if (!usedNumbers.has(n)) {
        usedNumbers.add(n);
        rest.push(n);
      }
    });
  
    // --- Fill remaining up to 75 with randoms ---
    while (first25.length + rest.length < 75) {
      const rand = Math.floor(Math.random() * 75) + 1;
      if (!usedNumbers.has(rand)) {
        usedNumbers.add(rand);
        rest.push(rand);
      }
    }
  
    const finalRest = this.shuffleArray(rest);
    const finalDrawn = [...first25, ...finalRest];
  
    winners.push(winnerCard.id);
  
    return { drawnNumbers: finalDrawn, winners };
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
             await update(playerRef, { attemptedBingo: false });
            keepClaimed = true;
            keepPlayers.add(claimedBy);
          }
        }
  
        if (!keepClaimed) {
          // Reset the card if not valid auto-bet
          await update(ref(rtdb, `rooms/${roomId}/bingoCards/${cardId}`), {
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
          await update(roomRef, {
            [`players/${playerId}`]: null
          });
        }
      }
  
      // Reset room state
      await update(roomRef, {
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
        await update(roomRef, updates);
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
