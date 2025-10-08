import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useLanguageStore } from '../store/languageStore';
import { useGameStore } from '../store/gameStore';
import { useAuthStore } from '../store/authStore';
import { rtdb } from '../firebase/config';
import { ref, update, get , onValue } from 'firebase/database';

const CountdownOverlay = ({
  countdownEndAt,
  label,
}: {
  countdownEndAt: number;
  label: string;
}) => {
  const calculateRemaining = () => {
    const remainingMs = countdownEndAt - Date.now();
    const remainingSeconds = Math.ceil(remainingMs / 1000);
    return Math.max(0, Math.min(30, remainingSeconds));
  };

  const [remaining, setRemaining] = React.useState(calculateRemaining);

  React.useEffect(() => {
    const interval = setInterval(() => {
      setRemaining(calculateRemaining());
    }, 1000);
    return () => clearInterval(interval);
  }, [countdownEndAt]);

  if (remaining <= 0) return null;

  const isNextRound = label === "Next round starting in";

  const minutes = Math.floor(remaining / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (remaining % 60).toString().padStart(2, "0");
  const formattedTime = `${minutes}:${seconds}`;

  return (
    <div className="absolute inset-0 bg-black/70 flex items-center justify-center rounded">
      <div
        className={`bg-white text-black text-center shadow-xl flex flex-col items-center justify-center
          ${isNextRound 
            ? "w-4/5 h-4/5 rounded scale-75"
            : "w-4/5 h-2/5 rounded-xl p-2"}
        `}
      >
        <h2 className={`font-bold mb-2 ${isNextRound ? "text-1" : "text-l"}`}>
          {label}
        </h2>
        <p className={`${isNextRound ? "text-2xl" : "text-2xl"} font-mono`}>
          {formattedTime}
        </p>
      </div>
    </div>
  );
};

const Room: React.FC = () => {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const { t ,language} = useLanguageStore();

  const getList = (key: string): string[] => {
    const anyT = t as unknown as (k: string) => any;
    const val = anyT(key);
    return Array.isArray(val) ? (val as string[]) : [];
  };

  const {
    winnerCard, showWinnerPopup, closeWinnerPopup,setWinnerCard,
    currentRoom, bingoCards, joinRoom, selectCard,
    placeBet, selectedCard,
    showLoserPopup, setShowLoserPopup,
    connectToServer, checkBingo,
    setShowWinnerPopup
  } = useGameStore();
  const { user, updateBalance } = useAuthStore();

  const userCard = bingoCards.find(
    (card) => card.claimed && card.claimedBy === user?.telegramId
  );

  const [remaining, setRemaining] = useState<number | null>(null);
  const displayedCard = userCard || selectedCard ;
  const cardNumbers = displayedCard?.numbers ?? [];
  const [hasBet, setHasBet] = useState(false);
  const [gameMessage, setGameMessage] = useState('');

  const [markedNumbers, setMarkedNumbers] = React.useState<number[]>([]);
  const cancelBet = useGameStore((state) => state.cancelBet);
  const displayedCalledNumbers = useGameStore(
    (s) => s.displayedCalledNumbers[currentRoom?.id || ""] || []
  );
  const [hasAttemptedBingo, setHasAttemptedBingo] = useState(false);
  const [isDisqualified, setIsDisqualified] = useState(false);

  useEffect(() => {
    if (showWinnerPopup) {
      const timer = setTimeout(() => {
        setShowWinnerPopup(false);
      }, 10000);
      return () => clearTimeout(timer);
    }
  }, [showWinnerPopup, setShowWinnerPopup]);

  useEffect(() => {
    if (showLoserPopup) {
      setGameMessage(t('loser_bingo'))
      const timer = setTimeout(() => {
        setShowLoserPopup(false);
      }, 10000);
      return () => clearTimeout(timer);
    }
  }, [showLoserPopup, setShowLoserPopup]);

  const startNumberStream = useGameStore((s) => s.startNumberStream);
  const playerData = currentRoom?.players?.[user?.telegramId as string];
  const alreadyBetted = !!playerData?.betAmount && playerData.betAmount > 0;
  const storeIsBetActive = useGameStore((s) => s.isBetActive);

  const flatCard = React.useMemo(() => cardNumbers.flat(), [cardNumbers]);

  const [claimed, setClaimed] = useState(false);

  React.useEffect(() => {
    connectToServer();
  }, [connectToServer]);

  React.useEffect(() => {
    if (!displayedCard || !currentRoom) return;
    const cardRef = ref(rtdb, `rooms/${currentRoom.id}/bingoCards/${displayedCard.id}`);

    const unsubscribe = onValue(cardRef, (snap) => {
      if (snap.exists()) {
        setClaimed(!!snap.val().claimed);
      }
    });

    return () => unsubscribe();
  }, [displayedCard?.id, currentRoom?.id]);

  const [autoCard, setAutoCard] = useState<{
    auto: boolean;
    autoUntil: number | null;
  } | null>(null);

  React.useEffect(() => {
    if (!displayedCard) return;
    const cardRef = ref(
      rtdb,
      `rooms/${currentRoom?.id}/bingoCards/${displayedCard.id}`
    );

    const unsubscribe = onValue(cardRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        setAutoCard({
          auto: data.auto ?? false,
          autoUntil: data.autoUntil ?? null,
        });
      }
    });

    return () => unsubscribe();
  }, [displayedCard, currentRoom?.id]);

  function findCoveredPatternByMarks() {
    if (!displayedCard) return null;
    const flatCard = displayedCard.numbers.flat().map((n) => n || 0);
    const markedSet = new Set(markedNumbers);
    const patterns = generatePatterns();

    for (let pIdx = 0; pIdx < patterns.length; pIdx++) {
      const indices = patterns[pIdx];
      const fullyCovered = indices.every((i) => {
        const num = flatCard[i];
        return num === 0 || markedSet.has(num);
      });
      if (fullyCovered) {
        return {
          patternIndex: pIdx,
          patternIndices: indices,
          patternNumbers: indices.map((i) => flatCard[i]),
        };
      }
    }

    return null;
  }

  function patternExistsInCalled(patternNumbers: number[]) {
    const calledSet = new Set(displayedCalledNumbers);
    return patternNumbers.every((n) => n === 0 || calledSet.has(n));
  }

  const coveredPattern = findCoveredPatternByMarks();
  const isBetActive = hasBet || alreadyBetted || storeIsBetActive;

  React.useEffect(() => {
    if (currentRoom?.gameStatus === "playing" && currentRoom.gameId) {
      startNumberStream(currentRoom.id, currentRoom.gameId);
    }
  }, [currentRoom?.gameStatus, currentRoom?.gameId]);

  const alreadyAttempted = playerData?.attemptedBingo ?? false;
  React.useEffect(() => {
    setHasAttemptedBingo(alreadyAttempted);
  }, [alreadyAttempted]);

  React.useEffect(() => {
    if (currentRoom?.gameStatus === "playing") {
      setMarkedNumbers([]);
    }
  }, [currentRoom?.gameStatus]);

  React.useEffect(() => {
    if (roomId) {
      joinRoom(roomId);
    }
  }, [roomId, joinRoom]);

  React.useEffect(() => {
    if (!gameMessage) return;

    const timer = setTimeout(() => setGameMessage(''), 3000);
    return () => clearTimeout(timer);
  }, [gameMessage]);

  React.useEffect(() => {
    if (!selectedCard) return;
    const updatedCard = bingoCards.find((c) => c.id === selectedCard.id);
    if (!updatedCard) return;
    if (!updatedCard.claimed || updatedCard.claimedBy === user?.telegramId) {
      return;
    }
    selectCard("");
  }, [bingoCards, selectedCard, user?.telegramId, selectCard]);

  const [popupMessage, setPopupMessage] = useState<string | null>(null);
  React.useEffect(() => {
    if (!popupMessage) return;
    const timer = setTimeout(() => setPopupMessage(null), 3000);
    return () => clearTimeout(timer);
  }, [popupMessage]);

  React.useEffect(() => {
    if (!currentRoom || !user) return;

    const displayedCard = bingoCards.find(
      (card) =>
        card.roomId === currentRoom.id &&
        card.claimed &&
        card.claimedBy === user.telegramId
    ) || selectedCard;

    if (!displayedCard) return;

    if (!currentRoom.isDemoRoom && currentRoom.gameStatus !== "playing" && (user.balance || 0) < currentRoom.betAmount) {
      (async () => {
        const cardId = displayedCard.id;
        const success = await cancelBet(cardId);
        if (success) {
          setHasBet(false);
          setGameMessage(t("insufficient_balance"));
        }
      })();
    } else {
      const playerData = currentRoom.players?.[user.telegramId];
      if (playerData?.betAmount && playerData.betAmount > 0) {
        setHasBet(true);
      }
    }
  }, [currentRoom, user, bingoCards, selectedCard]);

  const handleCardSelect = (cardId: string) => {
    if (!hasBet) {
      selectCard(cardId);
    }
  };

  const handlePlaceBet = async () => {
    if (!displayedCard || !currentRoom) return;

    if (!currentRoom.isDemoRoom && (user?.balance || 0) < currentRoom.betAmount) {
      setGameMessage(t('insufficient_balance'));
      return;
    }

    const success = await placeBet();

    if (success) {
      setHasBet(true);
      if (!currentRoom.isDemoRoom) {
        await updateBalance(-currentRoom.betAmount);
      }
      setGameMessage(t('bet_placed'));
    }
  };

  React.useEffect(() => {
    const { socket } = useGameStore.getState();
    if (!socket) return;

    socket.on("winnerConfirmed", async ({ roomId, gameId, userId, cardId, patternIndices }: any) => {
      if (!currentRoom || currentRoom.id !== roomId) return;

      if (userId === user?.telegramId) {
        const myCard = bingoCards.find((c) => c.id === cardId);
        if (myCard) {
          setWinnerCard(myCard);
          setShowWinnerPopup(true);
        }
      } else {
        const cardSnap = await get(ref(rtdb, `rooms/${roomId}/bingoCards/${cardId}`));
        const cardData = cardSnap.val();
        if (!cardData) return;
        setWinnerCard({ 
          ...cardData, 
          numbers: cardData.numbers,
          winningPatternIndices: patternIndices
        });
        setShowLoserPopup(true);
      }
    });

    return () => {
      socket?.off("winnerConfirmed");
    };
  }, [currentRoom?.id, user?.telegramId]);

  const getPartitionColor = (num: number) => {
    if (num >= 1 && num <= 15) return "from-blue-400 to-blue-600";
    if (num >= 16 && num <= 30) return "from-green-400 to-green-600";
    if (num >= 31 && num <= 45) return "from-yellow-400 to-yellow-600";
    if (num >= 46 && num <= 60) return "from-orange-400 to-orange-600";
    if (num >= 61 && num <= 75) return "from-red-400 to-red-600";
    return "from-gray-400 to-gray-600";
  };

  const [showPatterns, setShowPatterns] = useState(false);

  function generatePatterns() {
    const size = 5;
    const indices: number[][] = [];
    for (let r = 0; r < size; r++) indices.push([...Array(size)].map((_, c) => r * size + c));
    for (let c = 0; c < size; c++) indices.push([...Array(size)].map((_, r) => r * size + c));
    indices.push([...Array(size)].map((_, i) => i * size + i));
    indices.push([...Array(size)].map((_, i) => i * size + (size - 1 - i)));
    indices.push([12, 6, 8, 16, 18]);
    indices.push([0, 4, 20, 24]);
    return indices;
  }

  const handleCancelBet = async () => {
    const cardId = userCard?.id || selectedCard?.id;
    if (!cardId) return;

    const success = await cancelBet(cardId);
    if (success) {
      setHasBet(false);
      setGameMessage('Bet canceled');
    } else {
      console.error("❌ Failed to cancel bet");
    }
  };

  const handleNumberClick = (num: number) => {
    setMarkedNumbers((prev) =>
      prev.includes(num) ? prev.filter((n) => n !== num) : [...prev, num]
    );
  };

  if (!currentRoom) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="text-center text-white">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-white border-t-transparent mx-auto mb-4"></div>
          <p>{t('loading')}</p>
        </div>
      </div>
    );
  };

  const handleBingoClick = async () => {
    if (currentRoom?.gameStatus !== "playing") {
      setGameMessage(t('bingo_not_allowed'));
      return;
    }

    if (!displayedCard || !currentRoom || !user) {
      setGameMessage(t('error_player_card'));
      return;
    }

    if (hasAttemptedBingo) return;

    const covered = findCoveredPatternByMarks();
    if (!covered || !patternExistsInCalled(covered.patternNumbers)) {
      const playerRef = ref(
        rtdb,
        `rooms/${currentRoom.id}/players/${user?.telegramId}`
      );
       await update(playerRef, { attemptedBingo: true });
      
      setGameMessage(t('not_a_winner'));
      setIsDisqualified(true);
      return;
    }

    try {
      const result = await checkBingo(covered.patternIndices);
      if (!result.success) {
        const playerRef = ref(
          rtdb,
          `rooms/${currentRoom.id}/players/${user?.telegramId}`
        );
         await update(playerRef, { attemptedBingo: true });
         setGameMessage(result.message || t('not_a_winner'));
         setHasAttemptedBingo(true);
      }
      setGameMessage(t('bingo_winner'))
    } catch (err) {
      console.error('❌ Error sending bingo claim:', err);
      setGameMessage('Network error');
      setHasAttemptedBingo(false);
    }
  };

  function getBingoLetter(num: number): string {
    if (num >= 1 && num <= 15) return "B-";
    if (num >= 16 && num <= 30) return "I-";
    if (num >= 31 && num <= 45) return "N-";
    if (num >= 46 && num <= 60) return "G-";
    if (num >= 61 && num <= 75) return "O-";
    return "";
  }

  // --------- NEW: grid mode state ----------
  const [enteredRoom, setEnteredRoom] = useState(false);
  const [gridSelectedCardId, setGridSelectedCardId] = useState<string | null>(null);

  const handleGridCardClick = (cardId?: string) => {
    if (!cardId) return; // placeholder
    // if card is claimed by another, do nothing
    const c = bingoCards.find((b) => b.id === cardId);
    if (!c) return;
    if (c.claimed && c.claimedBy !== user?.telegramId) {
      setPopupMessage(t('card_already_claimed') || 'Card already claimed');
      return;
    }

    // toggle selection only if user hasn't placed a bet
    if (!isBetActive) {
      setGridSelectedCardId((prev) => (prev === cardId ? null : cardId));
      selectCard(cardId);
    }
  };

  const handleChooseAndPlaceBet = async () => {
    if (!gridSelectedCardId) {
      setPopupMessage(t('select_a_card_first') || 'Select a card first');
      return;
    }

    // ensure selectedCard is set in store
    selectCard(gridSelectedCardId);

    if (!currentRoom?.isDemoRoom && (user?.balance || 0) < currentRoom.betAmount) {
      setGameMessage(t('insufficient_balance'));
      return;
    }

    const success = await placeBet();
    if (success) {
      setHasBet(true);
      if (!currentRoom.isDemoRoom) await updateBalance(-currentRoom.betAmount);
      setPopupMessage(t('bet_placed') || 'Bet placed');
    }
  };

  const handleEnterRoom = () => {
    // Mark as entered so original layout shows afterwards
    setEnteredRoom(true);
    setPopupMessage(t('entered_room') || 'Entered room');
  };

  // If room is in waiting/countdown AND user hasn't clicked Enter Room -> show grid UI
  const showGridMode = (currentRoom?.gameStatus === 'waiting' || currentRoom?.gameStatus === 'countdown') && !enteredRoom;

  if (showGridMode) {
    // Render simplified grid view
    const totalBoxes = 100; // 10x10
    const cardsToShow = bingoCards.slice(0, totalBoxes);

    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-800 via-purple-900 to-blue-900 flex flex-col items-center p-4 text-white">
        {/* Header */}
        <div className="w-full max-w-6xl">
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-1 mb-3 text-xs">
            <button
              onClick={() => navigate('/')}
              className="flex-1 bg-gradient-to-r from-red-500 to-pink-500 py-2 rounded font-bold text-sm shadow hover:opacity-90 transition"
            >
              {t('home')}
            </button>
            <div className="bg-white/10 rounded text-center py-1 border border-white/20">
              {t('bet')}: {currentRoom.betAmount}
            </div>
            <div className="bg-white/10 rounded text-center py-1 border border-white/20">
              {t('payout')}: {
                Math.max(
                  0,
                  Math.floor(((Object.keys(currentRoom.players || {}).length || 0) * currentRoom.betAmount * 0.9))
                )
              }
            </div>
          </div>

          <div className="bg-white/10 rounded text-center py-1 border border-white/20 w-full mb-4">
            {currentRoom?.gameStatus ?? t('waiting')}
          </div>

          {/* Grid */}
          <div className="bg-theme-light/10 rounded p-3">
            <div className="grid grid-cols-10 gap-2">
              {Array.from({ length: totalBoxes }).map((_, idx) => {
                const card = cardsToShow[idx];
                const isPlaceholder = !card;
                const isClaimed = !!card?.claimed;
                const claimedByMe = card?.claimedBy === user?.telegramId;

                const baseClass = 'w-full aspect-square rounded-md flex items-center justify-center font-bold text-[12px] cursor-pointer select-none';

                const colorClass = isPlaceholder
                  ? 'bg-white/10 text-gray-300 cursor-not-allowed'
                  : isClaimed
                  ? (claimedByMe ? 'bg-green-600 text-white' : 'bg-red-600 text-white')
                  : (gridSelectedCardId === card?.id ? 'bg-theme-primary text-white ring-2 ring-offset-2 ring-white' : 'bg-white/5 text-white hover:bg-white/10');

                return (
                  <div
                    key={idx}
                    onClick={() => handleGridCardClick(card?.id)}
                    className={`${baseClass} ${colorClass}`}
                    title={isPlaceholder ? 'No card' : `Card ${card.serialNumber}${isClaimed ? ` - claimed${claimedByMe ? ' by you' : ''}` : ''}`}
                  >
                    {isPlaceholder ? '-' : card.serialNumber}
                  </div>
                );
              })}
            </div>

            {/* Legend & actions */}
            <div className="mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="flex items-center gap-3 text-sm">
                <div className="flex items-center gap-1">
                  <div className="w-4 h-4 bg-green-600 rounded-sm" />
                  <span>{language === 'am' ? 'የእርስዎ ተይዞ' : 'Claimed by you'}</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-4 h-4 bg-red-600 rounded-sm" />
                  <span>{language === 'am' ? 'በሌላ ተቀበለ' : 'Claimed (others)'}</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-4 h-4 bg-white/10 rounded-sm border border-white/20" />
                  <span>{language === 'am' ? 'ነጻ ካርድ' : 'Available'}</span>
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={handleChooseAndPlaceBet}
                  className="px-4 py-2 bg-theme-primary rounded shadow font-semibold"
                >
                  {t('choose_and_place_bet') || 'Choose & Place Bet'}
                </button>

                <button
                  onClick={handleEnterRoom}
                  className="px-4 py-2 bg-theme-secondary rounded shadow font-semibold"
                >
                  {t('enter_room') || 'Enter Room'}
                </button>
              </div>
            </div>

            {/* Small notes */}
            <div className="mt-3 text-xs text-gray-200">
              {t('select_card_grid_info') || 'Tap a card to select it. Choose & Place Bet will place a bet on the selected card.'}
            </div>
          </div>

        </div>
      </div>
    );
  }

  // ---------- FALLBACK: original detailed UI (unchanged) ----------
  return (
    <div className=" min-h-screen bg-gradient-to-br from-purple-800 via-purple-900 to-blue-900 flex flex-col items-center p-2 text-white">
      {/* Header Info Dashboard */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-1 mb-3 w-full text-xs">
        <button
        onClick={() => navigate("/")}
        className="flex-1 bg-gradient-to-r from-red-500 to-pink-500 py-2 rounded font-bold text-sm shadow hover:opacity-90 transition"
      >
        {t('home')}
      </button>
        <div className="bg-white/10 rounded text-center py-1 border border-white/20">
          {t('bet')}: {currentRoom.betAmount}
        </div>
       <div className="bg-white/10 rounded text-center py-1 border border-white/20">
    {t('payout')}: {
      Math.max(
        0,
        Math.floor(
          ((Object.keys(currentRoom.players || {}).length || 0)* currentRoom.betAmount * 0.9)

        )
      ) 
    }
  </div>

      
      </div>
       <div className="bg-white/10 rounded text-center py-1 border border-white/20 w-full  mb-2">
           {currentRoom?.gameStatus ?? t('waiting')}
        </div>
        

      {/* Main content row */}
      <div className="flex flex-row gap-2 w-full max-w-full h-full">
        {/* ... the rest of your original UI stays the same ... */}

        {/* Left side (Called numbers) */}
      <div className="relative w-2/5 h-full flex flex-col bg-theme-light/20 p-2 rounded border border-theme-accent/30 text-xs">
        {/* Bingo Header */}
        <div className="grid grid-cols-5 gap-1 mb-1">
          {["B", "I", "N", "G", "O"].map((letter) => (
            <div
              key={letter}
              className="w-6 h-6 flex items-center justify-center font-bold text-[10px] bg-theme-primary rounded "
            >
              {letter}
            </div>
          ))}
        </div>

      {/* Numbers Grid with countdown overlay */}
      <div className="relative flex-1">
        <div className="grid grid-cols-5 gap-1 w-full h-full">
          {[...Array(15)].map((_, rowIdx) =>
            ["B", "I", "N", "G", "O"].map((col, colIdx) => {
              const num = rowIdx + 1 + colIdx * 15;
             const lastCalled = displayedCalledNumbers[displayedCalledNumbers.length - 1];
  const previouslyCalledNumbers = lastCalled
    ? displayedCalledNumbers.slice(0, -1)
    : [];

  const isLastCalled = num === lastCalled;
  const isPreviouslyCalled = previouslyCalledNumbers.includes(num);

              return (
                <div
                  key={`${col}-${num}`}
                  className={`flex items-center justify-center p-[3px] rounded font-bold text-[11px] transition
                    ${isLastCalled
                      ? "bg-theme-primary text-white scale-105"
                      : isPreviouslyCalled
                      ? "bg-called text-white"
                      : "bg-theme-light/30"}
                  `}
                >
                  {num}
                </div>
              );
            })
          )}
        </div>

        {/* Countdown overlay ONLY on top of numbers grid */}
        {currentRoom?.gameStatus === "countdown" && currentRoom.countdownEndAt && (
          <CountdownOverlay
            countdownEndAt={currentRoom.countdownEndAt}
            label="Game starting soon"
          />
        )}
      </div>

      </div>

            {/* Right side (Your Card) */}
            <div className="w-3/5 bg-theme-light/20 p-2 rounded border border-theme-accent/30 text-xs">
              {/* Current Call */}
              <div className="relative flex flex-col items-center justify-center bg-theme-light/10 p-2 rounded border border-theme-accent/20 min-h-[100px]">
                <div className="flex items-center gap-2">
                  <div
                    className={`w-14 h-14 rounded-full flex items-center justify-center text-lg font-bold shadow bg-gradient-to-br ${
                      displayedCalledNumbers.length > 0
                        ? getPartitionColor(displayedCalledNumbers[displayedCalledNumbers.length - 1]!)
                        : "from-gray-400 to-gray-600"
                    }`}
                  >
                    {displayedCalledNumbers.length > 0
                      ? `${getBingoLetter(displayedCalledNumbers[displayedCalledNumbers.length - 1]!)}${displayedCalledNumbers[displayedCalledNumbers.length - 1]}`
                      : "-"}
                  </div>

                  {displayedCalledNumbers.length >= 3 && (
                    <div className="flex flex-row gap-1">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold shadow bg-gradient-to-br ${getPartitionColor(displayedCalledNumbers[displayedCalledNumbers.length - 2]!)}`}>
                        {getBingoLetter(displayedCalledNumbers[displayedCalledNumbers.length - 2]!)}{displayedCalledNumbers[displayedCalledNumbers.length - 2]}
                      </div>
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xxxs font-bold shadow bg-gradient-to-br ${getPartitionColor(displayedCalledNumbers[displayedCalledNumbers.length - 3]!)}`}>
                        {getBingoLetter(displayedCalledNumbers[displayedCalledNumbers.length - 3]!)}{displayedCalledNumbers[displayedCalledNumbers.length - 3]}
                      </div>
                    </div>
                  )}
                </div>

                {currentRoom?.gameStatus === "ended" && currentRoom.nextGameCountdownEndAt && (
                  <CountdownOverlay
                    countdownEndAt={currentRoom.nextGameCountdownEndAt}
                    label="Next round starting in"
                  />
                )}
              </div>


              {/* Card header */}
              <div className="flex justify-between items-center mb-1">
                <h3 className="font-bold text-sm">{t('select_card')}</h3>
                {/* Dropdown removed (grid mode above covers waiting/countdown). For non-waiting states, preserve original selection flow if needed. */}
              </div>

              {/* Bingo Header */}
              <div className="grid grid-cols-5 gap-1 mb-1">
               {["B", "I", "N", "G", "O"].map((letter, idx) => {
          const colors = [
            "bg-gradient-to-br from-theme-primary to-theme-secondary w-8 h-8 flex items-center justify-center rounded font-bold text-[11px]",
            "bg-gradient-to-br from-theme-secondary to-theme-accent w-8 h-8 flex items-center justify-center rounded font-bold text-[11px]",
            "bg-gradient-to-br from-theme-accent to-theme-light w-8 h-8 flex items-center justify-center rounded font-bold text-[11px]",
            "bg-gradient-to-br from-theme-light to-theme-primary w-8 h-8 flex items-center justify-center rounded font-bold text-[11px]",
            "bg-gradient-to-br from-theme-primary to-theme-accent w-8 h-8 flex items-center justify-center rounded font-bold text-[11px]"
          ];

          return (
            <div
              key={letter}
              className={`w-6 h-6 flex items-center justify-center font-bold text-[10px] rounded text-white shadow ${colors[idx]}`}
            >
              {letter}
            </div>
          );
        })}

              </div>

              {/* Numbers Grid */}
              <div className="grid grid-cols-5 gap-1">
                {cardNumbers.flat().map((num, idx) => {
                  const isMarked = markedNumbers.includes(num);
                  return (
                    <div
                      key={`${num}-${idx}`}
                      onClick={() => handleNumberClick(num)}
                      className={`w-8 h-8 flex items-center justify-center rounded font-bold text-[11px] cursor-pointer transition
                        ${isMarked ? "bg-theme-primary text-white scale-105" : "bg-theme-light/20 hover:bg-theme-light/30"}
                      `}
                    >
                      {num === 0 ? "★" : num}
                    </div>
                  );
                })}
              </div>

              {/* Bet button */}
             {/* Bet button logic unchanged */}
    {displayedCard ? (
      <div className="mt-6 space-y-3">
        {[( 'waiting', 'countdown')].includes(currentRoom?.gameStatus ?? '') ? (
          <button
            onClick={isBetActive ? handleCancelBet : handlePlaceBet}
            className={`w-full px-4 py-2 rounded-lg shadow font-semibold ${
              isBetActive
                ? "bg-theme-secondary hover:bg-theme-primary text-white"
                : "bg-theme-primary hover:bg-theme-secondary text-white"
            }`}
          >
            {isBetActive
              ? `${t("cancel_bet")} card:${displayedCard.serialNumber}`
              : `${t("place_bet")} card:${displayedCard.serialNumber}`}
          </button>
        ) : (
          <p className="text-gray-400 italic text-sm">
            {t("game_already_in_progress")}
          </p>
        )}

        {autoCard && isBetActive && claimed && (
      <button
        onClick={async () => {
          if (!displayedCard || !currentRoom) return;

          const cardRef = ref(
            rtdb,
            `rooms/${currentRoom.id}/bingoCards/${displayedCard.id}`
          );

          if (autoCard.auto) {
            await update(cardRef, { auto: false, autoUntil: null });
            setPopupMessage(`${t("auto_bet_dis")} ${displayedCard.serialNumber}`);
          } else {
            const expireAt = Date.now() + 24 * 60 * 60 * 1000;
            await update(cardRef, { auto: true, autoUntil: expireAt });
            setPopupMessage(`${t("auto_bet_en")} ${displayedCard.serialNumber}`);
          }
        }}
        className={`w-full px-4 py-2 rounded-lg shadow font-semibold ${
          autoCard.auto
            ? "bg-theme-accent hover:bg-theme-secondary text-white"
            : "bg-theme-secondary hover:bg-theme-primary text-white"
        }`}
      >
        {autoCard.auto
          ? `${t("remove_auto_bet")} card:${displayedCard?.serialNumber}`
          : `${t("set_auto_bet")} card:${displayedCard?.serialNumber}`}
      </button>
    )}

      </div>
    ) : (
      <p className="mt-6 text-gray-400">{t("no_card_selected")}</p>
    )}

            </div>
      </div>

     {/* Bottom buttons and footer remain unchanged (kept for brevity) */}

    </div>
  );
};

export default Room;
