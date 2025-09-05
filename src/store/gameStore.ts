import { create } from 'zustand';
import { rtdb } from '../firebase/config';
import { ref, onValue, get, set as fbset, update, remove, push, runTransaction } from 'firebase/database';
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
  countdownEndAt: number, 
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
  checkBingo: () => Promise<boolean>;
  displayedCalledNumbers: { [roomId: string]: number[] };
  startNumberStream: (roomId: string, gameId: string) => void;
   winnerCard: BingoCard | null;      // Winner card for the current game
  showWinnerPopup: boolean; 
           // Flag to trigger popup
  setWinnerCard: (card: BingoCard) => void; // Setter for winner card

}

export const useGameStore = create<GameState>((set, get) => ({
  rooms: [],
  displayedCalledNumbers:[],
  currentRoom: null,
  selectedCard: null,
  bingoCards: [],
  loading: false,
  startingGame: false, // ✅ Initialize startingGame flag
 // add this
setWinnerCard: (card) => set({ winnerCard: card, showWinnerPopup: false }),
closeWinnerPopup: () => set({ showWinnerPopup: false }),


  startGameIfCountdownEnded: async () => {
  const { currentRoom, startingGame } = get();
  if (!currentRoom || startingGame) return;

  // Only trigger if countdown ended
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
  get().setWinnerCard(data.winnerCards[0]); // take the first winner
}

  } catch (err) {
    console.error("❌ Failed to start game:", err);
  } finally {
    set({ startingGame: false });
  }
},
    startNumberStream: (roomId, gameId) => {
  const gameRef = ref(rtdb, `games/${gameId}`);
  
  onValue(gameRef, (snapshot) => {
    const data = snapshot.val();
    if (!data || !data.drawnNumbers || !data.startedAt) return;

    const { drawnNumbers, startedAt, drawIntervalMs, winnerCard, totalPayout } = data;

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

    const interval = setInterval(async () => {
      if (i >= drawnNumbers.length) {
        clearInterval(interval);

        // ✅ Show popup after all numbers called
      const { user } = useAuthStore.getState();
        if (winnerCard?.claimedBy === user?.telegramId) {
          set({ winnerCard, showWinnerPopup: true });

          // ✅ Add payout to winner's balance
          const balanceRef = ref(rtdb, `users/${user.telegramId}/balance`);
          await runTransaction(balanceRef, (current) => (current || 0) + (totalPayout || 0));
        }

        get().endGame(roomId); // optional: end game after popup
        return;
      }

      set((state) => ({
        displayedCalledNumbers: {
          ...state.displayedCalledNumbers,
          [roomId]: [...(state.displayedCalledNumbers[roomId] || []), drawnNumbers[i]],
        },
      }));
      i++;
    }, drawIntervalMs);
  });
},

  endGame: async (roomId: string) => {
  try {
    const roomRef = ref(rtdb, `rooms/${roomId}`);
    const bingoCardsRef = ref(rtdb, `rooms/${roomId}/bingoCards`);
    const cooldownDuration = 0.5 * 60 * 1000; // ✅ 1 min cooldown
    const nextGameCountdownEndAt = Date.now() + cooldownDuration;
   const playersRef = ref(rtdb, `rooms/${roomId}/players`);

    // Step 1: End the game
    await update(roomRef, {
      gameStatus: "ended",
      gameId: null,
      calledNumbers: [],
      countdownEndAt: null,
      countdownStartedBy: null,
      nextGameCountdownEndAt,
    });

    console.log("✅ Game ended. Next round countdown started.");

    // Step 2: After cooldown, reset room + unclaim all cards
    setTimeout(async () => {
      
  try {
    const snapshot = await get(bingoCardsRef);
    if (snapshot.exists()) {
      const updates: Record<string, any> = {};
      snapshot.forEach((cardSnap) => {
        const cardId = cardSnap.key;
        updates[`${cardId}/claimed`] = false;
        updates[`${cardId}/claimedBy`] = null;
      });
      await update(bingoCardsRef, updates);
      console.log("✅ All bingo cards reset.");
    }
    await update(roomRef, {
      gameStatus: "waiting",
      countdownEndAt: null,
      countdownStartedBy: null,
      players : null,
      nextGameCountdownEndAt: null, // optional
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
    ? Object.values(updatedRoom.players).filter(
        (p: any) => p.betAmount && p.cardId
      )
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
    // ✅ Unclaim the card
    const cardRef = ref(rtdb, `rooms/${currentRoom.id}/bingoCards/${targetCardId}`);
    await update(cardRef, {
      claimed: false,
      claimedBy: null,
    });

    // ✅ Remove player entry from the room
    const playerRef = ref(rtdb, `rooms/${currentRoom.id}/players/${user.telegramId}`);
    await remove(playerRef);

    // ✅ Reset local state if this was the selected card
    if (selectedCard?.id === targetCardId) {
      set({ selectedCard: null });
    }

    console.log("✅ Bet canceled successfully");
    return true;
  } catch (err) {
    console.error("❌ Cancel bet failed:", err);
    return false;
  }
},

  checkBingo: async () => {
    const { selectedCard, currentRoom } = get();
    if (!selectedCard || !currentRoom) return false;
    
    // Check for bingo patterns
    const { numbers } = selectedCard;
    const { calledNumbers } = currentRoom;
    
    // Check rows
    for (let row = 0; row < 5; row++) {
      if (numbers[row].every(num => calledNumbers.includes(num))) {
        return true;
      }
    }
    
    // Check columns
    for (let col = 0; col < 5; col++) {
      if (numbers.every(row => calledNumbers.includes(row[col]))) {
        return true;
      }
    }
    
    // Check diagonals
    const diagonal1 = [numbers[0][0], numbers[1][1], numbers[2][2], numbers[3][3], numbers[4][4]];
    const diagonal2 = [numbers[0][4], numbers[1][3], numbers[2][2], numbers[3][1], numbers[4][0]];
    
    if (diagonal1.every(num => calledNumbers.includes(num)) ||
        diagonal2.every(num => calledNumbers.includes(num))) {
      return true;
    }
    
    return false;
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

