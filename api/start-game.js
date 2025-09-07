import { rtdb } from "../bot/firebaseConfig.js";
import { ref, runTransaction, set as fbset, get, update } from "firebase/database";
import { v4 as uuidv4 } from "uuid";

// --- Generate 25 unique numbers randomly within partitions ---
function generateNumbers() {
  const ranges = [
    { min: 1, max: 15 },
    { min: 16, max: 30 },
    { min: 31, max: 45 },
    { min: 46, max: 60 },
    { min: 61, max: 75 },
  ];

  const finalNumbers = [];

  for (const { min, max } of ranges) {
    const partitionNumbers = new Set();
    while (partitionNumbers.size < 5) {
      const num = Math.floor(Math.random() * (max - min + 1)) + min;
      partitionNumbers.add(num);
    }
    finalNumbers.push(...partitionNumbers);
  }

  return finalNumbers;
}

// --- Pick winning patterns from a card ---
function pickPatternNumbers(card) {
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

// --- Generate drawn numbers ensuring exactly one winner ---
function generateDrawnNumbersTwoStage(winnerCard, allCards) {
  const ranges = [
    { min: 1, max: 15 },
    { min: 16, max: 30 },
    { min: 31, max: 45 },
    { min: 46, max: 60 },
    { min: 61, max: 75 },
  ];

  const safeAdd = (set, n) => {
    if (n > 0 && n <= 75) set.add(n);
  };

  // --- Stage 1: Winner's pattern (first 25 numbers)
  const winnerPatterns = pickPatternNumbers(winnerCard);
  const winnerPattern = winnerPatterns[Math.floor(Math.random() * winnerPatterns.length)];

  const stage1Set = new Set();
  winnerPattern.forEach(n => safeAdd(stage1Set, n));

  // Fill stage 1 up to 25 numbers, respecting BINGO column limits
  const partitioned = ranges.map(() => new Set());
  stage1Set.forEach(num => {
    for (let i = 0; i < ranges.length; i++) {
      if (num >= ranges[i].min && num <= ranges[i].max) partitioned[i].add(num);
    }
  });

  for (let i = 0; i < ranges.length; i++) {
    const { min, max } = ranges[i];
    while (partitioned[i].size < 5) {
      const num = Math.floor(Math.random() * (max - min + 1)) + min;
      partitioned[i].add(num);
    }
  }

  const first25 = [];
  partitioned.forEach(set => first25.push(...set));

  // --- Stage 2: Missing one number for each other card (numbers 26–50)
  const stage2Set = new Set();

  allCards.forEach(card => {
    if (card.id === winnerCard.id) return; // skip winner

    const patterns = pickPatternNumbers(card);

    // Find a pattern that is missing exactly 1 number from first 25
    for (const pattern of patterns) {
      const missing = pattern.filter(n => !first25.includes(n));
      if (missing.length === 1) {
        const num = missing[0];
        if (!winnerPattern.includes(num)) { // avoid giving winner's pattern numbers again
          safeAdd(stage2Set, num);
        }
        break; // Only need one per card
      }
    }
  });

  // Fill remaining numbers for stage 2 randomly without duplicates
  while (stage2Set.size < 25) {
    const num = Math.floor(Math.random() * 75) + 1;
    if (!first25.includes(num) && !winnerPattern.includes(num)) {
      stage2Set.add(num);
    }
  }

  const second25 = Array.from(stage2Set);

  // --- Combine and shuffle within each stage
  const drawnNumbers = [...shuffleArray(first25), ...shuffleArray(second25)];
  return drawnNumbers;
}

function shuffleArray(array) {
  const arr = array.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// --- API Handler ---
export default async function handler(req, res) {
  const { roomId } = req.body;
  if (!roomId) return res.status(400).json({ error: "Missing roomId" });

  const roomRef = ref(rtdb, `rooms/${roomId}`);
  let gameData = null;
  let winnerId = null;

  try {
    // Run transaction to start game
    await runTransaction(roomRef, room => {
      if (!room || room.gameStatus !== "countdown") return room;

      const gameId = uuidv4();
      const playerIds = Object.keys(room.players || {});
      let drawnNumbers = [];
      let winnerCard = null;

      if (playerIds.length > 0) {
        winnerId = playerIds[Math.floor(Math.random() * playerIds.length)];
        winnerCard = room.bingoCards && room.players[winnerId]
          ? room.bingoCards[room.players[winnerId].cardId]
          : null;

        const allCards = room.bingoCards ? Object.values(room.bingoCards) : [];
        const numbersForWinner = winnerCard
          ? generateDrawnNumbersForWinner(winnerCard, allCards)
          : generateNumbers();

        drawnNumbers = shuffleArray(numbersForWinner);
      } else {
        drawnNumbers = generateNumbers();
      }

      const betAmount = room.betAmount || 0;
      const totalPayout = Math.floor(betAmount * playerIds.length * 0.9);

      gameData = {
        id: gameId,
        roomId,
        drawnNumbers,
        winnerCard,
        createdAt: Date.now(),
        startedAt: Date.now(),
        drawIntervalMs: 5000,
        status: "active",
        totalPayout,
        betsDeducted: false,
        winner: null // <-- will assign after fetching username
      };

      // Update room
      room.gameStatus = "playing";
      room.gameId = gameId;
      room.calledNumbers = [];
      room.countdownEndAt = null;
      room.countdownStartedBy = null;
      
      room.currentwinner = winnerId ? winnerId : null;
      room.payed = false; 

      return room;
    });

    if (!gameData) return res.status(400).json({ error: "Game already started or invalid state" });

    // ✅ Fetch winner’s username
    if (winnerId) {
      const userSnap = await get(ref(rtdb, `users/${winnerId}`));
      const userData = userSnap.val();
      const username = userData?.username || "Unknown";
      gameData.winner = username;
      // <-- store username directly in game entity
    }

    const gameRef = ref(rtdb, `games/${gameData.id}`);
    const gameSnap = await get(gameRef);
    const existingGame = gameSnap.val();

    // Deduct bets only once
    if (!existingGame?.betsDeducted) {
      const roomSnap = await get(roomRef);
      const roomValue = roomSnap.val();

      if (roomValue?.players) {
        for (const playerId of Object.keys(roomValue.players)) {
          const balanceRef = ref(rtdb, `users/${playerId}/balance`);
          await runTransaction(balanceRef, current => (current || 0) - (roomValue.betAmount || 0));
        }
      }

      await update(gameRef, { betsDeducted: true });
    }

    // Save game data
    await fbset(gameRef, gameData);

    res.json({
      gameId: gameData.id,
      drawnNumbers: gameData.drawnNumbers,
      winner: gameData.winner,
      winnerCard: gameData.winnerCard ? [gameData.winnerCard] : [],
    });

  } catch (err) {
    console.error("❌ Error starting game:", err);
    res.status(500).json({ error: "Failed to start game" });
  }
}
