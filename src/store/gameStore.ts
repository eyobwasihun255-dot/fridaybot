import { create } from 'zustand';
import { rtdb } from '../firebase/config';
import { ref, onValue, get as fbget, set as fbset, update, remove, off,push, query, orderByChild, equalTo, runTransaction } from 'firebase/database';
import { get } from 'firebase/database';
import { useAuthStore } from '../store/authStore';
import { io, Socket } from 'socket.io-client';

interface BingoCard {
  id: string;
  numbers: number[][];
  serialNumber: number;
  claimed: boolean;
  claimedBy?: string;
  roomId?: string;
  winningPatternIndices?: number[]; // For displaying winning pattern in loser popup
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
  countdownStartedBy: string;
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
  startingGame: boolean;
  fetchRooms: () => void;
  joinRoom: (roomId: string) => void;
  selectCard: (cardId: string) => void;
  placeBet: () => Promise<boolean>;
  displayedCalledNumbers: { [roomId: string]: number[] };
  startNumberStream: (roomId: string, gameId: string) => void;
  winnerCard: BingoCard | null;
  showWinnerPopup: boolean;
  showLoserPopup: boolean;
  closeWinnerPopup: () => void;
  stopNumberDraw: () => void;
  setWinnerCard: (card: BingoCard) => void;
  setShowWinnerPopup: (show: boolean) => void;
  setShowLoserPopup: (show: boolean) => void;
  endGame: (roomId: string) => void;
  fetchBingoCards: () => void;
  cancelBet: (cardId?: string) => Promise<boolean>;
  isBetActive: boolean;
  drawIntervalId: ReturnType<typeof setInterval> | null;
  
  // Server communication
  socket: Socket | null;
  serverUrl: string;
  connectToServer: () => void;
  disconnectFromServer: () => void;
  checkBingo: (pattern: number[]) => Promise<{ success: boolean; message: string }>;
}

// Server configuration
const SERVER_URL = process.env.REACT_APP_SERVER_URL || 'https://fridaybot-1.onrender.com/';

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
  startingGame: false,
  socket: null,
  serverUrl: SERVER_URL,

  setShowLoserPopup: (show: boolean) => set({ showLoserPopup: show }),
  setWinnerCard: (card) => set({ winnerCard: card, showWinnerPopup: false }),
  setShowWinnerPopup: (show: boolean) => set({ showWinnerPopup: show }),
  closeWinnerPopup: () => set({ showWinnerPopup: false }),

  stopNumberDraw: () => {
    const id = get().drawIntervalId;
    if (id) {
      clearInterval(id);
      set({ drawIntervalId: null });
    }
  },

  // Connect to server via Socket.IO
  connectToServer: () => {
    const { socket } = get();
    if (socket?.connected) return;
  
    console.log("🔌 Connecting to server:", SERVER_URL);
    const newSocket = io(SERVER_URL, {
      transports: ["websocket"],
    });
  
    newSocket.on("connect", () => {
      console.log("✅ Connected to server");
    });
  
    newSocket.on("disconnect", () => {
      console.log("❌ Disconnected from server");
    });
  
    // ✅ Game started event (room-specific)
    newSocket.on("gameStarted", (data: any) => {
      const { currentRoom } = get();
      if (!currentRoom || data.roomId !== currentRoom.id) return; // ignore other rooms
  
      console.log("🎮 Game started:", data);
      get().startNumberStream(data.roomId, data.gameId);
  
      const { startBalanceListener } = useAuthStore.getState() as any;
      if (startBalanceListener) startBalanceListener();
    });
  
    // ✅ Number drawn event (room-specific)
    newSocket.on("numberDrawn", (data: any) => {
      const { number, drawnNumbers, roomId } = data;
      const { currentRoom } = get();
    
      // 🔒 Ignore updates if user is not currently viewing that room
      if (!currentRoom || currentRoom.id !== roomId) {
        console.log(`⚠️ Ignoring numberDrawn from ${roomId} — user in ${currentRoom?.id}`);
        return;
      }
    
      // ✅ Only update the currently open room
      console.log(`🎲 [${roomId}] Number drawn: ${number}`);
    
      // Update state ONLY for the current room
      set((state) => ({
        displayedCalledNumbers: {
          ...state.displayedCalledNumbers,
          [roomId]: drawnNumbers,
        },
      }));
    });
    
  
    // ✅ Game ended event (room-specific)
    newSocket.on("gameEnded", (data: any) => {
      const { currentRoom } = get();
      if (!currentRoom || currentRoom.id !== data.roomId) return;
  
      console.log("🔚 Game ended:", data);
      get().stopNumberDraw();
  
      if (data.winner) {
        const { user } = useAuthStore.getState();
        if (user?.telegramId === data.winner) {
          get().setShowWinnerPopup(true);
          console.log("🏆 Showing winner popup");
        } else {
          get().setShowLoserPopup(true);
          console.log("😞 Showing loser popup");
        }
      }
    });
  
    // ✅ Winner confirmed (room-specific)
    newSocket.on("winnerConfirmed", async (data: any) => {
      const { roomId, userId, cardId, patternIndices } = data;
      const { currentRoom } = get();
      if (!currentRoom || currentRoom.id !== roomId) return;
  
      try {
        const { user } = useAuthStore.getState();
  
        if (user?.telegramId === userId) {
          // Winner
          get().setShowWinnerPopup(true);
          return;
        }
  
        // Loser: show winner’s card pattern
        const cardRef = ref(rtdb, `rooms/${roomId}/bingoCards/${cardId}`);
        const snap = await fbget(cardRef);
        const card = snap.val();
        if (!card) return;
  
        get().setWinnerCard({
          ...card,
          numbers: card.numbers,
          winningPatternIndices: patternIndices,
        });
        get().setShowLoserPopup(true);
      } catch (e) {
        console.error("Failed to show winner card:", e);
      }
    });
  
    // ✅ Room reset (room-specific)
    newSocket.on("roomReset", (data: any) => {
      const { currentRoom } = get();
      if (!currentRoom || currentRoom.id !== data.roomId) return;
  
      console.log("♻️ Room reset:", data.roomId);
      get().joinRoom(currentRoom.id);
    });
  
    set({ socket: newSocket });
  },
  disconnectFromServer: () => {
    const { socket } = get();
    if (socket) {
      socket.disconnect();
      set({ socket: null });
    }
  },

  // Server-side game start (removed from client)
  startGameIfCountdownEnded: async () => {
    // This is now handled by the server automatically
    // Client just listens for gameStarted event
    console.log('⏰ Countdown ended, server will start game automatically');
  },

  startNumberStream: (roomId, gameId) => {
    const { currentRoom, socket } = get();
    if (currentRoom?.gameStatus !== "playing") return;

    console.log(`🎲 Starting number stream for room: ${roomId}, game: ${gameId}`);

    // Join room for socket events
    if (socket) {
      socket.emit('joinRoom', roomId);
    }

    // Listen to Firebase for real-time game updates
    const gameRef = ref(rtdb, `games/${gameId}`);
    onValue(gameRef, (snapshot) => {
      const data = snapshot.val();
      if (!data) return;

      const { currentDrawnNumbers, gameStatus } = data;

      // Stop if game ended
      if (gameStatus === "ended") {
        get().stopNumberDraw();
        return;
      }

      // Update displayed numbers
      if (currentDrawnNumbers) {
        set((state) => ({
          displayedCalledNumbers: {
            ...state.displayedCalledNumbers,
            [roomId]: currentDrawnNumbers,
          },
        }));
      }
    });
  },

  // Server-side bingo check
  checkBingo: async (pattern: number[]) => {
    try {
      const { currentRoom, selectedCard, socket } = get();
      const { user } = useAuthStore.getState();

      console.log('🎯 checkBingo called with:', { 
        hasCurrentRoom: !!currentRoom, 
        hasSelectedCard: !!selectedCard, 
        hasUser: !!user,
        roomId: currentRoom?.id,
        gameStatus: currentRoom?.gameStatus
      });

      if (!currentRoom || !user) {
        return { success: false, message: 'Missing required data' };
      }

      // Find user's card (either selected or claimed)
      const userCard = get().bingoCards.find(
        (card) =>
          card.roomId === currentRoom.id &&
          card.claimed &&
          card.claimedBy === user.telegramId
      );

      console.log('🎯 Card search result:', { 
        hasUserCard: !!userCard, 
        userCardId: userCard?.id,
        totalBingoCards: get().bingoCards.length,
        userTelegramId: user.telegramId
      });

      // If no claimed card found, use selected card
      const cardToUse = userCard || selectedCard;
      
      if (!cardToUse) {
        console.log('❌ No valid card found for bingo check');
        return { success: false, message: 'No valid card found' };
      }

      console.log('🎯 Checking bingo with server...');

      const response = await fetch(`/api/check-bingo`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          roomId: currentRoom.id,
          cardId: cardToUse.id,
          userId: user.telegramId,
          pattern: pattern,
        }),
      });

      const result = await response.json();
      
      if (result.success) {
        console.log('🏆 Bingo confirmed by server!');
        get().setWinnerCard(cardToUse);  
        get().setShowWinnerPopup(true);
      } else {
        console.log('❌ Bingo rejected by server:', result.message);
      }

      return result;
    } catch (error) {
      console.error('❌ Error checking bingo:', error);
      return { success: false, message: 'Network error' };
    }
  },

  // Server-side game end (removed client-side logic)
  endGame: async (roomId: string) => {
    try {
      console.log('🔚 Requesting server to end game...');
      
      const response = await fetch(`/api/end-game`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          roomId: roomId,
          reason: 'manual',
        }),
      });

      const result = await response.json();
      
      if (result.success) {
        console.log('✅ Game end requested successfully');
      } else {
        console.error('❌ Failed to end game:', result);
      }
    } catch (error) {
      console.error('❌ Error ending game:', error);
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
  const { socket, currentRoom } = get();

  // Ensure socket connection exists
  if (!socket?.connected) {
    get().connectToServer();
  }

  if (socket) {
    // ✅ Leave all previous rooms before joining a new one
    socket.emit("leaveAllRooms");
    socket.emit("joinRoom", roomId);
    console.log(`🚀 Joined room ${roomId}`);
  }

  const roomRef = ref(rtdb, `rooms/${roomId}`);

  // Remove previous Firebase listeners to avoid multiple triggers
  off(roomRef);

  onValue(roomRef, (snapshot) => {
    if (!snapshot.exists()) {
      set({ currentRoom: null });
      return;
    }
    const updatedRoom = { id: roomId, ...snapshot.val() } as Room;
    set({ currentRoom: updatedRoom });
    get().fetchBingoCards();

    // ✅ When joining, update numbers once (from Firebase)
    if (updatedRoom.calledNumbers?.length > 0) {
      set((state) => ({
        displayedCalledNumbers: {
          ...state.displayedCalledNumbers,
          [roomId]: updatedRoom.calledNumbers,
        },
      }));
    }
    
    // Start stream if game is active
    if (updatedRoom.gameStatus === "playing" && updatedRoom.gameId) {
      get().startNumberStream(roomId, updatedRoom.gameId);
    }

    // Count active players for auto-countdown logic
    const activePlayers = updatedRoom.players
      ? Object.values(updatedRoom.players).filter((p: any) => {
          if (!p.cardId) return false;
          if (updatedRoom.isDemoRoom) return true;
          if (p.betAmount) return true;
          const card = updatedRoom.bingoCards?.[p.cardId];
          return !!(card?.auto && card?.claimed && card?.claimedBy === p.telegramId);
        })
      : [];

    const countdownRef = ref(rtdb, `rooms/${roomId}`);

    // Cancel stale countdown if <2 players
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

      // Transaction ensures atomic update
      const result = await runTransaction(cardRef, (card: any) => {
        if (card) {
          if (card.claimed) {
            return; // Already taken
          }
          card.claimed = true;
          card.claimedBy = userId;
        }
        return card;
      });

      if (!result.committed) {
        alert("❌ This card was already claimed by another player!");
        return false;
      }

      // Add player to room if card claim succeeded
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

    const targetCardId = cardId || selectedCard?.id;
    if (!targetCardId) return false;

    try {
      const cardRef = ref(rtdb, `rooms/${currentRoom.id}/bingoCards/${targetCardId}`);
      const playerRef = ref(rtdb, `rooms/${currentRoom.id}/players/${user.telegramId}`);

      // Reset card and cancel autobet
      await update(cardRef, {
        claimed: false,
        claimedBy: null,
        auto: false,
        autoUntil: null,
      });

      // Remove player
      await remove(playerRef);

      set({ isBetActive: false });
      return true;
    } catch (err) {
      console.error("❌ Error canceling bet:", err);
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
        ? Object.entries(data).map(([id, value]: [string, any]) => ({
            id,
            roomId: currentRoom.id,
            ...value,
          }))
        : [];
      set({ bingoCards: cards });
    });
  },
}));  