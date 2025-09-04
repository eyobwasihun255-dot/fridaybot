import { rtdb } from "../bot/firebaseConfig.js";
import { ref, runTransaction, set as fbset } from "firebase/database";
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

// --- Generate drawn numbers ensuring exactly one winner ---
function generateDrawnNumbersForWinner(winnerCard, allCards) {
  const drawnNumbers = new Set();
  const ranges = [
    { min: 1, max: 15 },
    { min: 16, max: 30 },
    { min: 31, max: 45 },
    { min: 46, max: 60 },
    { min: 61, max: 75 },
  ];

  const safeAdd = (n) => {
    if (n > 0 && n <= 75) drawnNumbers.add(n);
  };

  // --- Pick one winning pattern for the winner ---
  const winnerPatterns = pickPatternNumbers(winnerCard);
  const winnerPattern = winnerPatterns[Math.floor(Math.random() * winnerPatterns.length)];
  winnerPattern.forEach(safeAdd);

  // --- Fill each partition with 5 numbers exactly ---
  const partitionedNumbers = ranges.map(() => new Set());

  // Add winner numbers to proper partitions
  drawnNumbers.forEach(num => {
    for (let i = 0; i < ranges.length; i++) {
      if (num >= ranges[i].min && num <= ranges[i].max) partitionedNumbers[i].add(num);
    }
  });

  // Fill partitions to exactly 5 numbers
  for (let i = 0; i < ranges.length; i++) {
    const { min, max } = ranges[i];
    while (partitionedNumbers[i].size < 5) {
      const num = Math.floor(Math.random() * (max - min + 1)) + min;
      partitionedNumbers[i].add(num);
    }
  }

  // Combine all partitions
  const finalNumbers = [];
  partitionedNumbers.forEach(set => finalNumbers.push(...set));

  return finalNumbers;
}
function shuffleArray(array) {
  const arr = array.slice(); // copy
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = arr[i];
    arr[i] = arr[j];
    arr[j] = temp;
  }
  return arr;
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
winnerCard = room.bingoCards && room.players[winnerId]
  ? room.bingoCards[room.players[winnerId].cardId]
  : null;

const allCards = room.bingoCards ? Object.values(room.bingoCards) : [];

var numbersForWinner = winnerCard
  ? generateDrawnNumbersForWinner(winnerCard, allCards)
  : generateNumbers();

// Shuffle numbers before assigning
drawnNumbers = shuffleArray(numbersForWinner);

      } else {
        drawnNumbers = generateNumbers();
      }

      const drawIntervalMs = 5000;

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
    // --- Deduct betAmount from each player's balance ---
if (room.players) {
  const updates = {};
  for (const playerId of Object.keys(room.players)) {
    const player = room.players[playerId];
    if (!player) continue;

    const playerRefPath = `users/${playerId}/balance`;
    // Prepare transaction-style update for atomic decrement
    updates[playerRefPath] = (r) => (r || 0) - (room.betAmount || 0);
  }

  // Run transactions individually
  for (const playerId of Object.keys(room.players)) {
    const balanceRef = ref(rtdb, `users/${playerId}/balance`);
    await runTransaction(balanceRef, (current) => {
      return (current || 0) - (room.betAmount || 0);
    });
  }
}

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
