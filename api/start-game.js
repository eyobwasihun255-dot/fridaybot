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

  const generateStageForCard = (card, alreadyDrawnCount, targetTotalCount) => {
    const patterns = pickPatternNumbers(card);
    const pattern = patterns[Math.floor(Math.random() * patterns.length)];
    const stageSet = new Set();

    pattern.forEach(n => {
      if (!drawn.has(n)) safeAdd(stageSet, n);
    });

    while (drawn.size + stageSet.size < targetTotalCount) {
      const num = Math.floor(Math.random() * 75) + 1;
      if (!drawn.has(num)) stageSet.add(num);
    }

    stageSet.forEach(n => drawn.add(n));

    return Array.from(stageSet);
  };

  if (cards.length > 0) {
    winners.push(cards[0].id);
    generateStageForCard(cards[0], 0, 25);
  }

  if (cards.length > 1) {
    winners.push(cards[1].id);
    generateStageForCard(cards[1], 25, 35);
  }

  if (cards.length > 2) {
    winners.push(cards[2].id);
    generateStageForCard(cards[2], 35, 50);
  }

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
    for (const wid of winnerIds) {
      const userSnap = await get(ref(rtdb, `users/${wid}`));
      const userData = userSnap.val();
      const username = userData?.username || "Unknown";

      gameData.winners.push({
        id: wid,
        userId: wid,
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
