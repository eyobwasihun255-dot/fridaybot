import { create } from 'zustand';
import { rtdb } from '../firebase/config';
import { ref, onValue, get as fbget, set as fbset, update, remove, push, query, orderByChild, equalTo , runTransaction } from 'firebase/database';
// add get and remove
import { get } from 'firebase/database';



import { useAuthStore } from '../store/authStore';
interface BingoCard {
  id: string;
  numbers: number[][];
  serialNumber: number;
  claimed: boolean;
  claimedBy?: string;
  roomId?: string; // 
}

interface Room {
  id: string;
  name: string;
  betAmount: number;
  maxPlayers: number;
  isActive: boolean;
  isDemoRoom: boolean;
  currentPlayers: number;
  gameStatus: 'waiting' | 'countdown' | 'playing' | 'ended';
  countdownStartedBy : string,
  calledNumbers: number[];
  winner?: string;
  payout?: number;
  payed: boolean;
  currentWinner?: string; 
  countdownEndAt: number;
  players?: { [id: string]: { id: string; username: string; betAmount: number; cardId: string } };
  gameId?: string;
  nextGameCountdownEndAt?: number;
  
}

interface GameState {
  rooms: Room[];
  currentRoom: Room | null;
  selectedCard: BingoCard | null;
  bingoCards: BingoCard[];
  loading: boolean;
  startingGame: boolean; // ✅ Prevent multiple simultaneous start game calls
  fetchRooms: () => void;
  joinRoom: (roomId: string) => void;
  selectCard: (cardId: string) => void;
  placeBet: () => Promise<boolean>;
  displayedCalledNumbers: { [roomId: string]: number[] };
  startNumberStream: (roomId: string, gameId: string) => void;
   winnerCard: BingoCard | null;      // Winner card for the current game
  showWinnerPopup: boolean; 
  showLoserPopup: boolean,
  
   closeWinnerPopup: () => void; 
   stopNumberDraw: () => void;
  setWinnerCard: (card: BingoCard) => void; // Setter for winner card
  setShowWinnerPopup: (show: boolean) => void; // Setter for popup visibility
  setShowLoserPopup: (show: boolean) => void; // Setter for popup visibility
  endGame: (roomId: string) => void;
  fetchBingoCards: () => void;
  cancelBet: (cardId?: string) => Promise<boolean>;
  isBetActive: boolean;
  drawIntervalId: ReturnType<typeof setInterval> | null ;
}

async function resetAllCardsAndPlayers(roomId: string) {
  try {
    const roomRef = ref(rtdb, `rooms/${roomId}`);
    const cardsRef = ref(rtdb, `rooms/${roomId}/bingoCards`);
    const playersRef = ref(rtdb, `rooms/${roomId}/players`);

    // ✅ Fetch room to get bet amount
    const roomSnap = await get(roomRef);
    if (!roomSnap.exists()) {
      console.log("❌ Room not found:", roomId);
      return;
    }
    const roomData = roomSnap.val();
    const betAmount = roomData.betAmount || 0;

    // 1️⃣ Reset cards
    const cardsSnap = await get(cardsRef);
    const autoCardsByPlayer: Record<string, boolean> = {};
    const cardUpdates: Promise<any>[] = [];

    if (cardsSnap.exists()) {
      const cardsData = cardsSnap.val();
      for (const cardKey in cardsData) {
        const cardData = cardsData[cardKey];
        const cardRef = ref(rtdb, `rooms/${roomId}/bingoCards/${cardKey}`);

        if (cardData.auto) {
          // ✅ Check player balance
          const userId = cardData.claimedBy;
          const userSnap = await get(ref(rtdb, `users/${userId}`));
          const userBalance = userSnap.val()?.balance || 0;

          if (userBalance >= betAmount) {
            // ✅ Player has enough balance → keep auto
            autoCardsByPlayer[userId] = true;
          } else {
            // ❌ Low balance → reset card & auto
            cardUpdates.push(
              update(cardRef, {
                claimed: false,
                claimedBy: null,
                auto: false,
                autoUntil: null,
              })
            );
          }
        } else {
          // Reset non-auto cards
          cardUpdates.push(update(cardRef, { claimed: false, claimedBy: null }));
        }
      }

      if (cardUpdates.length) {
        await Promise.all(cardUpdates);
        console.log("♻️ Cards reset (including low-balance autos) in room:", roomId);
      } else {
        console.log("ℹ️ No cards needed reset for room:", roomId);
      }
    } else {
      console.log("ℹ️ No cards found for room:", roomId);
    }

    // 2️⃣ Remove players without any valid auto cards
    const playersSnap = await get(playersRef);
    if (playersSnap.exists()) {
      const removePromises: Promise<any>[] = [];
      playersSnap.forEach((playerSnap) => {
        const playerKey = playerSnap.key;
        if (!playerKey) return;

        // If player has no valid auto card → remove
        if (!autoCardsByPlayer[playerKey]) {
          const playerRef = ref(rtdb, `rooms/${roomId}/players/${playerKey}`);
          removePromises.push(remove(playerRef));
        }
      });

      if (removePromises.length) {
        await Promise.all(removePromises);
        console.log("🧹 Removed players without valid auto cards from room:", roomId);
      } else {
        console.log("ℹ️ All remaining players have valid auto cards");
      }
    }
  } catch (err) {
    console.error("❌ Error resetting cards or players:", err);
    throw err;
  }
}

export const useGameStore = create<GameState>((set, get) => ({
  rooms: [],
  drawIntervalId: null,
  displayedCalledNumbers: {} as { [roomId: string]: number[] },
 winnerCard: null,
showWinnerPopup: false,
showLoserPopup: false,

  currentRoom: null,
  isBetActive: false,
  selectedCard: null,
  bingoCards: [],
  loading: false,
  startingGame: false, // ✅ Initialize startingGame flag
   // default

setShowLoserPopup: (show: boolean) => set({ showLoserPopup: show }),

 // add this
setWinnerCard: (card) => set({ winnerCard: card, showWinnerPopup: false }),
setShowWinnerPopup: (show: boolean) => set({ showWinnerPopup: show }),

closeWinnerPopup: () => set({ showWinnerPopup: false }),

stopNumberDraw: () => {
    const id = get().drawIntervalId;
    if (id) {
      clearInterval(id);
      set({ drawIntervalId: null });
    
  }}, 
 startGameIfCountdownEnded: async () => {
  const { currentRoom, startingGame, user } = get();
  if (!currentRoom || startingGame) return;
  if (currentRoom.gameStatus !== "countdown" || !currentRoom.countdownEndAt) return;
  if (Date.now() < currentRoom.countdownEndAt) return;

  set({ startingGame: true });

  try {
    const res = await fetch("/api/start-game", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roomId: currentRoom.id }),
    });

    const data = await res.json();
    console.log("✅ Game started:", data);

    if (data.winnerCard && data.winnerCard.length > 0) {
      get().setWinnerCard(data.winnerCard[0]);
    }

    // 🔄 Reload balance after starting game
    if (user) {
      await useAuthStore.getState().reloadBalance();
    }

  } catch (err) {
    console.error("❌ Failed to start game:", err);
  } finally {
    set({ startingGame: false });
  }
},
 startNumberStream: (roomId, gameId) => {
  const { currentRoom } = get();
  if (currentRoom.gameStatus !== "playing") return;

  const gameRef = ref(rtdb, `games/${gameId}`);

  onValue(gameRef, (snapshot) => {
    const data = snapshot.val();
    if (!data || !data.drawnNumbers || !data.startedAt) return;

    const { drawnNumbers, startedAt, drawIntervalMs, winnerCard, totalPayout, gameStatus } = data;

    // 🔴 Stop immediately if game is ended
    if (gameStatus === "ended") {
      get().stopNumberDraw();
      return;
    }

    let currentIndex = Math.floor((Date.now() - startedAt) / drawIntervalMs);
    if (currentIndex > drawnNumbers.length) currentIndex = drawnNumbers.length;

    set((state) => ({
      displayedCalledNumbers: {
        ...state.displayedCalledNumbers,
        [roomId]: drawnNumbers.slice(0, currentIndex),
      },
      winnerCard,
    }));

    let i = currentIndex;

    // Clear previous interval before starting a new one
    get().stopNumberDraw();

    const interval = setInterval(() => {
      if (i >= drawnNumbers.length) {
        get().stopNumberDraw();
        get().endGame(roomId); // will trigger gameStatus=ended in DB
        return;
      }

      set((state) => ({
        displayedCalledNumbers: {
          ...state.displayedCalledNumbers,
          [roomId]: [
            ...(state.displayedCalledNumbers[roomId] || []),
            drawnNumbers[i],
          ],
        },
      }));
      i++;
    }, drawIntervalMs);

    set({ drawIntervalId: interval });
  });
},


  endGame: async (roomId: string) => {
  try {
    const roomRef = ref(rtdb, `rooms/${roomId}`);
    const bingoCardsRef = ref(rtdb, `rooms/${roomId}/bingoCards`);
    const cooldownDuration = 0.5 * 60 * 500; //  sec (0.5 min)
    const nextGameCountdownEndAt = Date.now() + cooldownDuration;
    
     const { currentRoom } = get();
    if (!currentRoom?.gameId) return;
    const gameRef = ref(rtdb, `games/${currentRoom.gameId}`);
    // Step 1: End the game
    await update(roomRef, {
      gameStatus: "ended",
      countdownEndAt: null,
      countdownStartedBy: null,
      nextGameCountdownEndAt,
    });

    console.log("✅ Game ended. Next round countdown started.");
     await update(gameRef, { gameStatus: "ended" }); // 🔴 broadcast stop

    get().stopNumberDraw();
    // Step 3: After cooldown, reset the room state
    
    setTimeout(async () => {
      const { user } = useAuthStore.getState();
if (user?.telegramId) {
  await resetAllCardsAndPlayers(roomId);
}   
      try {
        
        await update(roomRef, {
          gameStatus: "waiting",
          currentwinner: null,  
          calledNumbers: [],
          gameId: null,
          payed: false,
          winners:null,
          payout: null,
          countdownEndAt: null,
          countdownStartedBy: null,
          nextGameCountdownEndAt: null,
        });
        


        console.log("✅ Room reset to waiting after cooldown.");
      } catch (err) {
        console.error("❌ Failed to reset cards/room:", err);
      }
    }, cooldownDuration);
            
       


  } catch (err) {
    console.error("❌ Failed to end game:", err);
  }
},


  fetchRooms: () => {
    const roomsRef = ref(rtdb, 'rooms');
    onValue(roomsRef, (snapshot) => {
      const data = snapshot.val();
      const rooms: Room[] = data
        ? Object.entries(data).map(([id, value]: [string, any]) => ({ id, ...value }))
        : [];
      set({ rooms });
    });
  },


joinRoom: (roomId: string) => {
  const roomRef = ref(rtdb, "rooms/" + roomId);

  onValue(roomRef, (snapshot) => {
  if (!snapshot.exists()) {
    set({ currentRoom: null });
    return;
  }

  const updatedRoom = { id: roomId, ...snapshot.val() } as Room;
  set({ currentRoom: updatedRoom });
  // ✅ Always fetch cards
  get().fetchBingoCards();

  // ✅ Count how many players actually placed bets (claimed cards)
 const activePlayers = updatedRoom.players
  ? Object.values(updatedRoom.players).filter((p: any) => {
      if (updatedRoom.isDemoRoom) return p.cardId; // only need claimed card
      return p.betAmount !== undefined && p.cardId; // real rooms: need betAmount
    })
  : [];

  const countdownRef = ref(rtdb, `rooms/${roomId}`);

  // ❌ Cancel stale countdown if <2 players
if (
  activePlayers.length < 2 &&
  updatedRoom.gameStatus === "countdown" &&
  updatedRoom.countdownEndAt > Date.now()
) {
  (async () => {
    await update(countdownRef, {
      gameStatus: "waiting",
      countdownEndAt: null,
      countdownStartedBy: null,
    });
  })();
  return;
}

// ✅ Start countdown if 2+ active players, room waiting, and no countdown in progress
if (
  activePlayers.length >= 2 &&
  updatedRoom.gameStatus === "waiting" &&
  (!updatedRoom.countdownEndAt || updatedRoom.countdownEndAt < Date.now()) &&
  !updatedRoom.countdownStartedBy
) {
  const { user } = useAuthStore.getState();
  if (!user?.telegramId) return;

  const countdownDuration = 30 * 1000; // 30s
  const countdownEndAt = Date.now() + countdownDuration;

  update(countdownRef, {
    gameStatus: "countdown",
    countdownEndAt,
    countdownStartedBy: user.telegramId,
  });
}
if (updatedRoom.gameStatus === "ended" && updatedRoom.nextGameCountdownEndAt <= Date.now()) {
  update(ref(rtdb, `rooms/${roomId}`), {
    gameStatus: "waiting",
    nextGameCountdownEndAt: null,
  });
}

});
},

  
  selectCard: (cardId: string) => {
    const { bingoCards } = get();
    const card = bingoCards.find(c => c.id === cardId);
    if (card && !card.claimed) {
      set({ selectedCard: card });
    }
  },


placeBet: async () => {
  const { currentRoom, selectedCard } = get();
  const { user } = useAuthStore.getState();
  if (!currentRoom || !selectedCard || !user) return false;

  const userId = user.telegramId;
  if (!userId) {
    console.error("❌ No valid telegramId for user:", user);
    return false;
  }

  if ((user.balance || 0) < currentRoom.betAmount) {
    alert("Insufficient balance!");
    return false;
  }

  try {
    const cardRef = ref(rtdb, `rooms/${currentRoom.id}/bingoCards/${selectedCard.id}`);

    // 🔒 Transaction ensures atomic update
    const result = await runTransaction(cardRef, (card: any) => {
      if (card) {
        if (card.claimed) {
          // ❌ Already taken
          return; 
        }
        // ✅ Mark card as claimed
        card.claimed = true;
        card.claimedBy = userId;
      }
      return card;
    });

    if (!result.committed) {
      alert("❌ This card was already claimed by another player!");
      return false;
    }

    // ✅ Add player to room if card claim succeeded
    const playerRef = ref(rtdb, `rooms/${currentRoom.id}/players/${userId}`);
    await fbset(playerRef, {
      telegramId: userId,
      username: user.username,
      betAmount: currentRoom.betAmount,
      cardId: selectedCard.id,
    });
    set({ isBetActive: true });
    return true;
  } catch (err) {
    console.error("❌ Error placing bet:", err);
    return false;
  }
},


cancelBet: async (cardId?: string) => {
  const { selectedCard, currentRoom } = get();
  const { user } = useAuthStore.getState();

  if (!currentRoom || !user) return false;

  // Use passed cardId OR fallback to selectedCard.id
  const targetCardId = cardId || selectedCard?.id;
  if (!targetCardId) {
    console.error("❌ Cancel bet failed: no target card id");
    return false;
  }

  try {
    // ✅ Unclaim the card and reset auto
    const cardRef = ref(rtdb, `rooms/${currentRoom.id}/bingoCards/${targetCardId}`);
    await update(cardRef, {
      claimed: false,
      claimedBy: null,
      auto: false,       // 🔴 reset auto
      autoUntil: null,   // 🔴 clear auto timer
    });

    // ✅ Remove player entry from the room
    const playerRef = ref(rtdb, `rooms/${currentRoom.id}/players/${user.telegramId}`);
    await remove(playerRef);

    // ✅ Reset local state if this was the selected card
    if (selectedCard?.id === targetCardId) {
      set({ selectedCard: null });
    }

    set({ isBetActive: false });
    console.log("✅ Bet canceled successfully (auto disabled)");
    return true;
  } catch (err) {
    console.error("❌ Cancel bet failed:", err);
    return false;
  }
},




  fetchBingoCards: () => {
      const { currentRoom } = get();
  if (!currentRoom) return;

    const cardsRef = ref(rtdb, `rooms/${currentRoom.id}/bingoCards`);
    onValue(cardsRef, (snapshot) => {
      const data = snapshot.val();
      const cards: BingoCard[] = data
        ? Object.entries(data).map(([id, value]: [string, any]) => ({ id, ...value }))
        : [];
      set({ bingoCards: cards });
      const { user } = useAuthStore.getState();
const { selectedCard } = get();

if (user) {
  const userCard = cards.find(c => c.claimedBy === user.telegramId);

  // ✅ Only set if user has a claimed card OR nothing is selected yet
  if (userCard && (!selectedCard || selectedCard.id !== userCard.id)) {
    set({ selectedCard: userCard });
  } else if (!userCard && !selectedCard) {
    set({ selectedCard: null });
  }
}

    });
  },

  

}));

