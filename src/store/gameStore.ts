import { create } from 'zustand';
import { rtdb } from '../firebase/config';
import {
  ref,
  onValue,
  get as fbget,
  set as fbset,
  update,
  remove,
  runTransaction,
} from 'firebase/database';
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
  auto?: boolean;
  autoUntil?: number | null;
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
  countdownStartedBy?: string | null;
  calledNumbers?: number[];
  winner?: string | null;
  payout?: number | null;
  payed: boolean;
  currentWinner?: string | null;
  countdownEndAt?: number | null;
  players?: { [id: string]: any };
  gameId?: string | null;
  nextGameCountdownEndAt?: number | null;
  bingoCards?: { [cardId: string]: any }; // raw snapshot shape (optional)
}

interface GameState {
  rooms: Room[];
  currentRoom: Room | null;
  selectedCard: BingoCard | null;
  // per-room map: roomId -> BingoCard[]
  bingoCardsByRoom: { [roomId: string]: BingoCard[] };
  loading: boolean;
  startingGame: boolean;
  fetchRooms: () => void;
  joinRoom: (roomId: string) => void;
  selectCard: (cardId: string) => void;
  placeBet: () => Promise<boolean>;
  // displayedCalledNumbers is already per-room
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
  // Fetch bingo cards for a specific room (optional roomId param)
  fetchBingoCards: (roomId?: string) => void;
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
  // initialize per-room bingo cards map
  bingoCardsByRoom: {} as { [roomId: string]: BingoCard[] },
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

  // Helper: get cards for a given roomId (or currentRoom)
  // Used internally by other actions
  // Not exposed as part of state; implemented via get()
  // Usage: const cards = getCardsForRoom(currentRoomId)
  // (we implement below where needed)

  // Connect to server via Socket.IO
  connectToServer: () => {
    const { socket } = get();
    if (socket?.connected) return;

    console.log('🔌 Connecting to server:', SERVER_URL);
    const newSocket = io(SERVER_URL);

    newSocket.on('connect', () => {
      console.log('✅ Connected to server');
    });

    newSocket.on('disconnect', () => {
      console.log('❌ Disconnected from server');
    });

    // When server starts a game, request the client to start streaming numbers for that room
    newSocket.on('gameStarted', (data: any) => {
      console.log('🎮 Game started:', data);
      const { currentRoom } = get();
      if (currentRoom && data.roomId === currentRoom.id) {
        get().startNumberStream(data.roomId, data.gameId);
        const { startBalanceListener } = useAuthStore.getState() as any;
        if (startBalanceListener) startBalanceListener();
      }
    });

    // These socket events provide roomId in payload; only update local state for matching room
    newSocket.on('numberDrawn', (data: any) => {
      const { number, drawnNumbers, roomId } = data;
      
  const currentRoom = get().currentRoom;
  if (currentRoom?.id !== roomId) return; // ignore others
      // Update only the specific room's displayedCalledNumbers
      set((state) => ({
        displayedCalledNumbers: {
          ...state.displayedCalledNumbers,
          [roomId]: drawnNumbers,
        },
      }));
    });

    newSocket.on('gameEnded', (data: any) => {
      console.log('🔚 Game ended:', data);
      get().stopNumberDraw();

      const { user } = useAuthStore.getState();
      if (data.winner) {
        if (user?.telegramId === data.winner) {
          get().setShowWinnerPopup(true);
        } else {
          get().setShowLoserPopup(true);
        }
      }
    });

    // Winner confirmed — server passes roomId/cardId/patternIndices
    newSocket.on('winnerConfirmed', async (data: any) => {
      try {
        const { roomId, userId, cardId, patternIndices } = data as any;
        const { user } = useAuthStore.getState();

        if (user?.telegramId === userId) {
          // local player is winner
          get().setShowWinnerPopup(true);
          return;
        }

        // For others, fetch winner card from that room and show pattern
        const cardRef = ref(rtdb, `rooms/${roomId}/bingoCards/${cardId}`);
        const snap = await fbget(cardRef);
        const card = snap.val();
        if (!card) return;

        get().setWinnerCard({
          id: cardId,
          roomId,
          ...card,
          winningPatternIndices: patternIndices,
        });
        get().setShowLoserPopup(true);
      } catch (e) {
        console.error('Failed to show loser winner card:', e);
      }
    });

    newSocket.on('roomReset', () => {
      console.log('♻️ Room reset');
      const { currentRoom } = get();
      if (currentRoom) {
        // re-join / re-sync data for this room
        get().joinRoom(currentRoom.id);
      }
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

  // No-op client-side startGame — server handles it
  startGameIfCountdownEnded: async () => {
    console.log('⏰ Countdown ended, server will start game');
  },

  startNumberStream: (roomId, gameId) => {
    const { currentRoom, socket } = get();

    // join socket room so server events (numberDrawn, etc.) come to this socket
    if (socket) {
      socket.emit('joinRoom', roomId);
    }

    // Listen to game node for currentDrawnNumbers and status
    const gameRef = ref(rtdb, `games/${gameId}`);
    onValue(gameRef, (snapshot) => {
      const data = snapshot.val();
      if (!data) return;

      const { currentDrawnNumbers, status: gameStatus } = data;

      if (gameStatus === 'ended') {
        get().stopNumberDraw();
        return;
      }

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

  // Server-side bingo check (client simply posts to API which is validated server-side)
  checkBingo: async (pattern: number[]) => {
    try {
      const { currentRoom, selectedCard } = get();
      const { user } = useAuthStore.getState();

      if (!currentRoom || !user) {
        return { success: false, message: 'Missing required data' };
      }

      const allCards = get().bingoCardsByRoom || {};
const cards = allCards[currentRoom.id] || [];

      const userCard = cards.find(
        (card) => card.claimed && card.claimedBy === user.telegramId
      );

      const cardToUse = userCard || selectedCard;

      if (!cardToUse) {
        return { success: false, message: 'No valid card found' };
      }

      const response = await fetch(`/api/check-bingo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomId: currentRoom.id,
          cardId: cardToUse.id,
          userId: user.telegramId,
          pattern,
        }),
      });

      const result = await response.json();

      if (result.success) {
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

  // Request server to end game (server handles actual logic)
  endGame: async (roomId: string) => {
    try {
      const response = await fetch(`/api/end-game`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId, reason: 'manual' }),
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

    if (!socket?.connected) {
      get().connectToServer();
    }

    if (socket) {
      // Leave previous socket room if different
      if (currentRoom?.id && currentRoom.id !== roomId) {
        socket.emit('leaveRoom', currentRoom.id);
      }
      socket.emit('joinRoom', roomId);
    }

    const roomRef = ref(rtdb, `rooms/${roomId}`);

    // Listen only to this room's node and update currentRoom
    onValue(roomRef, (snapshot) => {
      if (!snapshot.exists()) {
        set({ currentRoom: null });
        return;
      }

      const updatedRoom = { id: roomId, ...snapshot.val() } as Room;
      set({ currentRoom: updatedRoom });

      // fetch bingo cards for this room only
      get().fetchBingoCards(roomId);

      // If game is already playing, start number stream to synchronize
      if (updatedRoom.gameStatus === 'playing' && updatedRoom.gameId) {
        get().startNumberStream(roomId, updatedRoom.gameId);
      }

      // Sync calledNumbers into displayedCalledNumbers for this room (useful when rejoining)
      if (updatedRoom.calledNumbers && updatedRoom.calledNumbers.length > 0) {
        set((state) => ({
          displayedCalledNumbers: {
            ...state.displayedCalledNumbers,
            [roomId]: updatedRoom.calledNumbers!,
          },
        }));
      }

      // Optional: cancel room countdown if conditions changed client-side (server should handle)
      // We won't mutate server-side state here except for UI concerns.
    });
  },

  selectCard: (cardId: string) => {
    const { currentRoom } = get();
    if (!currentRoom) return;

    const allCards = get().bingoCardsByRoom || {};
const cards = allCards[currentRoom.id] || [];
const card = cards.find((c) => c.id === cardId);

    if (card && !card.claimed) {
      // ensure selectedCard stores roomId for later ops
      set({ selectedCard: { ...card, roomId: currentRoom.id } });
    }
  },

  placeBet: async () => {
    const { currentRoom, selectedCard } = get();
    const { user } = useAuthStore.getState();
    if (!currentRoom || !selectedCard || !user) return false;

    const userId = user.telegramId;
    if (!userId) {
      console.error('❌ No valid telegramId for user:', user);
      return false;
    }

    if ((user.balance || 0) < currentRoom.betAmount) {
      alert('Insufficient balance!');
      return false;
    }

    try {
      const cardRef = ref(rtdb, `rooms/${currentRoom.id}/bingoCards/${selectedCard.id}`);

      // transaction ensures atomic claim
      const result = await runTransaction(cardRef, (card: any) => {
        if (card) {
          if (card.claimed) {
            return; // already taken, abort
          }
          card.claimed = true;
          card.claimedBy = userId;
        }
        return card;
      });

      if (!result.committed) {
        alert('❌ This card was already claimed by another player!');
        return false;
      }

      // Add player to room players list
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
      console.error('❌ Error placing bet:', err);
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

      // Reset card and cancel auto
      await update(cardRef, {
        claimed: false,
        claimedBy: null,
        auto: false,
        autoUntil: null,
      });

      // Remove player entry
      await remove(playerRef);

      set({ isBetActive: false });
      return true;
    } catch (err) {
      console.error('❌ Error canceling bet:', err);
      return false;
    }
  },

  // Fetch bingo cards for a specific room (if roomId omitted use currentRoom)
  fetchBingoCards: (roomId?: string) => {
    const theRoomId = roomId || get().currentRoom?.id;
    if (!theRoomId) return;

    const cardsRef = ref(rtdb, `rooms/${theRoomId}/bingoCards`);
    onValue(cardsRef, (snapshot) => {
      const data = snapshot.val();
      const cards: BingoCard[] = data
        ? Object.entries(data).map(([id, value]: [string, any]) => ({
            id,
            roomId: theRoomId,
            ...value,
          }))
        : [];

      // store cards under the room's key
      set((state) => ({
        bingoCardsByRoom: {
          ...state.bingoCardsByRoom,
          [theRoomId]: cards,
        },
      }));
    });
  },
}));
