import { rtdb } from "../bot/firebaseConfig.js";
import { ref, get, set, update, runTransaction, onValue } from "firebase/database";
import { platform } from "os";
import { v4 as uuidv4 } from "uuid";
class GameManager {
  constructor() {
    this.activeGames = new Map(); // roomId -> game data
    this.numberDrawIntervals = new Map(); // roomId -> interval ID
    this.countdownTimers = new Map(); // roomId -> timeout ID
    this.resetRoomTimers = new Map(); // roomId -> timeout ID for scheduled reset
    this.lastWinnerUserByRoom = new Map(); // roomId -> userId
    this.io = null; // Will be set when Socket.IO is initialized
  }

  // Singleton pattern
  static getInstance() {
    if (!GameManager.instance) {
      GameManager.instance = new GameManager();
    }
    return GameManager.instance;
  }

  setSocketIO(io) {
    this.io = io;
  }
  async startCountdown(room, roomId, players, durationMs = 28000, startedBy = "auto") {
    try {
      console.log(`🎮 Room ${roomId} snapshot received for countdown`);
  
      // --- Basic validations ---
      if (room.gameStatus === "countdown") {
        console.log(`⚠️ Countdown already active for room ${roomId}`);
        return { success: false, message: "Countdown already active" };
      }
      if (players.length < 2) {
        console.log(`❌ Not enough players for room ${roomId}: ${players.length}`);
        return { success: false, message: "Not enough players" };
      }
      if (room.gameStatus !== "waiting") {
        console.log(`⚠️ Room ${roomId} not in waiting state: ${room.gameStatus}`);
        return { success: false, message: "Room not in waiting state" };
      }
  
      const countdownEndAt = Date.now() + durationMs;
      const roomRef = ref(rtdb, `rooms/${roomId}`);
  
      // --- Start countdown in Firebase ---
      await update(roomRef, {
        gameStatus: "countdown",
        countdownEndAt,
        countdownStartedBy: startedBy,
      });
      console.log(`⏳ Countdown started for room ${roomId} (${durationMs / 1000}s)`);
  
      // --- Start countdown timer to auto-start game ---
      if (this.countdownTimers.has(roomId)) clearTimeout(this.countdownTimers.get(roomId));
      const tid = setTimeout(async () => {
        try {
          const snap = await get(roomRef);
          const latest = snap.val();
          if (latest?.gameStatus === "countdown") {
            console.log(`🎮 Countdown ended → starting game for room ${roomId}`);
            await this.startGame(roomId, latest);
          } else {
            console.log(`⚠️ Skipping startGame for room ${roomId}, state changed to ${latest?.gameStatus}`);
          }
        } catch (err) {
          console.error(`❌ Auto startGame error for room ${roomId}:`, err);
        } finally {
          this.countdownTimers.delete(roomId);
        }
      }, durationMs);
      this.countdownTimers.set(roomId, tid);
  
      if (this.io) this.io.to(roomId).emit("countdownStarted", { roomId, countdownEndAt });
  
      // -------------------------
      // --- Demo reshuffle ---
      // -------------------------
      // Run the reshuffle as described by you:
      // 1) find demo players with claimed card & auto=true
      // 2) choose X players (half if demoCount<10, else 1/3)
      // 3) atomically unclaim their cards, pick random unclaimed cards and claim them again
      // 4) remove & re-add players in players list
      // 5) do it sequentially (deterministic selection), but commit atomically
      // 6) stop if near countdown end (we stop if less than STOP_THRESHOLD_MS left)
  
      const STOP_THRESHOLD_MS = 2000; // stop reshuffle if < 2s remaining
  
      const shuffleArray = (arr) => {
        for (let i = arr.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
      };
  
      // performDemoReshuffle: gather info, prepare changes sequentially, commit via one transaction
      const performDemoReshuffle = async () => {
        try {
          // quick guard: abort if almost over
          if (countdownEndAt - Date.now() < STOP_THRESHOLD_MS) {
            console.log(`⏸️ Aborting demo reshuffle for ${roomId}: too little time left`);
            return { done: false, reason: "time" };
          }
  
          const snap = await get(roomRef);
          const data = snap.val();
          if (!data) {
            console.log(`⚠️ No room data for ${roomId} when reshuffling`);
            return { done: false, reason: "no-room" };
          }
  
          // assume room.cards is an object: { cardId: { id, claimed, claimedBy, auto, autonUntil, ... } }
          const cardsObj = data.cards || {};
          const cardsList = Object.values(cardsObj);
  
          // Determine demo players that have a claimed card and auto === true.
          // We'll map by userId (claimedBy)
          // Assumption: players array contains either ids or player objects; try both
          const roomPlayers = Array.isArray(data.players) ? data.players.slice() : [];
  
          // Build a map of playerId -> player info (try to get telegramId)
          const playerMap = new Map();
          for (const p of roomPlayers) {
            if (!p) continue;
            if (typeof p === "string") {
              // if players were strings (ids) we don't have telegramId here; we'll derive from cards
              playerMap.set(p, { id: p, telegramId: null });
            } else if (typeof p === "object") {
              playerMap.set(p.id ?? p.uid ?? p.userId, { ...p, id: p.id ?? p.uid ?? p.userId });
            }
          }
  
          // find demo players using cards (preferred — we require claimed card)
          const demoPlayersWithCards = [];
          for (const card of cardsList) {
            if (!card || !card.claimed) continue;
            const claimedBy = card.claimedBy;
            if (!claimedBy) continue;
            const playerInfo = playerMap.get(claimedBy) || { id: claimedBy, telegramId: null };
            // try to obtain telegramId from card or player if present
            const telegramId = (playerInfo.telegramId || card.telegramId || "").toString();
            if (typeof telegramId === "string" && telegramId.toLowerCase().startsWith("demo")) {
              // require that card.auto === true to be eligible
              if (card.auto) {
                demoPlayersWithCards.push({ playerId: claimedBy, telegramId, cardId: card.id, card });
              }
            }
          }
  
          if (demoPlayersWithCards.length === 0) {
            console.log(`⚠️ No demo players with auto-claimed cards to reshuffle in ${roomId}`);
            return { done: false, reason: "none" };
          }
  
          // determine how many to reshuffle
          const demoCount = demoPlayersWithCards.length;
          const numToReshuffle =
            demoCount < 10 ? Math.ceil(demoCount / 2) : Math.ceil(demoCount / 3);
          console.log(`🔁 Demo players found: ${demoCount}, reshuffling: ${numToReshuffle}`);
  
          // choose the players sequentially by shuffling and taking first N — this is deterministic after shuffling
          const shuffled = shuffleArray(demoPlayersWithCards.slice());
          const selected = shuffled.slice(0, numToReshuffle);
  
          // Prepare atomic transaction: unclaim selected cards, find unclaimed cards for reassigning, update players list
          // We'll collect steps sequentially in JS, but then commit them in a single transaction for atomicity.
          const selectedByPlayerId = new Map(selected.map(s => [s.playerId, s]));
          const unclaimedCardIds = Object.keys(cardsObj).filter(cid => {
            const c = cardsObj[cid];
            return c && (!c.claimed || c.claimed === false);
          });
  
          // If there are not enough unclaimed cards, we can still reassign by choosing previously-unselected unclaimed cards.
          // We'll shuffle unclaimedCardIds to pick random ones.
          shuffleArray(unclaimedCardIds);
  
          // Build the transaction function
          const transactionResult = await runTransaction(roomRef, (current) => {
            if (!current) return; // abort if room not found
  
            // Safety: stop early if time almost up before applying transaction
            if (countdownEndAt - Date.now() < STOP_THRESHOLD_MS) {
              console.log(`⏸️ Aborting transaction for ${roomId}: countdown too close to end`);
              return; // returning undefined/false aborts transaction (no change)
            }
  
            // Ensure cards and players exist in the snapshot used for transaction
            current.cards = current.cards || {};
            current.players = Array.isArray(current.players) ? current.players.slice() : [];
  
            // We'll operate sequentially in the same order as `selected`
            let unclaimedIdx = 0;
            for (const sel of selected) {
              const { playerId, cardId: oldCardId } = sel;
  
              // 1) Remove the player from current.players (if present)
              // remove all entries with that id
              current.players = current.players.filter((p) => {
                if (!p) return false;
                if (typeof p === "string") return p !== playerId;
                const pid = p.id ?? p.uid ?? p.userId;
                return pid !== playerId;
              });
  
              // 2) Unclaim the player's old card (if present and matches)
              if (oldCardId && current.cards[oldCardId]) {
                current.cards[oldCardId].claimed = false;
                current.cards[oldCardId].claimedBy = null;
                current.cards[oldCardId].auto = false;
                current.cards[oldCardId].autonUntil = null;
              } else {
                // if the old card not found by id, attempt to find any card claimed by this playerId
                for (const cid of Object.keys(current.cards)) {
                  const c = current.cards[cid];
                  if (c && c.claimedBy === playerId) {
                    c.claimed = false;
                    c.claimedBy = null;
                    c.auto = false;
                    c.autonUntil = null;
                    break;
                  }
                }
              }
  
              // 3) Find an unclaimed card to reassign
              let pickCardId = null;
              // first try the precomputed pool
              while (unclaimedIdx < unclaimedCardIds.length) {
                const cand = unclaimedCardIds[unclaimedIdx++];
                const candCard = current.cards[cand];
                if (!candCard) continue;
                if (!candCard.claimed) {
                  pickCardId = cand;
                  break;
                }
              }
  
              // If none available from precomputed list, scan current.cards to find an unclaimed one
              if (!pickCardId) {
                for (const cid of Object.keys(current.cards)) {
                  const c = current.cards[cid];
                  if (c && !c.claimed) {
                    pickCardId = cid;
                    break;
                  }
                }
              }
  
              if (!pickCardId) {
                // No unclaimed card available — abort transaction (so none of the partial changes apply)
                console.warn(`⚠️ No unclaimed card available to assign to demo player ${playerId} in ${roomId}`);
                return; // abort transaction (no changes)
              }
  
              // 4) Claim the pickCardId for this demo user, set auto true and autonUntil = countdownEndAt
              const claimCard = current.cards[pickCardId];
              claimCard.claimed = true;
              claimCard.claimedBy = playerId;
              claimCard.auto = true;
              claimCard.autonUntil = countdownEndAt;
  
              // 5) Add the player back to current.players (append to end)
              // Keep player object if we have stored player details in 'selected', else add id string
              const selPlayerTelegram = sel.telegramId || null;
              if (selPlayerTelegram) {
                // prefer object form
                current.players.push({ id: playerId, telegramId: selPlayerTelegram });
              } else {
                current.players.push(playerId);
              }
  
              // Emit progress per player (if socket available) — won't break atomicity; it's outside transaction
            } // end for selected players
  
            // if we reach here, we return the modified current snapshot and transaction will commit
            return current;
          }, {
            // optional: max retries, etc.
          });
  
          // runTransaction result handling: depends on SDK; some return committed snapshot
          if (transactionResult && transactionResult.committed) {
            console.log(`✅ Demo reshuffle committed for ${roomId} — reshuffled ${selected.length} players`);
            if (this.io) {
              this.io.to(roomId).emit("countdownDemoReshuffleDone", {
                roomId,
                reshuffled: selected.map(s => s.playerId),
              });
            }
            return { done: true, reshuffled: selected.map(s => s.playerId) };
          } else {
            console.warn(`⚠️ Demo reshuffle transaction aborted or not committed for ${roomId}`);
            return { done: false, reason: "tx-aborted" };
          }
        } catch (err) {
          console.error(`❌ Error during demo reshuffle for ${roomId}:`, err);
          return { done: false, reason: "error", err };
        }
      }; // end performDemoReshuffle
  
      // Kick off the demo reshuffle but ensure it completes before countdownEndAt - STOP_THRESHOLD_MS
      // We'll await it now (synchronous for the rest of the function) so it stops before return.
      // If you prefer this to run in background, remove the await and handle cancellations differently.
      const reshuffleResult = await performDemoReshuffle();
      if (!reshuffleResult.done) {
        console.log(`ℹ️ Demo reshuffle for ${roomId} did not complete:`, reshuffleResult.reason || reshuffleResult);
      }
  
      // --- Return countdown info ---
      return { success: true, countdownEndAt };
    } catch (err) {
      console.error(`❌ Error starting countdown for room ${roomId}:`, err);
      return { success: false, message: "Server error" };
    }
  }
  
  
  
  
  
  
  
  
  async cancelCountdown(roomId) {
    try {
      if (this.countdownTimers.has(roomId)) {
        clearTimeout(this.countdownTimers.get(roomId));
        this.countdownTimers.delete(roomId);
      }
      const roomRef = ref(rtdb, `rooms/${roomId}`);
      update(roomRef, {
        gameStatus: 'waiting',
        countdownEndAt: null,
        countdownStartedBy: null,
      });
      if (this.io) this.io.to(roomId).emit('countdownCancelled', { roomId });
     
      return { success: true };
    } catch (err) {
      console.error('Error cancelling countdown:', err);
      return { success: false };
    }
  }

  // Start a new game
  async startGame(roomId, room) {
    try {
      const roomRef = ref(rtdb, `rooms/${roomId}`);
      const roomSnap = await get(roomRef);
      const liveRoom = roomSnap.val();
if (!liveRoom || liveRoom.gameStatus !== "countdown") throw new Error("Room not in countdown state");


      const gameId = uuidv4();
      const playerIds = Object.keys(room.players || {}).filter(pid => {
        const player = room.players[pid];
        return player && player.cardId && room.bingoCards[player.cardId];
      });
      
      if (playerIds.length < 2) {
        console.log(`❌ Not enough valid players to start game in ${roomId}`);
        update(roomRef, { gameStatus: "waiting" });
        return;
      }
      
      // Generate drawn numbers and determine winners
      const cards = playerIds.map(pid => room.bingoCards[room.players[pid].cardId]);
      console.log("🧩 Checking players and cards for room", roomId);
for (const pid of playerIds) {
  const player = room.players[pid];
  if (!player) console.log("❌ Missing player entry for", pid);
  else if (!player.cardId) console.log("❌ Player", pid, "has no cardId");
  else if (!room.bingoCards[player.cardId]) console.log("❌ Card not found:", player.cardId);
}

      const { drawnNumbers, winners } = this.generateDrawnNumbersMultiWinner(roomId, cards);

      // Safety check: ensure drawnNumbers is always an array
      if (!Array.isArray(drawnNumbers)) {
        console.error(`❌ generateDrawnNumbersMultiWinner returned invalid drawnNumbers:`, drawnNumbers);
        throw new Error("Failed to generate valid drawn numbers");
      }

      const gameData = {
        id: gameId,
        roomId,
        drawnNumbers,
        currentDrawnNumbers: [],
        currentNumberIndex: 0,
        createdAt: Date.now(),
        startedAt: Date.now(),
        drawIntervalMs: 5000,
        status: "active",
        totalPayout: Math.floor((playerIds.length - 1) * (room.betAmount || 0) * 0.85 + (room.betAmount || 0)),
        betsDeducted: false,
        winners: winners.map(cardId => ({
          id: uuidv4(),
          cardId,
          userId: room.bingoCards[cardId]?.claimedBy,
          username: room.players[room.bingoCards[cardId]?.claimedBy]?.username || "Unknown",
          checked: false
        })),
        gameStatus: "playing"
      };

      // Update room status
      await runTransaction(roomRef, (currentRoom) => {
        if (!currentRoom || currentRoom.gameStatus !== "countdown") return currentRoom;
        
        currentRoom.gameStatus = "playing";
        currentRoom.gameId = gameId;
        currentRoom.calledNumbers = [];
        currentRoom.countdownEndAt = null;
        currentRoom.countdownStartedBy = null;
        currentRoom.currentWinner = null;
        currentRoom.payed = false;
        
        return currentRoom;
      });

      // Deduct bets from players
      this.deductBets(roomId, gameData);

      // Save game data
      const gameRef = ref(rtdb, `games/${gameId}`);
      await set(gameRef, gameData);
      if (this.io) {
        this.io.to(roomId).emit('gameStarted', { roomId, gameId });
      }
     
      // Start number drawing
      this.startNumberDrawing(roomId, gameId, room);

      // Notify clients
      

      return { success: true, gameId, drawnNumbers, winners: gameData.winners };
    } catch (error) {
      console.error("Error starting game:", error);
      throw error;
    }
  }

  // Start number drawing process
  startNumberDrawing(roomId, gameId, room) {
    const gameRef = ref(rtdb, `games/${gameId}`);
    if (this.numberDrawIntervals.has(roomId)) {
      
      if (room.gameStatus !== "playing") {
        this.stopNumberDrawing(roomId);
        return;
      }
    }
    const drawInterval = setInterval(async () => {
      try {
        const gameSnap = await get(gameRef);
        const gameData = gameSnap.val();

        if (!gameData || gameData.status !== "active") {
          this.stopNumberDrawing(roomId);
          return;
        }

        const { drawnNumbers, currentNumberIndex } = gameData;
        
        // Safety check for drawnNumbers
        if (!drawnNumbers || !Array.isArray(drawnNumbers)) {
          console.error(`❌ Invalid drawnNumbers for game ${gameId}:`, drawnNumbers);
          this.stopNumberDrawing(roomId);
          return;
        }
        
        // Safety check for currentNumberIndex
        if (typeof currentNumberIndex !== 'number' || currentNumberIndex < 0) {
          console.error(`❌ Invalid currentNumberIndex for game ${gameId}:`, currentNumberIndex);
          this.stopNumberDrawing(roomId);
          return;
        }
        
        if (currentNumberIndex >= drawnNumbers.length) {
          // All numbers drawn, end game
          this.endGame(roomId, gameId, "allNumbersDrawn");
          return;
        }

        const currentNumber = drawnNumbers[currentNumberIndex];
        const newDrawnNumbers = drawnNumbers.slice(0, currentNumberIndex + 1);

        // Update game data
        Promise.allSettled([
          update(gameRef, {
            currentDrawnNumbers: newDrawnNumbers,
            currentNumberIndex: currentNumberIndex + 1,
          }),
          update(ref(rtdb, `rooms/${roomId}`), { calledNumbers: newDrawnNumbers }),
        ]).catch(console.error);

        // Notify clients
        if (this.io) {
          this.io.to(roomId).emit('numberDrawn', {
            number: currentNumber,
            drawnNumbers: newDrawnNumbers,
            roomId
          });
        }

        // Auto-bingo for auto players
        try {
          const roomSnap = await get(ref(rtdb, `rooms/${roomId}`));
          const room = roomSnap.val() || {};
          const bingoCards = room.bingoCards || {};
          const calledSet = new Set(newDrawnNumbers);
          const patterns = this.generateValidPatterns();
          
          for (const [cardId, card] of Object.entries(bingoCards)) {
            if (!card?.auto) continue;
            const autoUntil = card.autoUntil || 0;
            if (autoUntil <= Date.now()) continue;
            if (!card.claimed || !card.claimedBy) continue;
            
            const flat = card.numbers.flat();
         
            // find first winning pattern
            let winningPattern = null;
            for (const pat of patterns) {
              const ok = pat.every((idx) => flat[idx] === 0 || calledSet.has(flat[idx]));
              if (ok) { winningPattern = pat; break; }
            }
            if (winningPattern) {
              // Trigger server bingo
              this.checkBingo(roomId, cardId, card.claimedBy, winningPattern, room, room.players[card.claimedBy]);
              break; // stop loop after first auto-winner
            }
          }
        } catch (e) {
          console.error('Auto-bingo error:', e);
        }

        console.log(`🎲 Room ${roomId}: Drew number ${currentNumber}`);
      } catch (error) {
        console.error("Error in number drawing:", error);
        this.stopNumberDrawing(roomId);
      }
    }, 3000); // 5 second intervals

    this.numberDrawIntervals.set(roomId, drawInterval);
  }

  // Stop number drawing
  stopNumberDrawing(roomId) {
    const interval = this.numberDrawIntervals.get(roomId);
    if (interval) {
      clearInterval(interval);
      this.numberDrawIntervals.delete(roomId);
    }
  }
  // 🧮 Collect demo balances and distribute to real players before reset
  async distributeDemoBalances(roomId) {
    try {
      const usersRef = ref(rtdb, "users");
      const usersSnap = await get(usersRef);
      if (!usersSnap.exists()) {
        console.log("⚠️ No users found in database");
        return;
      }
  
      const users = usersSnap.val();
  
      // 🎯 1️⃣ Collect all global demo users with balance > 100
      const demoUsers = Object.entries(users)
        .filter(([_, u]) => u.telegramId?.startsWith("demo") && (u.balance || 0) > 50)
        .map(([id, u]) => ({ id, balance: u.balance || 0 }));
  
      if (demoUsers.length === 0) {
        console.log("⚠️ No demo users with balance > 100 found globally");
        return;
      }
  
      // 💰 2️⃣ Total up all demo balances
      const total = demoUsers.reduce((sum, u) => sum + u.balance, 0);
  
      // 🧹 3️⃣ Reset their balances to zero
      for (const demo of demoUsers) {
        await update(ref(rtdb, `users/${demo.id}`), { balance: 0 });
      }
  
      console.log(`♻️ Collected total demo pool: ${total} from ${demoUsers.length} demo users`);
  
      // 👥 4️⃣ Get all players in this room
      const playersSnap = await get(ref(rtdb, `rooms/${roomId}/players`));
      if (!playersSnap.exists()) {
        console.log("⚠️ No players in room");
        return;
      }
  
      const roomPlayers = playersSnap.val();
  
      // 🎯 5️⃣ Filter only demo players currently in the room
      const demoPlayersInRoom = Object.entries(roomPlayers)
        .filter(([pid, p]) => p.telegramId?.startsWith("demo"))
        .map(([pid]) => pid);
  
      if (demoPlayersInRoom.length === 0) {
        console.log("⚠️ No demo players found in this room to distribute to");
        return;
      }
  
      // 💸 6️⃣ Divide total equally among demo players in this room
      const perPlayer = Math.floor(total / demoPlayersInRoom.length);
  
      for (const pid of demoPlayersInRoom) {
        const balRef = ref(rtdb, `users/${pid}/balance`);
        await runTransaction(balRef, (current) => (current || 0) + perPlayer);
      }
  
      console.log(
        `💰 Distributed total ${total} equally (${perPlayer} each) among ${demoPlayersInRoom.length} demo players in room ${roomId}`
      );
  
    } catch (err) {
      console.error("❌ Error in distributeDemoBalances:", err);
    }
  }
  


  // End game
  async endGame(roomId, gameId, reason = "manual") {
    const roomRef = ref(rtdb, `rooms/${roomId}`);
    const nextGameCountdownMs =3000; // 5 seconds before reset
    const nextGameCountdownEndAt = Date.now() + nextGameCountdownMs;
  
    try {
      // Stop drawing numbers and cleanup
      this.stopNumberDrawing(roomId);
      await this.distributeDemoBalances(roomId);
  
      // Clear countdown timer if active
      if (this.countdownTimers.has(roomId)) {
        clearTimeout(this.countdownTimers.get(roomId));
        this.countdownTimers.delete(roomId);
      }
  
      // Clear previous reset timer if active
      if (this.resetRoomTimers.has(roomId)) {
        clearTimeout(this.resetRoomTimers.get(roomId));
        this.resetRoomTimers.delete(roomId);
      }
  
      // Schedule room reset after 5 seconds
      const resetTimer = setTimeout(async () => {
        try {
          await this.resetRoom(roomId);
        } catch (e) {
          console.error("Error in scheduled resetRoom:", e);
        } finally {
          this.resetRoomTimers.delete(roomId);
        }
      }, nextGameCountdownMs);
  
      this.resetRoomTimers.set(roomId, resetTimer);
  
      // Fetch game data
      const gameRef = ref(rtdb, `games/${gameId}`);
      const gameSnap = await get(gameRef);
      const gameData = gameSnap.val();
      if (!gameData) return;
  
      // Mark game as ended
      await update(gameRef, {
        status: "ended",
        endedAt: Date.now(),
        endReason: reason,
      });
  
      await update(roomRef, {
        gameStatus: "ended",
        nextGameCountdownEndAt,
        countdownEndAt: null,
        countdownStartedBy: null,
      });
  
      // Handle payout or revenue recording
      const hasConfirmedWinner = !!gameData.winner;
      if (reason === "allNumbersDrawn" && !hasConfirmedWinner) {
        try {
          const revenueRef = ref(rtdb, `revenue/${gameId}`);
          await set(revenueRef, {
            gameId,
            roomId,
            datetime: Date.now(),
            amount: gameData.totalPayout || 0,
            drawned: false,
          });
  
          await update(roomRef, {
            winner: null,
            payout: gameData.totalPayout || 0,
            payed: true,
          });
        } catch (e) {
          console.error("Error recording revenue on no-winner case:", e);
        }
      } else if (gameData.winners && gameData.winners.length > 0) {
        this.processWinners(roomId, gameData);
      }
  
      // Notify connected clients
      if (this.io) {
        this.io.to(roomId).emit("gameEnded", {
          roomId,
          gameId,
          reason,
          winners: gameData.winners || [],
          nextGameCountdownEndAt,
        });
      }
  
      console.log(`🔚 Game ended in room ${roomId}: ${reason}. Room will reset in 5s.`);
    } catch (error) {
      console.error("Error ending game:", error);
    }
  }
  

  // Process winners and payouts
  async processWinners(roomId, gameData) {
    try {
      const { winners, totalPayout } = gameData;
      const payoutPerWinner = Math.floor(totalPayout / winners.length);

      // Get room data for revenue calculation
      const roomRef = ref(rtdb, `rooms/${roomId}`);
      const roomSnap = await get(roomRef);
      const room = roomSnap.val();

      for (const winner of winners) {
        if (winner.userId) {
          // Update user balance
          const userRef = ref(rtdb, `users/${winner.userId}`);
          await runTransaction(userRef, (currentBalance) => {
            return (currentBalance || 0) + payoutPerWinner;
          });

          // Record winning
          const winningRef = ref(rtdb, `winningHistory/${uuidv4()}`);
          await set(winningRef, {
            playerId: winner.userId,
            gameId: gameData.id,
            roomId,
            payout: payoutPerWinner,
            cardId: winner.cardId,
            date: Date.now()
          });
        }
      }

      // Calculate and record revenue
      if (room && winners.length > 0) {
        const playerCount = Object.keys(room.players || {}).length;
        const roomAmount = room.betAmount || 0;
        const totalBets = playerCount * roomAmount;
        const revenueAmount = totalBets - totalPayout;
        
        const revenueRef = ref(rtdb, `revenue/${gameData.id}`);
        await set(revenueRef, {
          gameId: gameData.id,
          roomId,
          datetime: Date.now(),
          amount: revenueAmount,
          drawned: false,
        });
      }

      // Update room with winner info
      update(roomRef, {
        winner: winners[0]?.userId,
        payout: totalPayout,
        payed: true
      });

      console.log(`🏆 Processed ${winners.length} winners in room ${roomId}`);
    } catch (error) {
      console.error("Error processing winners:", error);
    }
  }

  // Check bingo claim
  async checkBingo(roomId, cardId, userId, pattern, room, player) {
    try {
      if (!room || room.gameStatus !== "playing") {
        return { success: false, message: "Game not in playing state" };
      }
  
      if (player?.attemptedBingo) {
        return { success: false, message: "Already attempted bingo" };
      }
  
      const playerRef = ref(rtdb, `rooms/${roomId}/players/${userId}`);
  
      // Validate bingo pattern
      const isValidBingo = this.validateBingoPattern(
        cardId,
        room,
        pattern,
        room.calledNumbers
      );
  
      if (!isValidBingo) {
        update(playerRef, { attemptedBingo: true });
        return { success: false, message: "Invalid bingo pattern" };
      }
  
      // ✅ Valid bingo
      const gameRef = ref(rtdb, `games/${room.gameId}`);
      update(gameRef, {
        winner: { winnerId: userId, winningPattern: pattern },
      });
  
      if (this.io) {
        const eventData = {
          roomId,
          gameId: room.gameId,
          userId,
          cardId,
          patternIndices: pattern,
        };
        console.log("🎉 Emitting winnerConfirmed event:", eventData);
        this.io.to(roomId).emit("winnerConfirmed", eventData);
      } else {
        console.error("❌ Cannot emit winnerConfirmed event: Socket.IO instance not set!");
      }
  
      // ✅ Calculate payout & revenue (with decimal precision)
      const playerCount = Object.keys(room.players || {}).length;
      const roomAmount = room.betAmount || 0;
  
      const totalBets = playerCount * roomAmount;
      const payoutAmount = totalBets * 0.85;  // 85%
      const revenueAmount = totalBets * 0.15; // 15%
  
      const roomRef = ref(rtdb, `rooms/${roomId}`);
  
      if (payoutAmount > 0) {
        const balanceRef = ref(rtdb, `users/${userId}/balance`);
        await runTransaction(balanceRef, (current) => (current || 0) + payoutAmount);
  
        // ✅ Log winning history
        const winRef = ref(rtdb, `winningHistory/${uuidv4()}`);
        await set(winRef, {
          playerId: userId,
          gameId: room.gameId,
          roomId,
          payout: payoutAmount,
          cardId,
          date: Date.now(),
        });
  
        // ✅ Log revenue (15%)
        const revenueRef = ref(rtdb, `revenue/${room.gameId}`);
        await set(revenueRef, {
          gameId: room.gameId,
          roomId,
          datetime: Date.now(),
          amount: revenueAmount,
          drawned: false,
        });
  
        // ✅ Mark room payout metadata
        update(roomRef, {
          winner: userId,
          payout: payoutAmount,
          payed: true,
        });
      }
  
  
      update(gameRef, { winners: [], winnersChecked: true });

      // 🔊 Final guaranteed broadcast before endGame
      if (this.io) {
        this.io.to(roomId).emit("bingoChecked", {
          roomId,
          gameId: room.gameId,
          winnerId: userId,
          message: "Bingo confirmed! Game ending soon...",
        });
      }

      // Small delay to ensure all sockets receive events
      await new Promise((res) => setTimeout(res, 500));


      this.endGame(roomId, room.gameId, "bingo");
  
      return { success: true, message: "Bingo confirmed!" };
    } catch (error) {
      console.error("Error checking bingo:", error);
      return { success: false, message: "Server error" };
    }
  }
  

  // Validate bingo pattern
  validateBingoPattern(cardId, room, pattern, calledNumbers) {
    try {
      const card = room.bingoCards[cardId];
      if (!card) return false;

      const flatCard = card.numbers.flat();
      const calledSet = new Set(calledNumbers);

      // Check if pattern is valid (complete row, column, diagonal, etc.)
      const validPatterns = this.generateValidPatterns();
      
      for (const validPattern of validPatterns) {
        const isMatch = validPattern.every(index => pattern.includes(index));
        if (isMatch) {
          // Check if all numbers in pattern were called
          const patternNumbers = validPattern.map(index => flatCard[index]);
          const allCalled = patternNumbers.every(num => num === 0 || calledSet.has(num)); // 0 is free space
          
          if (allCalled) {
            return true;
          }
        }
      }

      return false;
    } catch (error) {
      console.error("Error validating bingo pattern:", error);
      return false;
    }
  }

  // Generate valid winning patterns
  generateValidPatterns() {
    const patterns = [];
    const size = 5;

    // Rows
    for (let r = 0; r < size; r++) {
      patterns.push([...Array(size)].map((_, c) => r * size + c));
    }

    // Columns
    for (let c = 0; c < size; c++) {
      patterns.push([...Array(size)].map((_, r) => r * size + c));
    }

    // Diagonals
    patterns.push([...Array(size)].map((_, i) => i * size + i));
    patterns.push([...Array(size)].map((_, i) => i * size + (size - 1 - i)));

    // Four corners
    patterns.push([0, 4, 20, 24]);

    // Small X (center + 4 adjacent)
    patterns.push([12, 6, 8, 16, 18]);

    return patterns;
  }

  // Deduct bets from players
  async deductBets(roomId, gameData) {
    try {
      const roomRef = ref(rtdb, `rooms/${roomId}`);
      const roomSnap = await get(roomRef);
      const room = roomSnap.val();

      if (!room?.players) return;

      for (const playerId of Object.keys(room.players)) {
        const betAmount = room.betAmount || 0;
        const balanceRef = ref(rtdb, `users/${playerId}/balance`);

        // Deduct balance
        const snap = await get(balanceRef);
const current = snap.val() || 0;
await set(balanceRef, current - betAmount);


        // Record deduction
        const deductRef = ref(rtdb, `deductRdbs/${uuidv4()}`);
        await set(deductRef, {
          id: uuidv4(),
          username: room.players[playerId].username,
          userId: playerId,
          amount: betAmount,
          gameId: gameData.id,
          roomId,
          date: Date.now()
        });
      }

      update(ref(rtdb, `games/${gameData.id}`), { betsDeducted: true });
    } catch (error) {
      console.error("Error deducting bets:", error);
    }
  }

  generateDrawnNumbersMultiWinner(roomId, cards = []) {
    try {
      const winners = [];
      const usedNumbers = new Set();
      const drawnNumbers = [];
  
      // --- Validate cards ---
      if (!Array.isArray(cards) || cards.length === 0) {
        console.warn(`⚠️ No cards found for room ${roomId}`);
        return { drawnNumbers: [], winners: [] };
      }
  
      // --- Valid cards ---
      const validCards = cards.filter(c => c && Array.isArray(c.numbers) && c.claimedBy);
      if (validCards.length === 0) {
        console.warn(`⚠️ No valid cards for room ${roomId}`);
        return { drawnNumbers: [], winners: [] };
      }
  
      // --- Recent winners memory map ---
      if (!this.recentWinnersByRoom) this.recentWinnersByRoom = new Map();
      if (!this.recentWinnersByRoom.has(roomId)) this.recentWinnersByRoom.set(roomId, []);
  
      const recentWinners = this.recentWinnersByRoom.get(roomId);
      const playerIds = [...new Set(validCards.map(c => c.claimedBy))];
      const playerCount = playerIds.length;
      const cooldown = Math.max(1, Math.floor(playerCount / 2));
  
      // --- Pick eligible winners ---
      const eligibleCards = validCards.filter(c => !recentWinners.includes(c.claimedBy));
      let winnerCard;
  
      if (eligibleCards.length === 0) {
        console.log(`♻️ All players on cooldown in ${roomId}, resetting`);
        winnerCard = validCards[Math.floor(Math.random() * validCards.length)];
        this.recentWinnersByRoom.set(roomId, []);
      } else {
        winnerCard = eligibleCards[Math.floor(Math.random() * eligibleCards.length)];
      }
  
      if (!winnerCard) {
        console.error(`❌ No winnerCard selected for room ${roomId}`);
        return { drawnNumbers: [], winners: [] };
      }
  
      const newWinnerUserId = winnerCard.claimedBy;
  
      // --- Get winning pattern ---
      const winnerPatterns = this.pickPatternNumbers(winnerCard) || [];
      const winnerPattern = winnerPatterns[Math.floor(Math.random() * winnerPatterns.length)] || [];
      if (!Array.isArray(winnerPattern) || winnerPattern.length === 0) {
        console.error(`❌ Invalid winner pattern for room ${roomId}`);
        return { drawnNumbers: [], winners: [] };
      }
  
      // --- Winner's pattern numbers in first 25 ---
      for (const n of winnerPattern) {
        if (n > 0 && n <= 75 && !usedNumbers.has(n)) {
          usedNumbers.add(n);
          drawnNumbers.push(n);
        }
      }
  
      // --- Losers: one missing number ---
      const loserMissingNumbers = [];
      for (const card of validCards) {
        if (card.id === winnerCard.id) continue;
        const pats = this.pickPatternNumbers(card);
        if (!Array.isArray(pats) || pats.length === 0) continue;
        const chosen = pats[Math.floor(Math.random() * pats.length)];
        if (!Array.isArray(chosen) || chosen.length === 0) continue;
  
        const missIndex = Math.floor(Math.random() * chosen.length);
        const missingNum = chosen[missIndex];
  
        for (let i = 0; i < chosen.length; i++) {
          const n = chosen[i];
          if (i !== missIndex && n > 0 && n <= 75 && !usedNumbers.has(n)) {
            usedNumbers.add(n);
            drawnNumbers.push(n);
          }
        }
  
        if (missingNum > 0 && missingNum <= 75) loserMissingNumbers.push(missingNum);
      }
  
      // --- Fill remaining to 25 numbers ---
      while (drawnNumbers.length < 25) {
        const rand = Math.floor(Math.random() * 75) + 1;
        if (!usedNumbers.has(rand)) {
          usedNumbers.add(rand);
          drawnNumbers.push(rand);
        }
      }
  
      const first25 = this.shuffleArray(drawnNumbers.slice(0, 25));
  
      // --- Fill rest to 75 ---
      const after25 = [];
      for (const n of loserMissingNumbers) {
        if (n > 0 && n <= 75 && !usedNumbers.has(n)) {
          usedNumbers.add(n);
          after25.push(n);
        }
      }
  
      while (after25.length + first25.length < 75) {
        const rand = Math.floor(Math.random() * 75) + 1;
        if (!usedNumbers.has(rand)) {
          usedNumbers.add(rand);
          after25.push(rand);
        }
      }
  
      const finalDrawn = [...first25, ...this.shuffleArray(after25)];
  
      // --- Update cooldown history ---
      const updated = [...recentWinners, newWinnerUserId];
      if (updated.length > cooldown) updated.splice(0, updated.length - cooldown);
      this.recentWinnersByRoom.set(roomId, updated);
  
      console.log(
        `🏆 Winner ${newWinnerUserId} in ${roomId} | Cooldown=${cooldown} | Recent=[${updated.join(", ")}]`
      );
  
      winners.push(winnerCard.id);
      return { drawnNumbers: finalDrawn, winners };
    } catch (err) {
      console.error(`❌ Error in generateDrawnNumbersMultiWinner for ${roomId}:`, err);
      // Always return safe structure
      return { drawnNumbers: [], winners: [] };
    }
  }
  
  
  
  
  

  // Pick winning patterns from a card
  pickPatternNumbers(card) {
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

  // Shuffle array
  shuffleArray(array) {
    const arr = array.slice();
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // Reset room for next game
  async resetRoom(roomId) {
    try {
      // Clear any scheduled reset timer for this room
      if (this.resetRoomTimers && this.resetRoomTimers.has(roomId)) {
        clearTimeout(this.resetRoomTimers.get(roomId));
        this.resetRoomTimers.delete(roomId);
      }
      // Also clear any countdown timer if present
      if (this.countdownTimers && this.countdownTimers.has(roomId)) {
        clearTimeout(this.countdownTimers.get(roomId));
        this.countdownTimers.delete(roomId);
      }
  
      const roomRef = ref(rtdb, `rooms/${roomId}`);
      const snap = await get(roomRef);
  
      if (!snap.exists()) {
        console.error(`❌ Room ${roomId} not found`);
        return;
      }
  
      const room = snap.val() || {};
      const { bingoCards = {}, players = {}, betAmount = 0 } = room;
  
      // Track players that should be kept
      const keepPlayers = new Set();
  
      // First pass: check each card
      for (const [cardId, card] of Object.entries(bingoCards)) {
        const claimedBy = card.claimedBy;
        let keepClaimed = false;
  
        if (claimedBy && card?.auto === true) {
          const autoUntil = card?.autoUntil || 0;
          const balanceRef = ref(rtdb, `users/${claimedBy}/balance`);
          const balanceSnap = await get(balanceRef);
          const balance = balanceSnap.val() || 0;
          // ✅ keep only if auto is still active, less than 24h, and player has enough balance
          const autoActive = autoUntil > Date.now() && autoUntil - Date.now() <= 24 * 60 * 60 * 1000;
          const hasEnoughBalance = balance >= betAmount;
  
          if (autoActive && hasEnoughBalance) {
            const playerRef = ref(
              rtdb,
              `rooms/${roomId}/players/${claimedBy}`
            );
             update(playerRef, { attemptedBingo: false });
            keepClaimed = true;
            keepPlayers.add(claimedBy);
          }
        }
  
        if (!keepClaimed) {
          // Reset the card if not valid auto-bet
          update(ref(rtdb, `rooms/${roomId}/bingoCards/${cardId}`), {
            claimed: false,
            claimedBy: null,
            auto: false,
            autoUntil: null,
          });
        }
      }
  
      // Second pass: remove players not in keepPlayers
      for (const [playerId] of Object.entries(players)) {
        if (!keepPlayers.has(playerId)) {
          update(roomRef, {
            [`players/${playerId}`]: null
          });
        }
      }
  
      // Reset room state
      update(roomRef, {
        gameStatus: "waiting",
        gameId: null,
        calledNumbers: [],
        winner: null,
        payout: null,
        payed: false,
        nextGameCountdownEndAt: null
      });
  
      // Reset attemptedBingo for remaining players
      const updates = {};
      keepPlayers.forEach(pid => {
        updates[`players/${pid}/attemptedBingo`] = false;
      });
      if (Object.keys(updates).length > 0) {
        update(roomRef, updates);
      }
  
      // Notify clients
      if (this.io) {
        this.io.to(roomId).emit("roomReset", { roomId });
      }
  
      console.log(`♻️ Room ${roomId} reset for next game (kept ${keepPlayers.size} players with valid auto-bet & balance)`);
    } catch (error) {
      console.error("Error resetting room:", error);
    }
  }
  
  
}

// Export both the class and singleton instance
export default GameManager;
export const gameManager = GameManager.getInstance();
