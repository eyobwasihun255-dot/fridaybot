import { rtdb } from "../bot/firebaseConfig.js";
import { ref, get, set, update, runTransaction, onValue } from "firebase/database";
import { v4 as uuidv4 } from "uuid";

class GameManager {
  constructor() {
    this.activeGames = new Map(); // roomId -> game data
    this.numberDrawIntervals = new Map(); // roomId -> interval ID
    this.io = null; // Will be set when Socket.IO is initialized
  }

  setSocketIO(io) {
    this.io = io;
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

      const gameId = uuidv4();
      const playerIds = Object.keys(room.players || {});
      
      if (playerIds.length < 2) {
        throw new Error("Not enough players to start game");
      }

      // Generate drawn numbers and determine winners
      const cards = playerIds.map(pid => room.bingoCards[room.players[pid].cardId]);
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
        totalPayout: Math.floor((room.betAmount || 0) * playerIds.length * 0.9),
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
      await this.deductBets(roomId, gameData);

      // Save game data
      const gameRef = ref(rtdb, `games/${gameId}`);
      await set(gameRef, gameData);

      // Start number drawing
      this.startNumberDrawing(roomId, gameId);

      // Notify clients
      if (this.io) {
        this.io.to(roomId).emit('gameStarted', { roomId, gameId });
      }

      return { success: true, gameId, drawnNumbers, winners: gameData.winners };
    } catch (error) {
      console.error("Error starting game:", error);
      throw error;
    }
  }

  // Start number drawing process
  startNumberDrawing(roomId, gameId) {
    const gameRef = ref(rtdb, `games/${gameId}`);
    
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
      this.stopNumberDrawing(roomId);

      const gameRef = ref(rtdb, `games/${gameId}`);
      const gameSnap = await get(gameRef);
      const gameData = gameSnap.val();

      if (!gameData) return;

      // Update game status
      await update(gameRef, {
        status: "ended",
        endedAt: Date.now(),
        endReason: reason
      });

      // Update room status
      const roomRef = ref(rtdb, `rooms/${roomId}`);
      await update(roomRef, {
        gameStatus: "ended",
        nextGameCountdownEndAt: Date.now() + (30 * 1000) // 30 seconds until next game
      });

      // Process winners and payouts
      if (gameData.winners && gameData.winners.length > 0) {
        await this.processWinners(roomId, gameData);
      }

      // Notify clients
      if (this.io) {
        this.io.to(roomId).emit('gameEnded', {
          roomId,
          gameId,
          reason,
          winners: gameData.winners || []
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

      // Update room with winner info
      const roomRef = ref(rtdb, `rooms/${roomId}`);
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

      // Valid bingo - end game immediately
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
      const roomRef = ref(rtdb, `rooms/${roomId}`);
      await update(roomRef, {
        gameStatus: "waiting",
        gameId: null,
        calledNumbers: [],
        winner: null,
        payout: null,
        payed: false,
        nextGameCountdownEndAt: null
      });

      // Reset player attemptedBingo flags
      const roomSnap = await get(roomRef);
      const room = roomSnap.val();
      if (room?.players) {
        const updates = {};
        Object.keys(room.players).forEach(pid => {
          updates[`players/${pid}/attemptedBingo`] = false;
        });
        await update(roomRef, updates);
      }

      // Notify clients
      if (this.io) {
        this.io.to(roomId).emit('roomReset', { roomId });
      }

      console.log(`♻️ Room ${roomId} reset for next game`);
    } catch (error) {
      console.error("Error resetting room:", error);
    }
  }
}

export default GameManager;
