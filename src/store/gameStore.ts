
  import { create } from 'zustand';
  import { rtdb } from '../firebase/config';
  import { ref, onValue, get as fbget, set as fbset, update, remove,off, push, query, orderByChild, equalTo, runTransaction } from 'firebase/database';
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
    players?: { [id: string]: { id: string; username: string; betAmount: number; cardId: string ;attemptedBingo: boolean} };
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
    closeWinnerPopup: () => void;
    setWinnerCard: (card: BingoCard) => void;
    setShowWinnerPopup: (show: boolean) => void;
    setShowLoserPopup: (show: boolean) => void;
    endGame: (roomId: string) => void;
    fetchBingoCards: () => void;
    cancelBet: (cardId?: string) => Promise<boolean>;
    isBetActive: boolean;
    drawIntervalId: ReturnType<typeof setInterval> | null;
    countdownInterval: ReturnType<typeof setInterval> | null;
    startCountdownTicker: () => void;
    // Server communication
    socket: Socket | null;
    serverUrl: string;
    connectToServer: () => void;
    disconnectFromServer: () => void;
    checkBingo: (pattern: number[]) => Promise<{ success: boolean; message: string }>;
  }

  // Server configuration
  const SERVER_URL =  process.env.REACT_APP_SERVER_URL || 'https://fridaybot-1.onrender.com/';


  export const useGameStore = create<GameState>((set, get) => ({
    rooms: [],
    drawIntervalId: null,
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
    setRemaining: (remaining: number) => set({ remaining: remaining }),
    setShowLoserPopup: (show: boolean) => set({ showLoserPopup: show }),
    setWinnerCard: (card) => set({ winnerCard: card, showWinnerPopup: false }),
    setShowWinnerPopup: (show: boolean) => set({ showWinnerPopup: show }),
    closeWinnerPopup: () => set({ showWinnerPopup: false }),
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
      const snap = await fbget(ref(rtdb, `rooms/${roomId}`));
      const room = snap.val();
      if (!room) return;
    
      set({
        currentRoom: { id: roomId, ...room },
        displayedCalledNumbers: {
          ...get().displayedCalledNumbers,
          [roomId]: Object.values(room.drawnNumbers || {}),
        },
      });
    
      console.log("🔄 Room synced:", room.gameStatus);
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
        const { currentRoom } = get();

      // ✅ Ignore events not from current room
      if (!currentRoom || data.roomId !== currentRoom.id) return;
        if (currentRoom && data.roomId === currentRoom.id) {
          
          const { startBalanceListener } = useAuthStore.getState() as any;
          if (startBalanceListener) startBalanceListener();
        }
      });
      newSocket.on("countdownStarted", ({ roomId, countdownEndAt }) => {
        console.log("⏰ countdownStarted", roomId);
      
        const remainingSec = Math.ceil((countdownEndAt - Date.now()) / 1000);
        set({ remaining: remainingSec > 0 ? remainingSec : 0 });
      
        get().startCountdownTicker(); // ✅ start ticking locally
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
          }));}
        });

      newSocket.on('gameEnded', (data: any) => {
        const { currentRoom } = get();

      // ✅ Ignore events not from current room
      if (!currentRoom || data.roomId !== currentRoom.id) return;
        console.log('🔚 Game ended:', data);
       
        if (data.winner) {
          // Handle winner announcement
          const { user } = useAuthStore.getState();
          if (user?.telegramId === data.winner) {
            get().setShowWinnerPopup(true);
            console.log('🔚 showing winner popup', data);
          } else {
            get().setShowLoserPopup(true);
            console.log('🔚 showing loser popup', data);
          }
        }
        // Keep live balance listener; it will reflect payout automatically
      });

      // Winner confirmed immediately after server validates bingo
      newSocket.on('winnerConfirmed', async (data: any) => {
        const { currentRoom } = get();

      // ✅ Ignore events not from current room
      if (!currentRoom || data.roomId !== currentRoom.id) return;
        try {
          const { roomId, userId, cardId, patternIndices } = data as any;
          const { user } = useAuthStore.getState();

          if (user?.telegramId === userId) {
            // Winner
            get().setShowWinnerPopup(true);
            return;
          }

          // Loser: fetch winner card and show highlighted pattern
          const cardRef = ref(rtdb, `rooms/${roomId}/bingoCards/${cardId}`);
          const snap = await fbget(cardRef);
          const card = snap.val();
          if (!card) return;
          
          // Store the original numbers and winning pattern indices
          get().setWinnerCard({ 
            ...card, 
            numbers: card.numbers, // Keep original numbers
            winningPatternIndices: patternIndices // Store pattern indices separately
          });
          get().setShowLoserPopup(true);
        } catch (e) {
          console.error('Failed to show loser winner card:', e);
        }
      });
      newSocket.on('roomUpdated', ({ roomId, room }) => {
        set({
          currentRoom: { id: roomId, ...room },
          displayedCalledNumbers: {
            ...get().displayedCalledNumbers,
            [roomId]: Object.values(room.drawnNumbers || {}),
          },
        });
      });
      
      
      newSocket.on('roomReset', () => {
        console.log('♻️ Room reset');
        // Refresh room data
        const { currentRoom } = get();
        if (currentRoom) {
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


    // Server-side bingo check
    checkBingo: async (pattern: number[]) => {
      try {
        const { currentRoom, selectedCard, socket } = get();
        const { user } = useAuthStore.getState();
        if (!currentRoom || !user) {
          return { success: false, message: 'Missing required data' };
        }

            
      const cardsRef = ref(rtdb, `rooms/${currentRoom.id}/bingoCards`);
      const snap = await fbget(cardsRef);
      const cards = snap.exists() ? Object.values(snap.val()) : [];
      const userCard = cards.find(
        (card: any) => card.claimed && card.claimedBy === user.telegramId
      );

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
            room: currentRoom,
            player: currentRoom?.players[user.telegramId],
          }),
        });

        const result = await response.json();
        
        if (result.success) {
          console.log('🏆 Bingo confirmed by server!');
          get().setWinnerCard(cardToUse.val() as BingoCard);  
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
    
      if (!socket?.connected) {
        get().connectToServer();
      }
    
      if (socket) {
        if (currentRoom?.id && currentRoom.id !== roomId) {
          socket.emit("leaveRoom", currentRoom.id);
          console.log("➡️ Leaving room", currentRoom.id);
    
          // ✅ Remove old Firebase listeners
          const oldRoomRef = ref(rtdb, "rooms/" + currentRoom.id);
          off(ref(rtdb, `rooms/${currentRoom.id}`));
          off(ref(rtdb, `rooms/${currentRoom.id}/bingoCards`));
          off(oldRoomRef);
        }
        socket.emit("joinRoom", roomId);
        console.log("➡️ Joining room", roomId);
      }
      set({
        selectedCard: null,
        isBetActive: false,
        bingoCards: [],
        displayedCalledNumbers: { ...get().displayedCalledNumbers, [roomId]: [] },
        currentRoom: null, // will be updated below
      });
      const roomRef = ref(rtdb, "rooms/" + roomId);
    
      // ✅ Remove any old listener on this room before re-attaching
      off(roomRef);
    
      onValue(roomRef, (snapshot) => {
        if (!snapshot.exists()) {
          set({ currentRoom: null, isBetActive: false, selectedCard: null });
          return;
        }
    
        const updatedRoom = { id: roomId, ...snapshot.val() } as Room;
        set({ currentRoom: updatedRoom });
    
        get().fetchBingoCards();
    
        
        if (updatedRoom.calledNumbers?.length > 0) {
          set((state) => ({
            displayedCalledNumbers: {
              ...state.displayedCalledNumbers,
              [roomId]: updatedRoom.calledNumbers,
            },
          }));
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
      const { currentRoom } = get();
      const { user } = useAuthStore.getState();
      if (!currentRoom || !user) return false;

      const userId = user.telegramId;
      if (!userId) {
        console.error("❌ No valid telegramId for user:", user);
        return false;
      }

      try {
        // Remove player from room
        const playerRef = ref(rtdb, `rooms/${currentRoom.id}/players/${userId}`);
        await remove(playerRef);

        // Unclaim card if cardId is provided
        if (cardId) {
          const cardRef = ref(rtdb, `rooms/${currentRoom.id}/bingoCards/${cardId}`);
          await update(cardRef, { claimed: false, claimedBy: null });
        }

        set({ isBetActive: false, selectedCard: null });
        return true;
      } catch (err) {
        console.error("❌ Error canceling bet:", err);
        return false;
      }
    },

    fetchBingoCards: () => {
      const { currentRoom } = get();
      if (!currentRoom) {
        set({ bingoCards: [] });
        return;
      }
      off(ref(rtdb, `rooms/${currentRoom.id}/bingoCards`));
      const cardsRef = ref(rtdb, `rooms/${currentRoom.id}/bingoCards`);
      onValue(cardsRef, (snapshot) => {
        const data = snapshot.val();
        const cards: BingoCard[] = data
          ? Object.entries(data).map(([id, value]: [string, any]) => ({ id, ...value, roomId:currentRoom.id }))
          : [];
        set({ bingoCards: cards });
      });
    },

    // Firebase listener for room updates
    // This is handled within joinRoom now
  }));

