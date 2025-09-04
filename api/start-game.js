import { rtdb } from "../bot/firebaseConfig.js";
import { ref, runTransaction, set as fbset } from "firebase/database";
import { v4 as uuidv4 } from "uuid";

// --- Generate 25 unique random numbers for fallback ---
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

  // --- Winner pattern ---
  const winnerPatterns = pickPatternNumbers(winnerCard);
  const winnerPattern = winnerPatterns[Math.floor(Math.random() * winnerPatterns.length)];
  winnerPattern.forEach(safeAdd);

  // --- Losers almost win (miss 1 number from pattern) ---
  const losers = allCards.filter(c => c.id !== winnerCard.id);
  for (const card of losers) {
    if (drawnNumbers.size >= 25) break;
    const patterns = pickPatternNumbers(card);
    const pattern = patterns[Math.floor(Math.random() * patterns.length)];
    const missingNumber = pattern[Math.floor(Math.random() * pattern.length)]; // one number missing
    for (const n of pattern) {
      if (n !== missingNumber && drawnNumbers.size < 25) safeAdd(n);
    }
  }

  // --- Fill remaining numbers randomly ---
  while (drawnNumbers.size < 25) {
    safeAdd(Math.floor(Math.random() * 75) + 1);
  }

  // --- Trim to 25 numbers exactly ---
  return Array.from(drawnNumbers).slice(0, 25);
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
