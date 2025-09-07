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
  const ranges = [
    { min: 1, max: 15 },
    { min: 16, max: 30 },
    { min: 31, max: 45 },
    { min: 46, max: 60 },
    { min: 61, max: 75 },
  ];

  const safeAdd = (set, n) => {
    if (n > 0 && n <= 75) set.add(n);
  };

  const winners = [];
  const drawn = new Set();

  // Helper: generate stage for a given card so it wins in that stage
  const generateStageForCard = (card, alreadyDrawnCount, targetTotalCount) => {
    const patterns = pickPatternNumbers(card);
    const pattern = patterns[Math.floor(Math.random() * patterns.length)];
    const stageSet = new Set();

    // Add missing numbers from the pattern that are not yet drawn
    pattern.forEach(n => {
      if (!drawn.has(n)) safeAdd(stageSet, n);
    });

    // Fill up with random numbers until we reach the target count for this stage
    while (drawn.size + stageSet.size < targetTotalCount) {
      const num = Math.floor(Math.random() * 75) + 1;
      if (!drawn.has(num)) stageSet.add(num);
    }

    // Add stage numbers to main drawn set
    stageSet.forEach(n => drawn.add(n));

    return Array.from(stageSet);
  };

  // Stage 1: first winner (numbers 1–25)
  if (cards.length > 0) {
    winners.push(cards[0].id);
    generateStageForCard(cards[0], 0, 25);
  }

  // Stage 2: second winner (numbers 26–35)
  if (cards.length > 1) {
    winners.push(cards[1].id);
    generateStageForCard(cards[1], 25, 35);
  }

  // Stage 3: third winner (numbers 36–50)
  if (cards.length > 2) {
    winners.push(cards[2].id);
    generateStageForCard(cards[2], 35, 50);
  }

  // Fill remaining if less than 50
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
        winners: [] // will be filled after fetching usernames
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

    // Fetch winners’ usernames in order
    for (const wid of winnerIds) {
      const userSnap = await get(ref(rtdb, `users/${wid}`));
      const userData = userSnap.val();
      const username = userData?.username || "Unknown";
      gameData.winners.push({ id: wid, username });
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
