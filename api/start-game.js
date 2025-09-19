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

  const safeAdd = (num) => {
    if (num > 0 && num <= 75 && !usedNumbers.has(num)) {
      usedNumbers.add(num);
      drawnNumbers.push(num);
      return true;
    }
    return false;
  };

  if (!cards || cards.length === 0) {
    return { drawnNumbers: [], winners: [] };
  }

  // 1️⃣ Pick one random winner card
  const winnerCard = cards[Math.floor(Math.random() * cards.length)];

  // 2️⃣ Pick one winning pattern for this card
  const patterns = pickPatternNumbers(winnerCard);
  const winnerPattern = patterns[Math.floor(Math.random() * patterns.length)];

  // 3️⃣ Add the FULL winning pattern numbers
  winnerPattern.forEach((n) => safeAdd(n));

  // 4️⃣ For other cards: pick a pattern & leave 1 missing
  const missingNumbers = [];
  cards.forEach((card) => {
    if (card.id === winnerCard.id) return; // skip winner

    const pats = pickPatternNumbers(card);
    const chosen = pats[Math.floor(Math.random() * pats.length)];

    // Randomly drop 1 number from this pattern
    const missIndex = Math.floor(Math.random() * chosen.length);
    chosen.forEach((n, i) => {
      if (i !== missIndex) safeAdd(n);
    });

    // Save the missing number for later (will be in 26–75 range)
    missingNumbers.push(chosen[missIndex]);
  });

  // 5️⃣ Fill up to 25 numbers total
  while (drawnNumbers.length < 25) {
    safeAdd(Math.floor(Math.random() * 75) + 1);
  }

  // Shuffle first 25 numbers
  const first25 = shuffleArray(drawnNumbers.slice(0, 25));

  // 6️⃣ From 26–75: put missing numbers first, then fill rest
  const rest = [];
  missingNumbers.forEach((n) => {
    if (!usedNumbers.has(n)) {
      usedNumbers.add(n);
      rest.push(n);
    }
  });

  while (first25.length + rest.length < 75) {
    const rand = Math.floor(Math.random() * 75) + 1;
    if (!usedNumbers.has(rand)) {
      usedNumbers.add(rand);
      rest.push(rand);
    }
  }

  const finalDrawn = [...first25, ...shuffleArray(rest)];

  winners.push(winnerCard.id);

  return { drawnNumbers: finalDrawn, winners };
}


// --- API Handler ---
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
        winners: []
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

    // ✅ Reset attemptedBingo for all players in this room
    const roomSnap = await get(roomRef);
    const roomValue = roomSnap.val() || {};
    if (roomValue?.players) {
      const updates = {};
      Object.keys(roomValue.players).forEach(pid => {
        updates[`players/${pid}/attemptedBingo`] = false;
      });
      await update(roomRef, updates);
    }

    // ✅ Add winners with userId & checked
    const roomValue2 = (await get(roomRef)).val() || { bingoCards: {} };
    for (const cardId of winnerIds) {
      const card = Object.values(roomValue2.bingoCards).find(c => c.id === cardId);
      const userId = card?.claimedBy || cardId;
      const userSnap = await get(ref(rtdb, `users/${userId}`));
      const userData = userSnap.val();
      const username = userData?.username || "Unknown";

      gameData.winners.push({
        id: uuidv4(),
        cardId,
        userId,
        username,
        checked: false
      });
    }

    // ✅ Deduct bets (same as before)...
    const gameRef = ref(rtdb, `games/${gameData.id}`);
    const gameSnap = await get(gameRef);
    const existingGame = gameSnap.val();

    if (!existingGame?.betsDeducted) {
      const roomSnap = await get(roomRef);
      const roomValue = roomSnap.val();

      if (roomValue?.players) {
        for (const playerId of Object.keys(roomValue.players)) {
          const betAmount = roomValue.betAmount || 0;
          const balanceRef = ref(rtdb, `users/${playerId}/balance`);

          // Deduct balance
          await runTransaction(balanceRef, current => (current || 0) - betAmount);

          // Get user details
          const userSnap = await get(ref(rtdb, `users/${playerId}`));
          const userData = userSnap.val() || {};
          const username = userData.username || "Unknown";

          // Register deduction log
          const deductId = uuidv4();
          const deductRef = ref(rtdb, `deductRdbs/${deductId}`);
          await fbset(deductRef, {
            id: deductId,
            username,
            userId: playerId,
            amount: betAmount,
            gameId: gameData.id,
            roomId,
            date: Date.now()
          });
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
