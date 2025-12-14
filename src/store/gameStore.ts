
  import { create } from 'zustand';
  import { useAuthStore } from '../store/authStore';
  import { io, Socket } from 'socket.io-client';
  import { getSocketUrl, getApiUrl } from '../config/api';

  interface BingoCard {
    id: string;
    numbers: number[][];
    serialNumber: number;
    claimed: boolean;
    claimedBy?: string | null;
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
    countdownStartedBy: string;
    calledNumbers: number[];
    winner?: string;
    payout?: number;
    payed: boolean;
    currentWinner?: string;
    countdownEndAt: number;
    players?: { [id: string]: { id: string; username: string; betAmount: number; cardId: string ;attemptedBingo: boolean} };
    gameId?: string;
    nextGameCountdownEndAt?: number;
    bingoCards?: Record<string, any>;
  }

  interface GameState {
    rooms: Room[];
    currentRoom: Room | null;
    selectedCard: BingoCard | null;
    bingoCards: BingoCard[];
    loading: boolean;
    startingGame: boolean;
    remaining: number;
    syncRoomState: (roomId: string) => Promise<void>;
    setRemaining: (remaining: number) => void;
    fetchRooms: () => void;
    joinRoom: (roomId: string) => void;
    selectCard: (cardId: string) => void;
    placeBet: () => Promise<boolean>;
    displayedCalledNumbers: { [roomId: string]: number[] };
    winnerCard: BingoCard | null;
    showWinnerPopup: boolean;
    showLoserPopup: boolean;
    enteredRoom : boolean;
    setEnteredRoom: (show: boolean) => void;
    closeWinnerPopup: () => void;
    setWinnerCard: (card: BingoCard) => void;
    setShowWinnerPopup: (show: boolean) => void;
    setShowLoserPopup: (show: boolean) => void;
    endGame: (roomId: string) => void;
    cancelBet: (cardId?: string) => Promise<boolean>;
    isBetActive: boolean;
    drawIntervalId: ReturnType<typeof setInterval> | null;
    countdownInterval: ReturnType<typeof setInterval> | null;
    startCountdownTicker: () => void;
    // Server communication
    socket: Socket | null;
    reconnectInterval: ReturnType<typeof setInterval> | null;
    serverUrl: string;
    connectToServer: () => void;
    safeSetShowPopup: (type: 'winner' | 'loser') => void;
    startAutoReconnectMonitor :() => void ;
    autoReconnectToServer: () => void;
    disconnectFromServer: () => void;
    checkBingo: (pattern: number[]) => Promise<{ success: boolean; message: string }>;
  }

  // Server configuration - uses environment variable
  const SERVER_URL = getSocketUrl();


  export const useGameStore = create<GameState>((set, get) => ({
    rooms: [],
    drawIntervalId: null,
    reconnectInterval :null,
    displayedCalledNumbers: {} as { [roomId: string]: number[] },
    winnerCard: null,
    remaining: 0,
    countdownInterval: null,
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
    enteredRoom:false,
    setEnteredRoom : (show:boolean) => set({enteredRoom : show}),
    setRemaining: (remaining: number) => set({ remaining: remaining }),
    setShowLoserPopup: (show: boolean) => set({ showLoserPopup: show }),
    setWinnerCard: (card) => set({ winnerCard: card, showWinnerPopup: false }),
    setShowWinnerPopup: (show: boolean) => set({ showWinnerPopup: show }),
    closeWinnerPopup: () => set({ showWinnerPopup: false }),
    safeSetShowPopup: (type: 'winner' | 'loser') => {
      set((state) => {
        if (type === 'winner' && !state.showWinnerPopup) {
          return { showWinnerPopup: true };
        }
        if (type === 'loser' && !state.showLoserPopup) {
          return { showLoserPopup: true };
        }
        return state; // no change if already true
      });
    },
    // inside useGameStore
autoReconnectToServer: () => {
  const { socket, connectToServer, syncRoomState } = get();

  // if already connected, skip
  if (socket && socket.connected) return;

  console.warn('[autoReconnect] Socket disconnected. Retrying...');

  // try reconnect
  connectToServer();

  // after short delay, re-sync current room if user was in one
  setTimeout(async () => {
    const currentRoom = get().currentRoom;
    if (currentRoom?.id) {
      console.log('[autoReconnect] Re-syncing room state:', currentRoom.id);
      await syncRoomState(currentRoom.id);
    }
  }, 3000);
},

    startCountdownTicker: () => {
      const { remaining ,countdownInterval } = get();
      if (remaining <= 0) return;
    
      // clear any previous interval
      if (countdownInterval) {
        clearInterval(countdownInterval);
      }
    
      const timer = setInterval(() => {
        const r = get().remaining - 1;
        set({ remaining: r > 0 ? r : 0 });
        if (r <= 0) {
          clearInterval(timer);
          set({ countdownInterval: null });
        }
      }, 1000);
    
      set({ countdownInterval: timer });
    },
    syncRoomState: async (roomId: string) => {
      try {
        const response = await fetch(
          getApiUrl(`/api/room-state?roomId=${encodeURIComponent(roomId)}`)
        );
        if (!response.ok) {
          console.error("❌ Failed to fetch room state", roomId);
          return;
        }
        const data = await response.json();
        const room = data.room;
        if (!room) return;

        const normalizedStatus =
           room.gameStatus || "waiting";

        const calledNumbers = Array.isArray(room.calledNumbers)
          ? room.calledNumbers
          : [];

        const cardsObject = room.bingoCards || {};
        const cardsArray: BingoCard[] = Object.entries(cardsObject).map(
          ([id, value]: [string, any]) => ({
            id,
            ...value,
            roomId,
          })
        );

        const normalizedRoom = { ...room, gameStatus: normalizedStatus };

        set({
          currentRoom: { id: roomId, ...normalizedRoom },
          bingoCards: cardsArray,
          displayedCalledNumbers: {
            ...get().displayedCalledNumbers,
            [roomId]: calledNumbers,
          },
        });
      } catch (err) {
        console.error("❌ Error syncing room state:", err);
      }
    },
    
    
    // Connect to server via Socket.IO
    connectToServer: () => {
      const { socket } = get();
      if (socket?.connected) return;

      console.log('🔌 Connecting to server:', SERVER_URL);
      const newSocket = io(SERVER_URL);

      newSocket.on('connect', async () => {
        console.log('✅ Connected to server');
        const { currentRoom, syncRoomState } = get();
        if (currentRoom?.id) {
          await syncRoomState(currentRoom.id);
        }
      });
      

      newSocket.on('disconnect', () => {
        console.log('❌ Disconnected from server');
      });

      newSocket.on('gameStarted', (data: any) => {
        console.log('🎮 Game started:', data);
        set((state) => {
          if (!state.currentRoom || data.roomId !== state.currentRoom.id) {
            return state;
          }
          return {
            ...state,
            currentRoom: {
              ...state.currentRoom,
              gameStatus: 'playing',
              currentGameId: data.gameId,
            },
          };
        });

        const { startBalanceListener } = useAuthStore.getState() as any;
        if (startBalanceListener) startBalanceListener();
      });
      newSocket.on("countdownStarted", ({ roomId, countdownEndAt }) => {
        console.log("⏰ countdownStarted", roomId);
      
        const remainingSec = Math.ceil((countdownEndAt - Date.now()) / 1000);
        set({ remaining: remainingSec > 0 ? remainingSec : 0 });
      
        get().startCountdownTicker(); // ✅ start ticking locally
        set((state) => {
          if (!state.currentRoom || state.currentRoom.id !== roomId) return state;
          return {
            ...state,
            currentRoom: {
              ...state.currentRoom,
              gameStatus: 'countdown',
              countdownEndAt,
            },
          };
        });
      });
      
        newSocket.on('numberDrawn', (data: any) => {
          const { number, drawnNumbers, roomId } = data;
          console.log(`🎲 Number drawn: ${number} room:currentRoom.id:${get().currentRoom?.id} roomId:${roomId}`);
          const { currentRoom } = get();

        // ✅ Ignore events not from current room
        if (!currentRoom || roomId !== currentRoom.id) return;
        if (currentRoom && roomId === currentRoom.id) {
        set((state) => ({
          displayedCalledNumbers: {
            ...state.displayedCalledNumbers,
            [roomId]: drawnNumbers,
          },
          currentRoom: state.currentRoom
            ? { ...state.currentRoom, calledNumbers: drawnNumbers }
            : state.currentRoom,
        }));}
        });

      newSocket.on('gameEnded', (data: any) => {
        set((state) => {
          if (!state.currentRoom || data.roomId !== state.currentRoom.id) {
            return state;
          }
          return {
            ...state,
            currentRoom: {
              ...state.currentRoom,
              gameStatus: 'ended',
              nextGameCountdownEndAt: data.nextGameCountdownEndAt,
            },
          };
        });
        // Keep live balance listener; it will reflect payout automatically
      });

      // Winner confirmed immediately after server validates bingo
      newSocket.on('winnerConfirmed', async (data: any) => {
        const { currentRoom } = get();
        if (!currentRoom || data.roomId !== currentRoom.id) return;
        try {
          const { roomId, userId, cardId, patternIndices } = data as any;
          const { user } = useAuthStore.getState();

          // Find or fetch the winner's card
          let card =
            get().bingoCards.find((c) => c.id === cardId) || null;

          if (!card) {
            const resp = await fetch(
              getApiUrl(
                `/api/card?roomId=${encodeURIComponent(
                  roomId
                )}&cardId=${encodeURIComponent(cardId)}`
              )
            );
            if (resp.ok) {
              const payload = await resp.json();
              card = payload.card ? { id: cardId, ...payload.card } : null;
            }
          }

          if (!card) return;

          // Set winner card with pattern indices
          get().setWinnerCard({
            ...card,
            winningPatternIndices: patternIndices,
          });

          if (user?.telegramId === userId) {
            // Winner - show winner popup
            get().safeSetShowPopup('winner');
          } else {
            // Loser - show loser popup
            get().safeSetShowPopup('loser');
          }
        } catch (e) {
          console.error('Failed to show winner/loser popup:', e);
        }
      });
      newSocket.on('bingoChecked', async (data: any) => {
        const { currentRoom } = get();
        if (!currentRoom || data.roomId !== currentRoom.id) return;
      
        try {
          const { user } = useAuthStore.getState();
      
          // ✅ If winner popup hasn’t shown yet
          if (user?.telegramId === data.winnerId) {
            if (!get().showWinnerPopup) get().safeSetShowPopup('winner');
          } else {
            if (!get().showLoserPopup) get().safeSetShowPopup('loser');
          }
        } catch (e) {
          console.error('Error in bingoChecked fallback:', e);
        }
      });
      
      
      newSocket.on('roomReset', () => {
        console.log('♻️ Room reset');
        const { currentRoom } = get();
        if (currentRoom?.id) {
          get().syncRoomState(currentRoom.id);
        }
      });

      newSocket.on('playerBetPlaced', (payload: any) => {
        set((state) => {
          if (!state.currentRoom || payload.roomId !== state.currentRoom.id) {
            return state;
          }
          const updatedPlayers = {
            ...(state.currentRoom.players || {}),
            [payload.playerId]: {
              telegramId: payload.playerId,
              username: payload.username,
              betAmount: payload.betAmount,
              cardId: payload.cardId,
              attemptedBingo: false,
            },
          };
          const updatedCards = state.bingoCards.map((card) =>
            card.id === payload.cardId
              ? { ...card, claimed: true, claimedBy: payload.playerId }
              : card
          );
          return {
            ...state,
            currentRoom: { ...state.currentRoom, players: updatedPlayers },
            bingoCards: updatedCards,
          };
        });
      });

      newSocket.on('playerBetCancelled', (payload: any) => {
        set((state) => {
          if (!state.currentRoom || payload.roomId !== state.currentRoom.id) {
            return state;
          }
          const updatedPlayers = { ...(state.currentRoom.players || {}) };
          delete updatedPlayers[payload.playerId];
          const updatedCards = state.bingoCards.map((card) =>
            card.id === payload.cardId
              ? { ...card, claimed: false, claimedBy: null }
              : card
          );
          return {
            ...state,
            currentRoom: { ...state.currentRoom, players: updatedPlayers },
            bingoCards: updatedCards,
          };
        });
      });

      newSocket.on('cardAutoUpdated', (payload: any) => {
        set((state) => {
          if (!state.currentRoom || payload.roomId !== state.currentRoom.id) {
            return state;
          }
          const updatedCards = state.bingoCards.map((card) =>
            card.id === payload.cardId
              ? {
                  ...card,
                  auto: payload.auto,
                  autoUntil: payload.autoUntil || null,
                }
              : card
          );
          return {
            ...state,
            bingoCards: updatedCards,
          };
        });
      });

      set({ socket: newSocket });
    },

    disconnectFromServer: () => {
      const { socket, reconnectInterval } = get();
    
      if (socket) {
        socket.disconnect();
        console.log('[Socket] Disconnected manually.');
      }
    
      if (reconnectInterval) {
        clearInterval(reconnectInterval);
        set({ reconnectInterval: null });
        console.log('[AutoReconnect] Monitor cleared.');
      }
    },
    

    startAutoReconnectMonitor: () => {
      const interval = setInterval(() => {
        const { socket, autoReconnectToServer } = get();
        if (!socket || !socket.connected) {
          autoReconnectToServer();
        }
      }, 10000); // every 10 seconds
      set({ reconnectInterval: interval });
    },
    
    // Server-side bingo check
    checkBingo: async (pattern: number[]) => {
      try {
        const { currentRoom, selectedCard } = get();
        const { user } = useAuthStore.getState();
        if (!currentRoom || !user) {
          return { success: false, message: 'Missing required data' };
        }

            
      const cards = get().bingoCards;
      const userCard = cards.find(
        (card: BingoCard) => card?.claimed && card?.claimedBy === user.telegramId
      );

        // If no claimed card found, use selected card
        const cardToUse = userCard || selectedCard;
        
        if (!cardToUse || !cardToUse.id) {
          console.log('❌ No valid card found for bingo check');
          return { success: false, message: 'No valid card found' };
        }

        console.log('🎯 Checking bingo with server...');

        const response = await fetch(getApiUrl('/api/check-bingo'), {
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
          get().setWinnerCard(cardToUse as BingoCard);  
          get().safeSetShowPopup('winner');
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
        
        const response = await fetch(getApiUrl('/api/end-game'), {
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

    fetchRooms: async () => {
      try {
        const response = await fetch(getApiUrl('/api/rooms'));
        if (!response.ok) {
          console.error('❌ Failed to fetch rooms list');
          return;
        }
        const data = await response.json();
        const rooms: Room[] = Array.isArray(data.rooms)
          ? data.rooms.map((room: any) => ({
              id: room.id,
              ...room,
              gameStatus:room.gameStatus || 'waiting',
            }))
          : [];
        set({ rooms });
      } catch (err) {
        console.error('❌ Error fetching rooms:', err);
      }
    },

    joinRoom: (roomId: string) => {
      const { socket, currentRoom } = get();

      if (!socket?.connected) {
        get().connectToServer();
      }

      if (socket) {
        if (currentRoom?.id && currentRoom.id !== roomId) {
          socket.emit("leaveRoom", currentRoom.id);
          console.log("➡️ Leaving room", currentRoom.id);
          get().setEnteredRoom(false);
        }
        socket.emit("joinRoom", roomId);
        console.log("➡️ Joining room", roomId);
      }

      set({
        selectedCard: null,
        isBetActive: false,
        bingoCards: [],
        displayedCalledNumbers: {
          ...get().displayedCalledNumbers,
          [roomId]: [],
        },
        currentRoom: null,
      });

      get().startAutoReconnectMonitor();
      get().syncRoomState(roomId);
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
        const response = await fetch(getApiUrl("/api/place-bet"), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            roomId: currentRoom.id,
            cardId: selectedCard.id,
            userId,
          }),
        });

        const result = await response.json();
        if (!response.ok || !result.success) {
          alert(result.message || "Failed to place bet");
          return false;
        }

        set({ isBetActive: true });
        await get().syncRoomState(currentRoom.id);
        return true;
      } catch (err) {
        console.error("❌ Error placing bet (API):", err);
        return false;
      }
    },

    cancelBet: async (cardId?: string) => {
      const { currentRoom } = get();
      const { user } = useAuthStore.getState();
      if (!currentRoom || !user) return false;

      const userId = user.telegramId;
      if (!userId) {
        console.error("❌ No valid telegramId for user:", user);
        return false;
      }

      if (!cardId) {
        console.error("❌ cancelBet requires a cardId");
        return false;
      }

      try {
        const response = await fetch(getApiUrl("/api/cancel-bet"), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            roomId: currentRoom.id,
            cardId,
            userId,
          }),
        });

        const result = await response.json();
        if (!response.ok || !result.success) {
          console.error("❌ Failed to cancel bet:", result);
          return false;
        }

        set({ isBetActive: false, selectedCard: null });
        await get().syncRoomState(currentRoom.id);
        return true;
      } catch (err) {
        console.error("❌ Error canceling bet (API):", err);
        return false;
      }
    },
  }));

