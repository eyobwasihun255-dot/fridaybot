import { rtdb } from "../bot/firebaseConfig.js";
import { ref, runTransaction, set as fbset } from "firebase/database";
import { v4 as uuidv4 } from "uuid";

// Generate 25 unique random numbers for fallback
function generateNumbers(count = 25) {
  const numbers = [];
  while (numbers.length < count) {
    const num = Math.floor(Math.random() * 75) + 1;
    if (!numbers.includes(num)) numbers.push(num);
  }
  return numbers;
}

// Winning patterns for a given card
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

// Generate drawn numbers ensuring winners get their patterns
function generateDrawnNumbersForWinners(winnerCards, allCards) {
  const drawnNumbers = new Set<number>();

  // Add winning patterns for winners
  winnerCards.forEach(card => {
    const patterns = pickPatternNumbers(card);
    const pattern = patterns[Math.floor(Math.random() * patterns.length)];
    pattern.forEach(n => drawnNumbers.add(n));
  });

  // Make losers almost win
  const losers = allCards.filter(c => !winnerCards.includes(c));
  losers.forEach(card => {
    const patterns = pickPatternNumbers(card);
    const pattern = patterns[Math.floor(Math.random() * patterns.length)];
    const missingNumber = pattern[Math.floor(Math.random() * pattern.length)];
    pattern.forEach(n => {
      if (n !== missingNumber) drawnNumbers.add(n);
    });
  });

  // Fill with random numbers until at least 25
  while (drawnNumbers.size < 25) {
    drawnNumbers.add(Math.floor(Math.random() * 75) + 1);
  }

  return Array.from(drawnNumbers);
}

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
      let drawnNumbers: number[] = [];
      let winnerCards: any[] = []; // ✅ collect winner cards

      if (playerIds.length > 0) {
        const numWinners = playerIds.length > 50 ? 2 : 1;

        // Pick unique winner(s)
        const winnerIds: string[] = [];
        while (winnerIds.length < numWinners) {
          const candidate = playerIds[Math.floor(Math.random() * playerIds.length)];
          if (!winnerIds.includes(candidate)) winnerIds.push(candidate);
        }

        // Collect winner cards
        winnerCards = winnerIds.map(id => {
          const cardId = room.players[id].cardId;
          return room.bingoCards?.[cardId];
        }).filter(Boolean);

        const allCards = Object.values(room.bingoCards || {});
        drawnNumbers = generateDrawnNumbersForWinners(winnerCards, allCards);
      } else {
        drawnNumbers = generateNumbers(); // fallback
      }

      const drawIntervalMs = 3000;

      // Update room state
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
        winnerCards, // ✅ include winner cards
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

    // Respond with winners and numbers
    res.json({
      gameId: gameData.id,
      drawnNumbers: gameData.drawnNumbers,
      winnerCards: gameData.winnerCards,
    });
  } catch (err) {
    console.error("❌ Error starting game:", err);
    res.status(500).json({ error: "Failed to start game" });
  }
}
