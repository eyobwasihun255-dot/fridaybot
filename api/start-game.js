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

  if (cards.length === 0) {
    return { drawnNumbers: [], winners: [] };
  }

  // Pick up to 3 winners randomly
  const shuffledCards = shuffleArray(cards);
  const chosenWinners = shuffledCards.slice(0, 3);

  // Pick patterns for each winner
  const winnerPatterns = chosenWinners.map(card => {
    const patterns = pickPatternNumbers(card);
    return patterns[Math.floor(Math.random() * patterns.length)];
  });

  // --- Stage 1 (0–24) ---
  {
    const [card, pattern] = [chosenWinners[0], winnerPatterns[0]];
    winners.push(card.id);

    // Add pattern numbers, but leave 1 missing
    const missingIdx = Math.floor(Math.random() * pattern.length);
    pattern.forEach((n, i) => {
      if (i !== missingIdx) safeAdd(drawnNumbers, n);
    });

    // For other cards, try to add most of their pattern but leave 1–2 missing
    for (let ci = 1; ci < cards.length; ci++) {
      const otherCard = cards[ci];
      const patterns = pickPatternNumbers(otherCard);
      const pat = patterns[Math.floor(Math.random() * patterns.length)];
      const missCount = Math.random() < 0.5 ? 1 : 2;
      const missing = new Set(
        shuffleArray(pat).slice(0, missCount)
      );
      pat.forEach(n => {
        if (!missing.has(n)) safeAdd(drawnNumbers, n);
      });
    }

    // Fill until exactly 25
    while (drawnNumbers.length < 25) {
      safeAdd(drawnNumbers, Math.floor(Math.random() * 75) + 1);
    }
  }

  // --- Stage 2 (25–34) ---
  if (chosenWinners[1]) {
    const [card, pattern] = [chosenWinners[1], winnerPatterns[1]];
    winners.push(card.id);

    // Add missing numbers from this pattern
    pattern.forEach(n => safeAdd(drawnNumbers, n));

    // Fill up to index 35
    while (drawnNumbers.length < 35) {
      safeAdd(drawnNumbers, Math.floor(Math.random() * 75) + 1);
    }
  }

  // --- Stage 3 (35–49) ---
  if (chosenWinners[2]) {
    const [card, pattern] = [chosenWinners[2], winnerPatterns[2]];
    winners.push(card.id);

    // Add missing numbers from this pattern
    pattern.forEach(n => safeAdd(drawnNumbers, n));

    // Fill up to 50
    while (drawnNumbers.length < 50) {
      safeAdd(drawnNumbers, Math.floor(Math.random() * 75) + 1);
    }
  } else {
    // If less than 3 winners, just fill until 50
    while (drawnNumbers.length < 50) {
      safeAdd(drawnNumbers, Math.floor(Math.random() * 75) + 1);
    }
  }

  return { drawnNumbers, winners };
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
