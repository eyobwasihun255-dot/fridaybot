 
import { create } from "zustand";
import { rtdb } from "../firebase/config";
import {
  ref,
  onValue,
  get as fbget,
  set as fbset,
  update,
  remove,
  runTransaction,
} from "firebase/database";
import { useAuthStore } from "../store/authStore";
import { io, Socket } from "socket.io-client";

interface BingoCard {
  id: string;
  numbers: number[][];
  serialNumber: number;
  claimed: boolean;
  claimedBy?: string;
  roomId?: string;
  winningPatternIndices?: number[];
}

interface Room {
  id: string;
  name: string;
  betAmount: number;
  maxPlayers: number;
  isActive: boolean;
  isDemoRoom: boolean;
  currentPlayers: number;
  gameStatus: "waiting" | "countdown" | "playing" | "ended";
  countdownStartedBy: string;
  calledNumbers: number[];
  winner?: string;
  payout?: number;
  payed: boolean;
  currentWinner?: string;
  countdownEndAt: number;
  players?: {
    [id: string]: {
      id: string;
      username: string;
      betAmount: number;
      cardId: string;
    };
  };
  gameId?: string;
  nextGameCountdownEndAt?: number;
}

interface RoomState {
  bingoCards: BingoCard[];
  displayedCalledNumbers: number[];
  winnerCard: BingoCard | null;
  showWinnerPopup: boolean;
  showLoserPopup: boolean;
  isBetActive: boolean;
  drawIntervalId: ReturnType<typeof setInterval> | null;
}

interface GameState {
  rooms: Room[];
  currentRoom: Room | null;
  roomsData: Record<string, RoomState>;

  // Actions
  fetchRooms: () => void;
  joinRoom: (roomId: string) => void;
  fetchBingoCards: (roomId: string) => void;
  selectCard: (cardId: string) => void;
  placeBet: () => Promise<boolean>;
  cancelBet: (cardId?: string) => Promise<boolean>;

  // Game flow
  startNumberStream: (roomId: string, gameId: string) => void;
  stopNumberDraw: (roomId: string) => void;
  endGame: (roomId: string) => void;
  checkBingo: (
    pattern: number[]
  ) => Promise<{ success: boolean; message: string }>;
  selectedCard: BingoCard | null;
  // Popup handlers
  setShowWinnerPopup: (roomId: string, show: boolean) => void;
  setShowLoserPopup: (roomId: string, show: boolean) => void;
  setWinnerCard: (roomId: string, card: BingoCard) => void;
  closeWinnerPopup: (roomId: string) => void;

  // Server communication
  socket: Socket | null;
  serverUrl: string;
  connectToServer: () => void;
  disconnectFromServer: () => void;
}

const SERVER_URL =
  process.env.REACT_APP_SERVER_URL || "https://fridaybot-1.onrender.com/";

export const useGameStore = create<GameState>((set, get) => ({
  rooms: [],
  currentRoom: null,
  roomsData: {},
  socket: null,
  serverUrl: SERVER_URL,
  selectedCard: null,
  // Popup state
  setShowWinnerPopup: (roomId, show) =>
    set((state) => ({
      roomsData: {
        ...state.roomsData,
        [roomId]: {
          ...state.roomsData[roomId],
          showWinnerPopup: show,
        },
      },
    })),

  setShowLoserPopup: (roomId, show) =>
    set((state) => ({
      roomsData: {
        ...state.roomsData,
        [roomId]: {
          ...state.roomsData[roomId],
          showLoserPopup: show,
        },
      },
    })),

  setWinnerCard: (roomId, card) =>
    set((state) => ({
      roomsData: {
        ...state.roomsData,
        [roomId]: {
          ...state.roomsData[roomId],
          winnerCard: card,
          showWinnerPopup: false,
        },
      },
    })),

  closeWinnerPopup: (roomId) =>
    set((state) => ({
      roomsData: {
        ...state.roomsData,
        [roomId]: {
          ...state.roomsData[roomId],
          showWinnerPopup: false,
        },
      },
    })),

  stopNumberDraw: (roomId) => {
    const roomState = get().roomsData[roomId];
    if (roomState?.drawIntervalId) {
      clearInterval(roomState.drawIntervalId);
      set((state) => ({
        roomsData: {
          ...state.roomsData,
          [roomId]: { ...roomState, drawIntervalId: null },
        },
      }));
    }
  },

  // Socket
  connectToServer: () => {
    const { socket } = get();
    if (socket?.connected) return;

    console.log("🔌 Connecting to server:", SERVER_URL);
    const newSocket = io(SERVER_URL);

    newSocket.on("connect", () => {
      console.log("✅ Connected to server");
    });

    newSocket.on("disconnect", () => {
      console.log("❌ Disconnected from server");
    });

    newSocket.on("gameStarted", (data: any) => {
      console.log("🎮 Game started:", data);
      get().startNumberStream(data.roomId, data.gameId);
    });

    newSocket.on("numberDrawn", (data: any) => {
      const { number, drawnNumbers, roomId } = data;
      console.log(`🎲 Number drawn: ${number}`);
      set((state) => ({
        roomsData: {
          ...state.roomsData,
          [roomId]: {
            ...state.roomsData[roomId],
            displayedCalledNumbers: drawnNumbers,
          },
        },
      }));
    });

    newSocket.on("gameEnded", (data: any) => {
      console.log("🔚 Game ended:", data);
      get().stopNumberDraw(data.roomId);

      const { user } = useAuthStore.getState();
      if (data.winner) {
        if (user?.telegramId === data.winner) {
          get().setShowWinnerPopup(data.roomId, true);
        } else {
          get().setShowLoserPopup(data.roomId, true);
        }
      }
    });

    newSocket.on("winnerConfirmed", async (data: any) => {
      const { roomId, userId, cardId, patternIndices } = data;
      const { user } = useAuthStore.getState();

      if (user?.telegramId === userId) {
        get().setShowWinnerPopup(roomId, true);
        return;
      }

      const cardRef = ref(rtdb, `rooms/${roomId}/bingoCards/${cardId}`);
      const snap = await fbget(cardRef);
      const card = snap.val();
      if (!card) return;

      get().setWinnerCard(roomId, {
        ...card,
        numbers: card.numbers,
        winningPatternIndices: patternIndices,
      });
      get().setShowLoserPopup(roomId, true);
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

  startNumberStream: (roomId, gameId) => {
    const gameRef = ref(rtdb, `games/${gameId}`);
    onValue(gameRef, (snapshot) => {
      const data = snapshot.val();
      if (!data) return;

      const { currentDrawnNumbers, gameStatus } = data;
      if (gameStatus === "ended") {
        get().stopNumberDraw(roomId);
        return;
      }

      if (currentDrawnNumbers) {
        set((state) => ({
          roomsData: {
            ...state.roomsData,
            [roomId]: {
              ...state.roomsData[roomId],
              displayedCalledNumbers: currentDrawnNumbers,
            },
          },
        }));
      }
    });
  },

  // Bingo check
  checkBingo: async (pattern: number[]) => {
    try {
      const { currentRoom, roomsData } = get();
      const { user } = useAuthStore.getState();
      if (!currentRoom || !user) {
        return { success: false, message: "Missing required data" };
      }

      const roomState = roomsData[currentRoom.id];
      const cardToUse =
        roomState?.bingoCards.find(
          (c) => c.claimed && c.claimedBy === user.telegramId
        ) || null;

      if (!cardToUse) {
        return { success: false, message: "No valid card found" };
      }

      const response = await fetch(`/api/check-bingo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomId: currentRoom.id,
          cardId: cardToUse.id,
          userId: user.telegramId,
          pattern,
        }),
      });

      const result = await response.json();
      if (result.success) {
        get().setWinnerCard(currentRoom.id, cardToUse);
        get().setShowWinnerPopup(currentRoom.id, true);
      }
      return result;
    } catch {
      return { success: false, message: "Network error" };
    }
  },

  // End game
  endGame: async (roomId: string) => {
    try {
      const response = await fetch(`/api/end-game`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId, reason: "manual" }),
      });
      await response.json();
    } catch (err) {
      console.error("❌ Error ending game:", err);
    }
  },

  fetchRooms: () => {
    const roomsRef = ref(rtdb, "rooms");
    onValue(roomsRef, (snapshot) => {
      const data = snapshot.val();
      const rooms: Room[] = data
        ? Object.entries(data).map(([id, value]: [string, any]) => ({
            id,
            ...value,
          }))
        : [];
      set({ rooms });
    });
  },

  joinRoom: (roomId: string) => {
    const { socket } = get();
    if (!socket?.connected) get().connectToServer();
    if (socket) socket.emit("joinRoom", roomId);

    const roomRef = ref(rtdb, "rooms/" + roomId);
    onValue(roomRef, (snapshot) => {
      if (!snapshot.exists()) return;
      const updatedRoom = { id: roomId, ...snapshot.val() } as Room;
      set({ currentRoom: updatedRoom });

      // Initialize room-specific state
      set((state) => ({
        roomsData: {
          ...state.roomsData,
          [roomId]:
            state.roomsData[roomId] || {
              bingoCards: [],
              displayedCalledNumbers: [],
              winnerCard: null,
              showWinnerPopup: false,
              showLoserPopup: false,
              isBetActive: false,
              drawIntervalId: null,
            },
        },
      }));

      get().fetchBingoCards(roomId);
      if (updatedRoom.gameStatus === "playing" && updatedRoom.gameId) {
        get().startNumberStream(roomId, updatedRoom.gameId);
      }
    });
  },

  fetchBingoCards: (roomId: string) => {
    const cardsRef = ref(rtdb, `rooms/${roomId}/bingoCards`);
    onValue(cardsRef, (snapshot) => {
      const data = snapshot.val();
      const cards: BingoCard[] = data
        ? Object.entries(data).map(([id, value]: [string, any]) => ({
            id,
            roomId,
            ...value,
          }))
        : [];
      set((state) => ({
        roomsData: {
          ...state.roomsData,
          [roomId]: { ...state.roomsData[roomId], bingoCards: cards },
        },
      }));
    });
  },

  selectCard: (cardId: string) => {
    const { currentRoom, roomsData } = get();
    if (!currentRoom) return;
    const card = roomsData[currentRoom.id]?.bingoCards.find((c) => c.id === cardId);
    if (card && !card.claimed) {
      // keep selection logic client-side if needed
      set({ selectedCard: card });
    }
 
  },

  placeBet: async () => {
    const { currentRoom, roomsData } = get();
    const { user } = useAuthStore.getState();
    if (!currentRoom || !user) return false;

    const roomState = roomsData[currentRoom.id];
    const selectedCard = roomState?.bingoCards.find((c) => !c.claimed);
    if (!selectedCard) return false;

    try {
      const cardRef = ref(
        rtdb,
        `rooms/${currentRoom.id}/bingoCards/${selectedCard.id}`
      );
      const result = await runTransaction(cardRef, (card: any) => {
        if (card && !card.claimed) {
          card.claimed = true;
          card.claimedBy = user.telegramId;
          return card;
        }
        return;
      });

      if (!result.committed) return false;

      const playerRef = ref(
        rtdb,
        `rooms/${currentRoom.id}/players/${user.telegramId}`
      );
      await fbset(playerRef, {
        telegramId: user.telegramId,
        username: user.username,
        betAmount: currentRoom.betAmount,
        cardId: selectedCard.id,
      });

      set((state) => ({
        roomsData: {
          ...state.roomsData,
          [currentRoom.id]: {
            ...roomState,
            isBetActive: true,
          },
        },
      }));
      return true;
    } catch {
      return false;
    }
  },

  cancelBet: async (cardId?: string) => {
    const { currentRoom, roomsData } = get();
    const { user } = useAuthStore.getState();
    if (!currentRoom || !user) return false;

    const roomState = roomsData[currentRoom.id];
    const targetCardId =
      cardId || roomState?.bingoCards.find((c) => c.claimedBy === user.telegramId)?.id;
    if (!targetCardId) return false;

    try {
      const cardRef = ref(
        rtdb,
        `rooms/${currentRoom.id}/bingoCards/${targetCardId}`
      );
      const playerRef = ref(
        rtdb,
        `rooms/${currentRoom.id}/players/${user.telegramId}`
      );

      await update(cardRef, {
        claimed: false,
        claimedBy: null,
        auto: false,
        autoUntil: null,
      });
      await remove(playerRef);

      set((state) => ({
        roomsData: {
          ...state.roomsData,
          [currentRoom.id]: { ...roomState, isBetActive: false },
        },
      }));
      return true;
    } catch {
      return false;
    }
  },
}));
