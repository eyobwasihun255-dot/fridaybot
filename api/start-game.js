import { rtdb } from "../bot/firebaseConfig.js";
import { ref, runTransaction, set as fbset } from "firebase/database";
import { v4 as uuidv4 } from "uuid";

function generateNumbers(count = 25) {
  const numbers = [];
  while (numbers.length < count) {
    const num = Math.floor(Math.random() * 75) + 1;
    if (!numbers.includes(num)) numbers.push(num);
  }
  return numbers;
}
function pickWinningNumbers(card) {
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

  // Pick a random winning pattern
  const winningPattern = patterns[Math.floor(Math.random() * patterns.length)];
  // Generate the rest of the numbers randomly
   const allNumbers = new Set(winningPattern);
  while (allNumbers.size < 25) { // or up to 75 for full pool
    const num = Math.floor(Math.random() * 75) + 1;
    allNumbers.add(num);
  }

    return Array.from(allNumbers);
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
      // pick a random card from room players
const playerIds = Object.keys(room.players || {});
let drawnNumbers = [];
if (playerIds.length > 0) {
  const randomPlayerId = playerIds[Math.floor(Math.random() * playerIds.length)];
  const player = room.players[randomPlayerId];
  const cardId = player.cardId;

  // Lookup the card from room.bingoCards
  const card = room.bingoCards?.[cardId];

  if (card && card.numbers) {
    // Pick a winning pattern for the selected card
    let winningNumbers = pickWinningNumbers(card);

    // Now modify slightly so other cards "almost" win
    const allOtherCards = Object.values(room.bingoCards || {}).filter(c => c.id !== cardId);
    const almostNumbers = new Set(winningNumbers);

    allOtherCards.forEach(otherCard => {
      if (!otherCard?.numbers) return; 

      // Pick 1 or 2 numbers from their potential bingo row/col/diagonal to avoid full match
      const flatNumbers = otherCard.numbers.flat();
      const randomMissCount = Math.min(2, flatNumbers.length);
      let missNumbers = [];

      while (missNumbers.length < randomMissCount) {
        const n = flatNumbers[Math.floor(Math.random() * flatNumbers.length)];
        if (!missNumbers.includes(n)) missNumbers.push(n);
      }

      // Remove 1–2 numbers from the final drawn set to make other cards miss
       missNumbers.forEach(n => almostNumbers.delete(n));

    // Ensure minimum pool of numbers (25 or more)
    while (almostNumbers.size < 25) {
      const num = Math.floor(Math.random() * 75) + 1;
      almostNumbers.add(num);
    }

    drawnNumbers = Array.from(almostNumbers);
    });

    drawnNumbers = Array.from(almostNumbers);
  } else {
    drawnNumbers = generateNumbers(); // fallback
  }
} else {
  drawnNumbers = generateNumbers(); // fallback
}


      const drawIntervalMs = 2000;

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

    res.json({ gameId: gameData.id, drawnNumbers: gameData.drawnNumbers });
  } catch (err) {
    console.error("❌ Error starting game:", err);
    res.status(500).json({ error: "Failed to start game" });
  }
}
