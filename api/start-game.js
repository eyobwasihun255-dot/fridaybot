import { rtdb } from "../bot/firebaseConfig.js";
import { ref, runTransaction, set as fbset } from "firebase/database";
import { v4 as uuidv4 } from "uuid";
function generateNumbers(count = 25) {
  const numbers = [];
  while (numbers.length < count) {
    const num = Math.floor(Math.random() * 75) + 1; // 1–75 only
    if (!numbers.includes(num)) numbers.push(num);
  }
  return numbers;
}

// --- Winning patterns for a given card ---
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

  // Small cross
  patterns.push([
    numbers[center][center],
    numbers[center - 1][center],
    numbers[center + 1][center],
    numbers[center][center - 1],
    numbers[center][center + 1],
  ]);

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

// --- Generate drawn numbers ensuring exactly one winner and others almost winning ---
function generateDrawnNumbersForWinner(winnerCard, allCards) {
  const drawnNumbers = new Set();
  const safeAdd = (n) => {
    if (typeof n === "number" && n > 0 && n <= 75) drawnNumbers.add(n);
  };

  // Helper to get a random number from a range, excluding existing drawn numbers
  const getRandomNumberFromRange = (min, max, excludeSet) => {
    let num;
    do {
      num = Math.floor(Math.random() * (max - min + 1)) + min;
    } while (excludeSet.has(num));
    return num;
  };

  // --- 1. Determine winner pattern and add its numbers ---
  const winnerPatterns = pickPatternNumbers(winnerCard);
  const winnerPattern = winnerPatterns[Math.floor(Math.random() * winnerPatterns.length)];
  winnerPattern.forEach(safeAdd);

  // --- 2. For each loser card, select a pattern and add all but one number ---
  const losers = allCards.filter(c => c.id !== winnerCard.id);
  for (const card of losers) {
    const patterns = pickPatternNumbers(card);
    const pattern = patterns[Math.floor(Math.random() * patterns.length)];
    const missingNumber = pattern[Math.floor(Math.random() * pattern.length)]; // One number will be missing
    for (const n of pattern) {
      if (n !== missingNumber) safeAdd(n);
    }
  }

  // --- 3. Ensure 25 numbers with partitioning (5 from 1-15, 5 from 16-30, etc.) ---
  const finalDrawnNumbers = new Set();
  const ranges = [
    { min: 1, max: 15 },
    { min: 16, max: 30 },
    { min: 31, max: 45 },
    { min: 46, max: 60 },
    { min: 61, max: 75 },
  ];

  // Add numbers from drawnNumbers (winner/loser patterns) into partitioned sets
  const partitionedNumbers = ranges.map(() => new Set());
  drawnNumbers.forEach(num => {
    for (let i = 0; i < ranges.length; i++) {
      if (num >= ranges[i].min && num <= ranges[i].max) {
        partitionedNumbers[i].add(num);
        break;
      }
    }
  });

  // Fill each partition to 5 numbers if possible, prioritizing numbers already in drawnNumbers
  for (let i = 0; i < ranges.length; i++) {
    while (partitionedNumbers[i].size < 5) {
      const num = getRandomNumberFromRange(ranges[i].min, ranges[i].max, partitionedNumbers[i]);
      partitionedNumbers[i].add(num);
    }
  }

  // Combine all partitioned numbers and ensure total is 25
  partitionedNumbers.forEach(set => set.forEach(num => finalDrawnNumbers.add(num)));

  // If for some reason we have less than 25 (e.g., overlapping numbers in patterns),
  // fill with random numbers from appropriate ranges until 25.
  while (finalDrawnNumbers.size < 25) {
    const randomRangeIndex = Math.floor(Math.random() * ranges.length);
    const num = getRandomNumberFromRange(ranges[randomRangeIndex].min, ranges[randomRangeIndex].max, finalDrawnNumbers);
    finalDrawnNumbers.add(num);
  }

  // Trim to 25 numbers exactly if more were added (unlikely with the current logic but for safety)
  return Array.from(finalDrawnNumbers).slice(0, 25);
}

// --- API Handler ---
export default async function handler(req, res) {
  const { roomId } = req.body;
  if (!roomId) return res.status(400).json({ error: "Missing roomId" });

  const roomRef = ref(rtdb, `rooms/${roomId}`);
  let gameData = null;

  try {
    await runTransaction(roomRef, (room) => {
      if (!room || room.gameStatus !== "countdown") return room;

      const gameId = uuidv4();
      const playerIds = Object.keys(room.players || {});
      let drawnNumbers = [];
      let winnerCard = null;

      if (playerIds.length > 0) {
        // Pick exactly one winner
        const winnerId = playerIds[Math.floor(Math.random() * playerIds.length)];
        winnerCard = room.bingoCards?.[room.players[winnerId].cardId];

        const allCards = Object.values(room.bingoCards || {});
        drawnNumbers = winnerCard ? generateDrawnNumbersForWinner(winnerCard, allCards) : generateNumbers();
      } else {
        drawnNumbers = generateNumbers(); // fallback if no players
      }

      const drawIntervalMs = 3000;

      // --- Update room state ---
      room.gameStatus = "playing";
      room.gameId = gameId;
      room.calledNumbers = [];
      room.countdownEndAt = null;
      room.countdownStartedBy = null;

      const betAmount = room.betAmount || 0;
      const playerCount = room.players ? Object.keys(room.players).length : 0;
      const totalPayout = Math.floor(betAmount * playerCount * 0.9);

      gameData = {
        id: gameId,
        roomId,
        drawnNumbers,
        winnerCard,
        createdAt: Date.now(),
        startedAt: Date.now(),
        drawIntervalMs,
        status: "active",
        totalPayout,
      };

      return room;
    });

    if (!gameData) return res.status(400).json({ error: "Game already started or invalid state" });

    const gameRef = ref(rtdb, `games/${gameData.id}`);
    await fbset(gameRef, gameData);

    res.json({
      gameId: gameData.id,
      drawnNumbers: gameData.drawnNumbers,
      winnerCard: gameData.winnerCard,
    });
  } catch (err) {
    console.error("❌ Error starting game:", err);
    res.status(500).json({ error: "Failed to start game" });
  }
}

