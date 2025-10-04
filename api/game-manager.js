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
  async startCountdown(roomId, durationMs = 30000, startedBy = null) {
    try {
      const roomRef = ref(rtdb, `rooms/${roomId}`);
      const snap = await get(roomRef);
  
      if (!snap.exists()) {
        console.error(`❌ Room ${roomId} not found in RTDB`);
        return { success: false, message: 'Room not found' };
      }
  
      const room = snap.val();
      console.log(`🎮 Room ${roomId} snapshot:`, room);
  
      // Check if countdown already active
      const countdownActive = !!room.countdownEndAt && room.countdownEndAt > Date.now();
      if (countdownActive) {
        console.log(`⏰ Countdown already active for room ${roomId}`);
        return { success: false, message: 'Countdown already active' };
      }
  
      // Count valid players (those with cards and sufficient balance)
      const validPlayers = await this.countValidPlayers(roomId, room);
      console.log(
        `🎮 startCountdown for room ${roomId}: validPlayers=${validPlayers.length}, gameStatus=${room.gameStatus}, countdownActive=${countdownActive}`
      );
  
      if (validPlayers.length < 2) {
        console.log(`❌ Not enough valid players for room ${roomId}: ${validPlayers.length} players`);
        return { success: false, message: 'Not enough valid players' };
      }
  
      if (room.gameStatus !== 'waiting') {
        console.log(`❌ Room ${roomId} not in waiting state: ${room.gameStatus}`);
        return { success: false, message: 'Room not in waiting state' };
      }
  
      const countdownEndAt = Date.now() + durationMs;
  
      // Clear any existing countdown timer for this room
      if (this.countdownTimers.has(roomId)) {
        clearTimeout(this.countdownTimers.get(roomId));
        this.countdownTimers.delete(roomId);
      }
  
      // Update room state
      await update(roomRef, {
        gameStatus: 'countdown',
        countdownEndAt,
        countdownStartedBy: startedBy,
      });
  
      // Schedule auto start for this specific room
      const tid = setTimeout(async () => {
        try {
          console.log(`⏰ Countdown ended for room ${roomId}, starting game...`);
          await this.startGame(roomId);
        } catch (e) {
          console.error(`Auto startGame error for room ${roomId}:`, e);
        } finally {
          this.countdownTimers.delete(roomId);
        }
      }, durationMs);
      this.countdownTimers.set(roomId, tid);
  
      // Notify clients - ensure room-specific emission
      if (this.io) {
        this.io.to(roomId).emit('countdownStarted', { 
          roomId, 
          countdownEndAt,
          startedBy,
          validPlayerCount: validPlayers.length
        });
      }
  
      console.log(`⏰ Started countdown for room ${roomId} by ${startedBy || 'unknown'} with ${validPlayers.length} valid players`);
      return { success: true, countdownEndAt };
    } catch (err) {
      console.error(`Error starting countdown for room ${roomId}:`, err);
      return { success: false, message: 'Server error' };
    }
  }

  // Count valid players for countdown
  async countValidPlayers(roomId, room) {
    const validPlayers = [];
    
    if (!room?.players) return validPlayers;

    for (const [playerId, player] of Object.entries(room.players)) {
      try {
        // Check if player has a valid card
        if (!player.cardId || !room.bingoCards?.[player.cardId]) {
          continue;
        }

        const card = room.bingoCards[player.cardId];
        
        // Check if card is claimed by this player
        if (!card.claimed || card.claimedBy !== playerId) {
          continue;
        }

        // For non-demo rooms, check balance
        if (!room.isDemoRoom) {
          const userRef = ref(rtdb, `users/${playerId}`);
          const userSnap = await get(userRef);
          const user = userSnap.val();
          
          if (!user || (user.balance || 0) < room.betAmount) {
            continue;
          }
        }

        // Player is valid
        validPlayers.push(player);
      } catch (error) {
        console.error(`Error counting player ${playerId}:`, error);
      }
    }

    return validPlayers;
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

  // Start a new game
  async startGame(roomId) {
    try {
      const roomRef = ref(rtdb, `rooms/${roomId}`);
      const roomSnap = await get(roomRef);
      const room = roomSnap.val();

      if (!room || room.gameStatus !== "countdown") {
        throw new Error("Room not in countdown state");
      }

      // Validate players and their balances
      const validPlayers = await this.validatePlayersForGame(roomId, room);
      
      if (validPlayers.length < 2) {
        throw new Error("Not enough valid players to start game");
      }

      const gameId = uuidv4();
      
      // Generate drawn numbers and determine winners using only valid players
      const validCards = validPlayers.map(player => room.bingoCards[player.cardId]);
      const { drawnNumbers, winners } = this.generateDrawnNumbersMultiWinner(validCards);

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

      // Deduct bets from valid players only
      await this.deductBetsFromValidPlayers(roomId, gameData, validPlayers);

      // Save game data
      const gameRef = ref(rtdb, `games/${gameId}`);
      await set(gameRef, gameData);

      // Start number drawing
      this.startNumberDrawing(roomId, gameId);

      // Notify clients - ensure room-specific emission
      if (this.io) {
        this.io.to(roomId).emit('gameStarted', { 
          roomId, 
          gameId,
          validPlayerCount: validPlayers.length,
          removedPlayerCount: Object.keys(room.players || {}).length - validPlayers.length
        });
      }

      console.log(`🎮 Game started in room ${roomId} with ${validPlayers.length} valid players`);
      return { success: true, gameId, drawnNumbers, winners: gameData.winners };
    } catch (error) {
      console.error("Error starting game:", error);
      throw error;
    }
  }

  // Start number drawing process
  startNumberDrawing(roomId, gameId) {
    const gameRef = ref(rtdb, `games/${gameId}`);
    
    // Clear any existing interval for this room
    this.stopNumberDrawing(roomId);
    
    const drawInterval = setInterval(async () => {
      try {
        const gameSnap = await get(gameRef);
        const gameData = gameSnap.val();

        if (!gameData || gameData.status !== "active") {
          console.log(`🛑 Stopping number drawing for room ${roomId} - game not active`);
          this.stopNumberDrawing(roomId);
          return;
        }

        // Double-check room is still in playing state
        const roomRef = ref(rtdb, `rooms/${roomId}`);
        const roomSnap = await get(roomRef);
        const room = roomSnap.val();
        
        if (!room || room.gameStatus !== "playing" || room.gameId !== gameId) {
          console.log(`🛑 Stopping number drawing for room ${roomId} - room state changed`);
          this.stopNumberDrawing(roomId);
          return;
        }

        const { drawnNumbers, currentNumberIndex } = gameData;
        
        if (currentNumberIndex >= drawnNumbers.length) {
          // All numbers drawn, end game
          console.log(`🏁 All numbers drawn for room ${roomId}, ending game`);
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
        await update(roomRef, {
          calledNumbers: newDrawnNumbers
        });

        // Notify clients - ensure room-specific emission
        if (this.io) {
          this.io.to(roomId).emit('numberDrawn', {
            number: currentNumber,
            drawnNumbers: newDrawnNumbers,
            roomId,
            gameId,
            currentIndex: currentNumberIndex + 1,
            totalNumbers: drawnNumbers.length
          });
        }

        // Auto-bingo for auto players in this specific room
        try {
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
              console.log(`🤖 Auto-bingo triggered for room ${roomId}, card ${cardId}`);
              await this.checkBingo(roomId, cardId, card.claimedBy, winningPattern);
              break; // stop loop after first auto-winner
            }
          }
        } catch (e) {
          console.error(`Auto-bingo error for room ${roomId}:`, e);
        }

        console.log(`🎲 Room ${roomId}: Drew number ${currentNumber} (${currentNumberIndex + 1}/${drawnNumbers.length})`);
      } catch (error) {
        console.error(`Error in number drawing for room ${roomId}:`, error);
        this.stopNumberDrawing(roomId);
      }
    }, 5000); // 5 second intervals

    this.numberDrawIntervals.set(roomId, drawInterval);
    console.log(`🎲 Started number drawing for room ${roomId}, game ${gameId}`);
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

  // Validate players and their balances before starting game
  async validatePlayersForGame(roomId, room) {
    const validPlayers = [];
    const invalidPlayers = [];
    
    if (!room?.players) return validPlayers;

    for (const [playerId, player] of Object.entries(room.players)) {
      try {
        // Check if player has a valid card
        if (!player.cardId || !room.bingoCards?.[player.cardId]) {
          invalidPlayers.push({ playerId, reason: 'No valid card' });
          continue;
        }

        const card = room.bingoCards[player.cardId];
        
        // Check if card is claimed by this player
        if (!card.claimed || card.claimedBy !== playerId) {
          invalidPlayers.push({ playerId, reason: 'Card not claimed by player' });
          continue;
        }

        // For non-demo rooms, check balance
        if (!room.isDemoRoom) {
          const userRef = ref(rtdb, `users/${playerId}`);
          const userSnap = await get(userRef);
          const user = userSnap.val();
          
          if (!user || (user.balance || 0) < room.betAmount) {
            invalidPlayers.push({ playerId, reason: 'Insufficient balance' });
            continue;
          }
        }

        // Player is valid
        validPlayers.push(player);
      } catch (error) {
        console.error(`Error validating player ${playerId}:`, error);
        invalidPlayers.push({ playerId, reason: 'Validation error' });
      }
    }

    // Remove invalid players from room
    if (invalidPlayers.length > 0) {
      await this.removeInvalidPlayers(roomId, invalidPlayers);
    }

    console.log(`✅ Validated ${validPlayers.length} players, removed ${invalidPlayers.length} invalid players`);
    return validPlayers;
  }

  // Remove invalid players from room
  async removeInvalidPlayers(roomId, invalidPlayers) {
    try {
      const roomRef = ref(rtdb, `rooms/${roomId}`);
      
      for (const { playerId } of invalidPlayers) {
        // Remove player from room
        await update(roomRef, {
          [`players/${playerId}`]: null
        });

        // Unclaim their card
        const playerRef = ref(rtdb, `rooms/${roomId}/players/${playerId}`);
        const playerSnap = await get(playerRef);
        const player = playerSnap.val();
        
        if (player?.cardId) {
          const cardRef = ref(rtdb, `rooms/${roomId}/bingoCards/${player.cardId}`);
          await update(cardRef, {
            claimed: false,
            claimedBy: null,
            auto: false,
            autoUntil: null
          });
        }

        console.log(`🗑️ Removed invalid player ${playerId} from room ${roomId}`);
      }

      // Notify clients about removed players
      if (this.io) {
        this.io.to(roomId).emit('playersRemoved', {
          roomId,
          removedPlayers: invalidPlayers.map(p => p.playerId),
          reasons: invalidPlayers.map(p => p.reason)
        });
      }
    } catch (error) {
      console.error("Error removing invalid players:", error);
    }
  }

  // Deduct bets from valid players only
  async deductBetsFromValidPlayers(roomId, gameData, validPlayers) {
    try {
      const roomRef = ref(rtdb, `rooms/${roomId}`);
      const roomSnap = await get(roomRef);
      const room = roomSnap.val();

      if (!room?.players) return;

      for (const player of validPlayers) {
        const playerId = player.telegramId || player.id;
        const betAmount = room.betAmount || 0;
        
        if (!room.isDemoRoom) {
          const balanceRef = ref(rtdb, `users/${playerId}/balance`);

          // Deduct balance
          await runTransaction(balanceRef, current => (current || 0) - betAmount);

          // Record deduction
          const deductRef = ref(rtdb, `deductRdbs/${uuidv4()}`);
          await set(deductRef, {
            id: uuidv4(),
            username: player.username,
            userId: playerId,
            amount: betAmount,
            gameId: gameData.id,
            roomId,
            date: Date.now()
          });
        }
      }

      await update(ref(rtdb, `games/${gameData.id}`), { betsDeducted: true });
      console.log(`💰 Deducted bets from ${validPlayers.length} valid players`);
    } catch (error) {
      console.error("Error deducting bets from valid players:", error);
    }
  }

  // Deduct bets from players (legacy method - kept for compatibility)
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

    // Pick one random winner card
    const winnerCard = cards[Math.floor(Math.random() * cards.length)];
    const patterns = this.pickPatternNumbers(winnerCard);
    const winnerPattern = patterns[Math.floor(Math.random() * patterns.length)];

    // Randomly choose 1 missing number from the winner pattern
    const winnerMissIndex = Math.floor(Math.random() * winnerPattern.length);
    const winnerMissing = winnerPattern[winnerMissIndex];

    // Add all other numbers from the winning pattern
    winnerPattern.forEach((n, i) => {
      if (i !== winnerMissIndex && n > 0 && n <= 75 && !usedNumbers.has(n)) {
        usedNumbers.add(n);
        drawnNumbers.push(n);
      }
    });

    // For other cards: pick a pattern & leave 1 missing
    const loserMissingNumbers = [];
    cards.forEach((card) => {
      if (card.id === winnerCard.id) return;

      const pats = this.pickPatternNumbers(card);
      const chosen = pats[Math.floor(Math.random() * pats.length)];

      const missIndex = Math.floor(Math.random() * chosen.length);
      chosen.forEach((n, i) => {
        if (i !== missIndex && n > 0 && n <= 75 && !usedNumbers.has(n)) {
          usedNumbers.add(n);
          drawnNumbers.push(n);
        }
      });

      loserMissingNumbers.push(chosen[missIndex]);
    });

    // Fill up to 24 numbers with random fillers
    while (drawnNumbers.length < 24) {
      const rand = Math.floor(Math.random() * 75) + 1;
      if (!usedNumbers.has(rand)) {
        usedNumbers.add(rand);
        drawnNumbers.push(rand);
      }
    }

    // Shuffle first 24 numbers
    const first24 = this.shuffleArray(drawnNumbers.slice(0, 24));

    // Make 25th number the winner's missing number
    const first25 = [...first24, winnerMissing];
    usedNumbers.add(winnerMissing);

    // Build 26–75 pool
    const rest = [];
    this.shuffleArray(loserMissingNumbers).forEach((n) => {
      if (!usedNumbers.has(n)) {
        usedNumbers.add(n);
        rest.push(n);
      }
    });

    // Fill remaining with random unused numbers
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
      const room = snap.val() || {};
  
      const bingoCards = room.bingoCards || {};
      const players = room.players || {};
  
      // Track players that should be kept
      const keepPlayers = new Set();
  
      // First pass: check each card
      for (const [cardId, card] of Object.entries(bingoCards)) {
        const claimedBy = card.claimedBy;
        let keepClaimed = false;
  
        if (claimedBy && card?.auto === true) {
          const autoUntil = card?.autoUntil || 0;
  
          // ✅ valid auto if still active and less than 24h away
          if (autoUntil > Date.now() && autoUntil - Date.now() <= 24 * 60 * 60 * 1000) {
            keepClaimed = true;
            keepPlayers.add(claimedBy);
          }
        }
  
        if (!keepClaimed) {
          // Reset the card
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
  
      console.log(`♻️ Room ${roomId} reset for next game`);
    } catch (error) {
      console.error("Error resetting room:", error);
    }
  }
  
  
}

// Export both the class and singleton instance
export default GameManager;
export const gameManager = GameManager.getInstance();
