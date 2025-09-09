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
// --- Generate drawn numbers with exactly ONE winner ---
function generateDrawnNumbersSingleWinner(cards) {
  if (cards.length === 0) {
    return { drawnNumbers: [], winners: [] };
  }

  const usedNumbers = new Set();
  const drawnNumbers = [];

  const safeAdd = (arr, num) => {
    if (num > 0 && num <= 75 && !usedNumbers.has(num)) {
      usedNumbers.add(num);
      arr.push(num);
      return true;
    }
    return false;
  };

  // --- Step 1: Pick exactly 1 winner card ---
  const winnerCard = cards[Math.floor(Math.random() * cards.length)];

  // --- Step 2: Pick a random pattern from this card ---
  const patterns = pickPatternNumbers(winnerCard);
  const winningPattern = patterns[Math.floor(Math.random() * patterns.length)];

  // --- Step 3: Ensure all winning pattern numbers are in the first 25 ---
  shuffleArray(winningPattern).forEach(n => safeAdd(drawnNumbers, n));

  // --- Step 4: Fill remaining slots until 25 with random unique numbers ---
  while (drawnNumbers.length < 25) {
    safeAdd(drawnNumbers, Math.floor(Math.random() * 75) + 1);
  }

  // --- Step 5: Add the rest (26–75) with all unused numbers ---
  const allNums = Array.from({ length: 75 }, (_, i) => i + 1);
  const remaining = allNums.filter(n => !usedNumbers.has(n));
  shuffleArray(remaining).forEach(n => safeAdd(drawnNumbers, n));

  // ✅ Now drawnNumbers has 75 numbers:
  // - Rolls 1–25 contain a full winning pattern (plus fillers)
  // - Rolls 26–75 are the rest without duplicates

  return { drawnNumbers, winners: [winnerCard.id] };
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
