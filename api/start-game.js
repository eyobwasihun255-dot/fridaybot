import { rtdb } from "../bot/firebaseConfig.js";
import { ref, runTransaction, set as fbset, get, update } from "firebase/database";
import { v4 as uuidv4 } from "uuid";

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

function shuffleArray(array) {
  const arr = array.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// --- Generate drawn numbers in 3 stages for up to 3 winners ---
function generateDrawnNumbersMultiWinner(cards) {
  const winners = [];
  const drawn = new Set();

  const safeAdd = (set, n) => {
    if (n > 0 && n <= 75) set.add(n);
  };

  // --- Step 1: Stage 1 for first winner card ---
  if (cards.length > 0) {
    const card = cards[0];
    winners.push(card.id);
    const patterns = pickPatternNumbers(card);

    // Pick a random pattern
    const pattern = patterns[Math.floor(Math.random() * patterns.length)];

    // Add all but 1 number from the pattern
    const patternCopy = [...pattern];
    const missingIndex = Math.floor(Math.random() * patternCopy.length);
    patternCopy.splice(missingIndex, 1); // Remove one number to "almost" complete
    patternCopy.forEach(n => safeAdd(drawn, n));

    // Fill remaining numbers for stage 1 randomly until 25 total
    while (drawn.size < 25) {
      const num = Math.floor(Math.random() * 75) + 1;
      if (!drawn.has(num)) drawn.add(num);
    }
  }

  // --- Step 2: Stage 2 for 2nd and 3rd winner cards ---
  if (cards.length > 1) {
    const card = cards[1];
    winners.push(card.id);
    const patterns = pickPatternNumbers(card);
    const pattern = patterns[Math.floor(Math.random() * patterns.length)];
    pattern.forEach(n => safeAdd(drawn, n));
  }

  if (cards.length > 2) {
    const card = cards[2];
    winners.push(card.id);
    const patterns = pickPatternNumbers(card);
    const pattern = patterns[Math.floor(Math.random() * patterns.length)];
    pattern.forEach(n => safeAdd(drawn, n));
  }

  // --- Step 3: Fill remaining numbers until 50 ---
  while (drawn.size < 50) {
    const num = Math.floor(Math.random() * 75) + 1;
    if (!drawn.has(num)) drawn.add(num);
  }

  return {
    drawnNumbers: shuffleArray(Array.from(drawn).slice(0, 50)),
    winners
  };
}

// --- API Handler ---
export default async function handler(req, res) {
  const { roomId } = req.body;
  if (!roomId) return res.status(400).json({ error: "Missing roomId" });

  const roomRef = ref(rtdb, `rooms/${roomId}`);
  let gameData = null;
  let winnerIds = [];

  try {
    await runTransaction(roomRef, room => {
      if (!room || room.gameStatus !== "countdown") return room;

      const gameId = uuidv4();
      const playerIds = Object.keys(room.players || {});
      let drawnNumbers = [];

      if (playerIds.length > 0) {
        const cards = playerIds.map(pid => room.bingoCards[room.players[pid].cardId]);
        const { drawnNumbers: nums, winners } = generateDrawnNumbersMultiWinner(cards);
        drawnNumbers = nums;
        winnerIds = winners;
      } else {
        drawnNumbers = [];
      }

      const betAmount = room.betAmount || 0;
      const totalPayout = Math.floor(betAmount * playerIds.length * 0.9);

      gameData = {
        id: gameId,
        roomId,
        drawnNumbers,
        createdAt: Date.now(),
        startedAt: Date.now(),
        drawIntervalMs: 5000,
        status: "active",
        totalPayout,
        betsDeducted: false,
        winners: [] // will be filled with {id, userId, username, checked}
      };

      room.gameStatus = "playing";
      room.gameId = gameId;
      room.calledNumbers = [];
      room.countdownEndAt = null;
      room.countdownStartedBy = null;
      room.currentwinner = null;
      room.payed = false;

      return room;
    });

    if (!gameData) return res.status(400).json({ error: "Game already started or invalid state" });

    // ✅ Add checked & userId for each winner
   // Fetch current room data snapshot
const roomSnap = await get(roomRef);
const roomValue = roomSnap.val() || { bingoCards: {} };

// Add checked, userId & cardId for each winner
for (const cardId of winnerIds) {
  const card = Object.values(roomValue.bingoCards).find(c => c.id === cardId);
  const userId = card?.claimedBy || cardId;
  const userSnap = await get(ref(rtdb, `users/${userId}`));
  const userData = userSnap.val();
  const username = userData?.username || "Unknown";

  gameData.winners.push({
    id: uuidv4(),    // unique winner record ID
    cardId,
    userId,
    username,
    checked: false
  });
}


    const gameRef = ref(rtdb, `games/${gameData.id}`);
    const gameSnap = await get(gameRef);
    const existingGame = gameSnap.val();

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

    await fbset(gameRef, gameData);

    res.json({
      gameId: gameData.id,
      drawnNumbers: gameData.drawnNumbers,
      winners: gameData.winners
    });

  } catch (err) {
    console.error("❌ Error starting game:", err);
    res.status(500).json({ error: "Failed to start game" });
  }
}
