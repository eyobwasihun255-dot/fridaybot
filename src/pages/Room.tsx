import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useLanguageStore } from '../store/languageStore';
import { useGameStore } from '../store/gameStore';
import { useAuthStore } from '../store/authStore';
import { getApiUrl } from '../config/api';



const Room: React.FC = () => {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const { t, language } = useLanguageStore();
  // Safely get list translations (prevents .map on string)
  const getList = (key: string): string[] => {
    const anyT = t as unknown as (k: string) => any;
    const val = anyT(key);
    return Array.isArray(val) ? (val as string[]) : [];
  };

  const {
    winnerCard, showWinnerPopup, closeWinnerPopup,
    currentRoom, bingoCards, joinRoom, selectCard,
    placeBet, selectedCard,
    showLoserPopup, setShowLoserPopup,
    connectToServer, checkBingo, setEnteredRoom, syncRoomState,
    setShowWinnerPopup
  } = useGameStore();
  const { user } = useAuthStore();

  const userCard = bingoCards.find(
    (card) => // ✅ make sure it's the same room
      card.claimed &&
      card.claimedBy === user?.telegramId
  );
  const displayedCard = selectedCard || userCard;
  const cardNumbers = userCard?.numbers ?? [];
  const [hasBet, setHasBet] = useState(false);
  const [gameMessage, setGameMessage] = useState('');
  const [timeLeft, setTimeLeft] = useState(0);
  const [markedNumbers, setMarkedNumbers] = React.useState<number[]>([]);
  const cancelBet = useGameStore((state) => state.cancelBet);
  const displayedCalledNumbers = useGameStore(
    (s) => s.displayedCalledNumbers[currentRoom?.id || ""] || []
  );
  const [hasAttemptedBingo, setHasAttemptedBingo] = useState(false);
  const [isDisqualified, setIsDisqualified] = useState(false);
  
  // Auto-close popups after 5 seconds
  useEffect(() => {
    if (showWinnerPopup) {
      const timer = setTimeout(() => {
        setShowWinnerPopup(false);
      }, 10000);
      return () => clearTimeout(timer);
    }
  }, [showWinnerPopup, setShowWinnerPopup]);
  useEffect(() => {
    if (currentRoom?.gameStatus === "countdown" && currentRoom.countdownEndAt) {
      const updateTimer = () => {
        const now = new Date().getTime();
        const endTime = new Date(currentRoom.countdownEndAt).getTime();
        const diff = Math.max(0, Math.floor((endTime - now) / 1000)); // in seconds
        setTimeLeft(diff);
      };

      updateTimer(); // initial call
      const interval = setInterval(updateTimer, 1000);

      return () => clearInterval(interval); // cleanup
    }
  }, [currentRoom?.gameStatus, currentRoom?.countdownEndAt]);
  useEffect(() => {
    if (showLoserPopup) {
      setGameMessage(t('loser_bingo'))
      const timer = setTimeout(() => {
        setShowLoserPopup(false);
      }, 10000);
      return () => clearTimeout(timer);
    }
  }, [showLoserPopup, setShowLoserPopup]);

  // Find this player's data inside the room
  const playerData = currentRoom?.players?.[user?.telegramId as string];

  // True if backend says this player already bet
  const alreadyBetted = !!playerData?.betAmount && playerData.betAmount > 0;
  // ✅ Always at top of component
  const storeIsBetActive = useGameStore((s) => s.isBetActive);

  // Flatten current card once for quick lookups
  // Flatten current card once for quick lookups (reserved for future use)
  // const flatCard = React.useMemo(() => cardNumbers.flat(), [cardNumbers]);



  const claimed = displayedCard?.claimed ?? false;
  const autoCard = displayedCard
    ? {
        auto: displayedCard.auto ?? false,
        autoUntil: displayedCard.autoUntil ?? null,
      }
    : null;

  // 👇 New useEffect inside Room.tsx
  // Connect socket once
  React.useEffect(() => {
    connectToServer();
  }, [connectToServer]);
  // Auto Bingo: checks every time called numbers update
  // Auto Bingo with visual marking

  function findCoveredPatternByMarks() {
    if (!displayedCard) return null;

    // Flatten card numbers, replace free space (if any) with 0
    const flatCard = displayedCard.numbers.flat().map((n) => n || 0);

    const markedSet = new Set(markedNumbers);

    const patterns = generatePatterns(); // array of index arrays

    for (let pIdx = 0; pIdx < patterns.length; pIdx++) {
      const indices = patterns[pIdx];

      const fullyCovered = indices.every((i) => {
        const num = flatCard[i];
        // Free space (0) is always considered marked
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

  /**
   * Verifies that every non-free-space number in the pattern was actually called.
   */
  function patternExistsInCalled(patternNumbers: number[]) {
    const calledSet = new Set(displayedCalledNumbers);
    return patternNumbers.every((n) => n === 0 || calledSet.has(n));
  }
  const formatTime = (seconds: number) => {
    const m = String(Math.floor(seconds / 60)).padStart(2, "0");
    const s = String(seconds % 60).padStart(2, "0");
    return `${m}:${s}`;
  };





  // Combine with local state for smoother UX
  const isBetActive = hasBet || alreadyBetted || storeIsBetActive;

  // Inside Room.tsx

  const alreadyAttempted = playerData?.attemptedBingo ?? false;
  React.useEffect(() => {
    setHasAttemptedBingo(alreadyAttempted);
  }, [alreadyAttempted]);



  // ✅ Reset right card marks when countdown ends and game starts
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

    const timer = setTimeout(() => setGameMessage(''), 3000); // hide after 3s
    return () => clearTimeout(timer);
  }, [gameMessage]);


  const [popupMessage, setPopupMessage] = useState<string | null>(null);
  React.useEffect(() => {
    if (!popupMessage) return;

    const timer = setTimeout(() => setPopupMessage(null), 3000); // hide after 3s
    return () => clearTimeout(timer);
  }, [popupMessage]);

  // Start countdown if 2+ players bet
  React.useEffect(() => {
    if (!currentRoom || !currentRoom.players) return; // ✅ guard against null
    // kept for potential future UI that depends on activePlayers
  }, [currentRoom]);
  // At the top inside Room.tsx

  // Inside Room.tsx, after your other useEffects
  React.useEffect(() => {
    if (!currentRoom || !user) return;

    const displayedCard = bingoCards.find(
      (card) =>
        card.roomId === currentRoom.id &&
        card.claimed &&
        card.claimedBy === user.telegramId
    ) || selectedCard;

    if (!displayedCard) return;

    // If the card is claimed but user balance < room bet amount → cancel bet
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
      // If balance is enough and card is claimed, mark bet as active
      const playerData = currentRoom.players?.[user.telegramId];
      if (playerData?.betAmount && playerData.betAmount > 0) {
        setHasBet(true);
      }
    }
  }, [currentRoom, user, bingoCards, selectedCard]);




  const handlePlaceBet = async () => {
    if (!displayedCard || !currentRoom) return;

    if (!currentRoom.isDemoRoom && (user?.balance || 0) < currentRoom.betAmount) {
      setGameMessage(t('insufficient_balance'));
      return;
    }

    const success = await placeBet();

      if (success) {
        setHasBet(true); // ✅ mark bet placed
        setGameMessage(t('bet_placed'));
      }
  };
  

  // Auto Bingo is now handled server-side

  const getPartitionColor = (num: number) => {
    if (num >= 1 && num <= 15) return "from-blue-400 to-blue-600";
    if (num >= 16 && num <= 30) return "from-green-400 to-green-600";
    if (num >= 31 && num <= 45) return "from-yellow-400 to-yellow-600";
    if (num >= 46 && num <= 60) return "from-orange-400 to-orange-600";
    if (num >= 61 && num <= 75) return "from-red-400 to-red-600";
    return "from-gray-400 to-gray-600"; // fallback
  };
  // --- Add state at the top inside Room component ---
  const [showPatterns, setShowPatterns] = useState(false);

  // Utility to pick patterns (you already have this function)
  function generatePatterns() {
    const size = 5;
    const indices: number[][] = [];

    // Rows
    for (let r = 0; r < size; r++) indices.push([...Array(size)].map((_, c) => r * size + c));

    // Columns
    for (let c = 0; c < size; c++) indices.push([...Array(size)].map((_, r) => r * size + c));

    // Diagonals
    indices.push([...Array(size)].map((_, i) => i * size + i));
    indices.push([...Array(size)].map((_, i) => i * size + (size - 1 - i)));



    // Small X
    indices.push([12, 6, 8, 16, 18]); // center + four diagonals near center

    // Four corners
    indices.push([0, 4, 20, 24]);

    return indices;
  }


  const handleCancelBet = async () => {
    const cardId = userCard?.id || selectedCard?.id;
    if (!cardId) return;

    const success = await cancelBet(cardId);
    if (success) {
      setHasBet(false);
      setEnteredRoom(false);
      setGameMessage('Bet canceled');
    } else {
      console.error("❌ Failed to cancel bet");
    }
  };

  const handleToggleAuto = async () => {
    if (!displayedCard || !currentRoom || !autoCard) return;
    try {
      const response = await fetch(getApiUrl('/api/toggle-auto'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          roomId: currentRoom.id,
          cardId: displayedCard.id,
          auto: !autoCard.auto,
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        setPopupMessage(result.message || t('error'));
        return;
      }
      await syncRoomState(currentRoom.id);
      setPopupMessage(
        `${autoCard.auto ? t('auto_bet_dis') : t('auto_bet_en')} ${displayedCard.serialNumber}`
      );
    } catch (err) {
      console.error('❌ Failed to toggle auto bet', err);
      setPopupMessage(t('error'));
    }
  };


  const handleNumberClick = (num: number) => {
    setMarkedNumbers((prev) =>
      prev.includes(num) ? prev.filter((n) => n !== num) : [...prev, num]
    );
  };
  // Check if a card has bingo

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
  const CardSelectionGrid = () => {

    const handleSelectCard = (cardId: string) => {
      if (!bingoCards.find((c) => c.id === cardId)?.claimed) {
        selectCard(cardId);
      }
    };
  
    const myClaimedCard = bingoCards.find(
      (c) => c.claimedBy === user?.telegramId
    );
  
    const displayedCard =
      bingoCards.find((c) => c.id === selectedCard?.id) || myClaimedCard;
  
    const sortedCards = [...bingoCards].sort(
      (a, b) => (a.serialNumber ?? 0) - (b.serialNumber ?? 0)
    );
  
    return (
      <div className="flex flex-col items-center min-h-screen text-white p-4">
        {/* 🏠 Home Button */}
        <button
          onClick={() => navigate("/")}
          className="fixed top-3 left-3 bg-gradient-to-r from-red-500 to-pink-500 px-4 py-2 rounded font-bold text-sm shadow hover:opacity-90 transition z-50"
        >
          {t("home")}
        </button>
  
        {/* 🕒 Time Remaining */}
        {currentRoom?.gameStatus === "countdown" && (
          <div className="mt-10 mb-4 text-center">
            <h2 className="text-2xl font-bold mb-1">{t("select_card")}</h2>
            <p className="text-sm text-theme-accent font-semibold">
              {formatTime(timeLeft)} {t("seconds")}
            </p>
          </div>
        )}
  
        {/* 🎴 Scrollable Grid of Cards */}
        <div className="w-full max-w-3xl overflow-y-auto max-h-[50vh] mb-6 rounded-lg border border-white/10 p-3 bg-black/20">
          <div className="grid grid-cols-10 gap-2 justify-items-center">
            {sortedCards.slice(0, 300).map((card) => {
              const isClaimed = card.claimed;
              const isMine = card.claimedBy === user?.telegramId;
              const isSelected = selectedCard?.id === card.id;
              const isHighlighted = isMine || isSelected;
  
              let colorClass = "";
              if (isHighlighted) {
                colorClass =
                  "bg-gradient-to-br from-theme-green to-emerald-600 text-white shadow-md border border-green-700";
              } else if (isClaimed) {
                colorClass =
                  "bg-gradient-to-br from-theme-red to-rose-700 text-white border border-red-700 shadow-sm";
              } else {
                colorClass =
                  "bg-gradient-to-br from-theme-light to-white text-gray-800 border border-gray-300 hover:from-theme-accent hover:to-theme-secondary hover:text-white transition";
              }
  
              return (
                <div
                  key={card.id}
                  onClick={() => {
                    if (!card.claimed) handleSelectCard(card.id);
                  }}
                  className={`w-8 h-8 flex items-center justify-center rounded-lg font-bold cursor-pointer transition-transform duration-150 transform hover:scale-105 text-xs ${colorClass}`}
                >
                  {card.serialNumber}
                </div>
              );
            })}
          </div>
        </div>
  
        {/* 🟩 Selected Card Preview (shown below grid) */}
        {displayedCard && (
  <div className="mb-6 p-3 bg-white/10 rounded-lg shadow-inner flex flex-col items-center w-full max-w-[180px]">
    <div className="text-xs mb-2 font-semibold text-theme-light">
      {t("selected_card")} #{displayedCard.serialNumber}
    </div>

    {/* B I N G O header letters */}
    <div className="grid grid-cols-5 gap-1 mb-1">
      {["B", "I", "N", "G", "O"].map(letter => (
        <div key={letter} className="text-xs font-bold text-white text-center">
          {letter}
        </div>
      ))}
    </div>

    {/* Bingo numbers displayed vertically */}
    <div className="grid grid-cols-5 gap-0.5">
      {Array.from({ length: 5 }).map((_, colIdx) => (
        <div key={colIdx} className="flex flex-col gap-0.5">
          {Array.from({ length: 5 }).map((_, rowIdx) => {
            const num = displayedCard.numbers[rowIdx][colIdx]; // <-- TRANSPOSED ACCESS

            return (
              <div
                key={`${rowIdx}-${colIdx}`}
                className="w-5 h-5 flex items-center justify-center text-[10px] rounded bg-theme-primary text-white font-bold border border-white/20"
              >
                {num === 0 && rowIdx === 2 && colIdx === 2 ? "★" : num}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  </div>
)}

  
        {/* 🎯 Place Bet Button */}
        <div className="flex flex-col sm:flex-row gap-3 w-full max-w-xs">
          <button
            onClick={isBetActive ? handleCancelBet : handlePlaceBet}
            className="w-full px-4 py-2 rounded-lg shadow font-semibold transition bg-gradient-to-r from-theme-primary to-theme-green hover:opacity-90 text-white"
          >
            {t("place_bet")} card:{displayedCard?.serialNumber ?? 0}
          </button>
        </div>
      </div>
    );
  };
  
  
  
  
  
  if (["waiting", "countdown"].includes(currentRoom?.gameStatus) && !userCard) {
    return <CardSelectionGrid />;
  }
  
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
      setGameMessage(t('not_a_winner'));
      setIsDisqualified(true);
      return;
    }

    try {
      const result = await checkBingo(covered.patternIndices);
      if (!result.success) {
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


  



  return (
    <div className=" min-h-screen bg-gradient-to-br from-purple-800 via-purple-900 to-blue-900 flex flex-col items-center p-2 text-white">
      {/* Header Info Dashboard */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-1 mb-3 w-full text-xs">
      <button
  onClick={() => navigate("/")}
  className="fixed top-3 left-3 bg-gradient-to-r from-red-500 to-pink-500 px-4 py-2 rounded font-bold text-sm shadow hover:opacity-90 transition z-50"
>
  {t('home')}
</button>
{/* Refresh button — place next to your Home button */}
<button
  onClick={() => window.location.reload()}
  className="bg-gradient-to-r from-indigo-500 to-blue-500 px-4 py-2 rounded font-bold text-sm shadow "
>
  {t('refresh') ?? 'Refresh'}
</button>

        <div className="bg-white/10 rounded text-center py-1 border border-white/20">
          {t('bet')}: {currentRoom.betAmount}
        </div>
        <div className="bg-white/10 rounded text-center py-1 border border-white/20">
        {t('payout')}: {
  Math.max(
    0,
    ((Object.keys(currentRoom.players || {}).length || 0) * currentRoom.betAmount * 0.85)
  )
}

        </div>


      </div>
      <div className="bg-white/10 rounded text-center py-1 border border-white/20 w-full  mb-2">
        {currentRoom?.gameStatus ?? t('waiting')}
      </div>


      {/* Main content row */}
      <div className="flex flex-row gap-2 w-full max-w-full h-full">
        {/* Loser sees winner's card pattern */}
        {showLoserPopup && winnerCard && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
            <div className="bg-white rounded-2xl shadow-2xl p-6 w-96 max-w-full text-center">
              <h2 className="text-2xl font-bold mb-3 text-theme-primary">{t('winner_pattern')}</h2>
              <p className="mb-2 text-lg">{t('you_lost')}</p>

              {/* Show winner's card number */}
              <p className="mb-4 text-sm text-gray-600">
                {t('card_number')}: {winnerCard.serialNumber}
                <p></p>
                {t('winner')}: {currentRoom?.players?.[winnerCard.claimedBy as string]?.username}

              </p>

              {/* Display winner card in proper 5x5 grid */}
              {/* Winner Card Display */}
              <div className="mb-4 animate-scale-in">
                {/* Column headers */}
                <div className="grid grid-cols-5 gap-1 mb-2">
                  {['B', 'I', 'N', 'G', 'O'].map((letter) => (
                    <div
                      key={letter}
                      className="w-10 h-10 flex items-center justify-center rounded-lg font-extrabold text-sm 
                      bg-gradient-to-br from-theme-primary to-theme-secondary text-white shadow-md"
                    >
                      {letter}
                    </div>
                  ))}
                </div>

                {/* Card numbers */}
                <div className="p-2 rounded-xl bg-gradient-to-br from-theme-light to-white shadow-lg border border-theme-accent">
                  {winnerCard.numbers.map((row: number[], rowIdx: number) => (
                    <div key={rowIdx} className="grid grid-cols-5 gap-1 mb-1">
                      {row.map((num: number, colIdx: number) => {
                        const flatIdx = rowIdx * 5 + colIdx;
                        const isInWinningPattern =
                          winnerCard.winningPatternIndices?.includes(flatIdx) || false;

                        const displayNum =
                          num === 0 && rowIdx === 2 && colIdx === 2 ? "★" : num;

                        return (
                          <div
                            key={`${rowIdx}-${colIdx}`}
                            className={`text-sm font-bold w-10 h-10 flex items-center justify-center rounded-lg border transition-all duration-200
                              ${
                                isInWinningPattern
                                  ? 'bg-gradient-to-br from-theme-green to-emerald-600 text-white border-green-700 shadow-md scale-105'
                                  : 'bg-white text-gray-800 border-gray-300 hover:bg-theme-light hover:text-theme-primary'
                              }`}
                          >
                            {displayNum}
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>

              <button
                onClick={() => setShowLoserPopup(false)}
                className="mt-2 px-5 py-2 bg-red-600 text-white rounded-lg shadow hover:bg-red-700"
              >
                {t('close')}
              </button>
            </div>
          </div>
        )}

        {popupMessage && (
          <div className="fixed top-4 right-4 bg-black/80 text-white px-4 py-2 rounded-lg shadow-lg z-50 animate-fade-in-out">
            {popupMessage}
          </div>
        )}





        {showWinnerPopup && winnerCard && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
            <div className="relative bg-gradient-to-br from-theme-primary via-theme-secondary to-theme-accent rounded-3xl shadow-2xl p-8 w-96 max-w-full text-center overflow-hidden animate-scale-in">

              {/* Confetti */}
              {[...Array(25)].map((_, i) => (
                <div
                  key={i}
                  className="absolute text-lg animate-fall"
                  style={{
                    top: `${Math.random() * 100}%`,
                    left: `${Math.random() * 100}%`,
                    animationDelay: `${Math.random() * 2}s`,
                  }}
                >
                  🎉
                </div>
              ))}

              {/* Bingo balls */}

              {/* Trumpets */}
              <div className="absolute -top-6 -left-10 text-5xl animate-wiggle">🎺</div>
              <div className="absolute -top-6 -right-10 text-5xl animate-wiggle">🎺</div>

              {/* Close button */}
              <button
                onClick={closeWinnerPopup}
                className="absolute top-2 right-2 text-white hover:text-gray-200"
              >
                ✕
              </button>

              {/* BINGO text */}
              <h2 className="text-5xl font-extrabold tracking-wide text-yellow-300 drop-shadow-lg animate-bounce">
                {t('bingo')}!
              </h2>

              <p className="mb-4 text-lg text-white font-semibold">
                {t('card')} #{winnerCard.serialNumber}  {t('winner')} 🎉
              </p>

              {/* Close button big */}
              <button
                onClick={closeWinnerPopup}
                className="mt-2 px-5 py-3 bg-gradient-to-r from-green-500 to-blue-600 text-white rounded-xl shadow-lg hover:scale-105 transform transition"
              >
                Close
              </button>
            </div>
          </div>
        )}


        {/* Game Message Popup */}
        {gameMessage && (
          <div className="fixed bottom-4 left-1/2 transform -translate-x-1/2 bg-black/80 text-white px-4 py-2 rounded-lg shadow-lg z-50 animate-fade-in-out">
            {gameMessage}
          </div>
        )}

        {showPatterns && (
          <div className="absolute top-0 left-0 w-full h-full bg-black/70 flex items-center justify-center z-50">
            <div className="bg-white text-black rounded-2xl shadow-xl p-4 w-[95%] max-w-4xl max-h-[85vh] overflow-y-auto">
              <div className="flex justify-between items-center mb-3">
                <h2 className="text-lg font-bold">🎯 Bingo Winning Patterns</h2>
                <button
                  onClick={() => setShowPatterns(false)}
                  className="px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600"
                >
                  Close
                </button>
              </div>

              {/* Demo 5x5 card */}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {generatePatterns().map((pattern, idx) => (
                  <div key={idx} className="p-2 border rounded-lg shadow">
                    <h3 className="text-sm font-bold mb-2">Pattern {idx + 1}</h3>
                    <div className="grid grid-cols-5 gap-1">
                      {Array.from({ length: 25 }, (_, i) => {
                        const num = i + 1;
                        const isHighlighted = pattern.includes(i);
                        return (
                          <div
                            key={i}
                            className={`w-6 h-6 flex items-center justify-center rounded text-[10px] font-bold
                      ${isHighlighted ? "bg-green-500 text-white" : "bg-gray-200 text-black"}
                    `}
                          >
                            {num === 13 ? "★" : num}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}


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
                          ? "bg-theme-green text-white scale-105"
                          : isPreviouslyCalled
                            ? "bg-theme-red text-white"
                            : "bg-theme-primary"}
            `}
                    >
                      {num}
                    </div>
                  );
                })
              )}
            </div>

            {/* Countdown overlay ONLY on top of numbers grid */}
            {currentRoom?.gameStatus === "countdown" && currentRoom.countdownEndAt && timeLeft > 0 &&(
               <div className="absolute inset-0 bg-black/70 flex items-center justify-center rounded">
               <div
                 className={`bg-white text-black text-center shadow-xl flex flex-col items-center justify-center
                 
                w-4/5 h-2/5 rounded-xl p-2    
               `}
               >
                 <h2 className={`font-bold mb-2 text-l`}>
                   {t('time_left')}
                 </h2>
                 <p className={`text-l font-mono`}>
                   {formatTime(timeLeft)} {t('seconds')}
                 </p>
               </div>
             </div>
              
            )}
          </div>

        </div>

        {/* Right side (Your Card) */}
        <div className="w-3/5 bg-theme-light/20 p-2 rounded border border-theme-accent/30 text-xs">
          {/* Current Call */}
          <div className="relative flex flex-col items-center justify-center bg-theme-light/10 p-2 rounded border border-theme-accent/20 min-h-[100px]">

            {/* Numbers display container */}
            <div className="flex items-center gap-2">


              {/* Current number - main circle */}
              <div
                className={`w-14 h-14 rounded-full flex items-center justify-center text-lg font-bold shadow bg-gradient-to-br border-4 border-yellow-300 ${displayedCalledNumbers.length > 0
                    ? getPartitionColor(displayedCalledNumbers[displayedCalledNumbers.length - 1]!)
                    : "from-gray-400 to-gray-600"
                  }`}
              >
                {displayedCalledNumbers.length > 0
                  ? `${getBingoLetter(displayedCalledNumbers[displayedCalledNumbers.length - 1]!)}${displayedCalledNumbers[displayedCalledNumbers.length - 1]}`
                  : "-"}
              </div>

              {/* Previous two numbers */}
              {displayedCalledNumbers.length >= 3 && (
                <div className="flex flex-row gap-1">
                  {/* Second previous number */}
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold shadow bg-gradient-to-br ${getPartitionColor(displayedCalledNumbers[displayedCalledNumbers.length - 2]!)}`}>
                    {getBingoLetter(displayedCalledNumbers[displayedCalledNumbers.length - 2]!)}{displayedCalledNumbers[displayedCalledNumbers.length - 2]}
                  </div>
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xxxs font-bold shadow bg-gradient-to-br ${getPartitionColor(displayedCalledNumbers[displayedCalledNumbers.length - 3]!)}`}>
                    {getBingoLetter(displayedCalledNumbers[displayedCalledNumbers.length - 3]!)}{displayedCalledNumbers[displayedCalledNumbers.length - 3]}
                  </div>
                  {/* First previous number */}

                </div>
              )}
            </div>






          </div>



          
          {/* Bingo Header */}
          <div className="grid grid-cols-5 gap-1 mb-1">
            {["B", "I", "N", "G", "O"].map((letter, idx) => {
              const colors = [
                "bg-gradient-to-br from-theme-primary to-theme-secondary w-8 h-8 flex items-center justify-center rounded font-bold text-[11px]",   // B
                "bg-gradient-to-br from-theme-secondary to-theme-accent w-8 h-8 flex items-center justify-center rounded font-bold text-[11px]", // I
                "bg-gradient-to-br from-theme-accent to-theme-light w-8 h-8 flex items-center justify-center rounded font-bold text-[11px]", // N
                "bg-gradient-to-br from-theme-light to-theme-primary w-8 h-8 flex items-center justify-center rounded font-bold text-[11px]",  // G
                "bg-gradient-to-br from-theme-primary to-theme-accent w-8 h-8 flex items-center justify-center rounded font-bold text-[11px]" // O
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
          {/* Bet button */}
          {displayedCard ? (
            <div className="mt-6 space-y-3">
              {/* Main Bet Button */}

              {userCard && currentRoom?.gameStatus !== "playing" && (
                <button
                onClick={isBetActive ? handleCancelBet : handlePlaceBet}
                className={`w-full px-4 py-2 rounded-lg shadow font-semibold transition ${
                  isBetActive
                    ? "bg-gradient-to-r from-theme-secondary to-theme-red hover:opacity-90 text-white"
                    : "bg-gradient-to-r from-theme-primary to-theme-green hover:opacity-90 text-white"
                }`}
              >
                {isBetActive
                  &&`${t("cancel_bet")} card:${displayedCard?.serialNumber ?? 0}`
                  }
              </button>
              )}
              

              {/* Auto Bet Toggle Button → only visible if bet is active */}
              {autoCard && isBetActive && claimed && (
                <button
                  onClick={handleToggleAuto}
                  className={`w-full px-4 py-2 rounded-lg shadow font-semibold ${autoCard.auto
                      ? "bg-theme-red hover:bg-theme-secondary text-white"
                      : "bg-theme-green hover:bg-theme-primary text-white"
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

      {/* Bottom buttons */}
      {/* Bottom buttons */}
      <div className="flex flex-col gap-2 mt-3 w-full">
        {/* Row with Bingo + Home */}
        {/* Info Board during Countdown */}
        {currentRoom?.gameStatus === "countdown" && (
          <div className="w-full bg-yellow-400/80 text-black rounded-lg p-3 mb-2 shadow text-sm">
            <h3 className="font-bold mb-1">📜 {language === "am" ? "የቢንጎ ደንቦች" : "Bingo Rules & Info"}</h3>
            <ul className="list-disc list-inside space-y-1">
              {getList("bingo_rules_countdown").map((rule: string, i: number) => (
                <li key={i}>{rule}</li>
              ))}
            </ul>
          </div>
        )}
        {currentRoom?.gameStatus === "waiting" && (
          <div className="w-full bg-yellow-400/80 text-black rounded-lg p-3 mb-2 shadow text-sm">
            <h3 className="font-bold mb-1">📜 {language === "am" ? "የቢንጎ ደንቦች" : "Bingo Rules & Info"}</h3>
            <ul className="list-disc list-inside space-y-1">
              {getList("bingo_rules_countdown").map((rule: string, i: number) => (
                <li key={i}>{rule}</li>
              ))}
            </ul>
          </div>
        )}

        {currentRoom?.gameStatus === "ended" && (
          <div className="w-full bg-yellow-400/80 text-black rounded-lg p-3 mb-2 shadow text-sm">
            <h3 className="font-bold mb-1">📜 {language === "am" ? "የቢንጎ ደንቦች" : "Bingo Rules & Info"}</h3>
            <ul className="list-disc list-inside space-y-1">
              {getList("bingo_rules_ended").map((rule: string, i: number) => (
                <li key={i}>{rule}</li>
              ))}
            </ul>
          </div>
        )}


        <div className="flex flex-row gap-2">
          <button
            onClick={handleBingoClick}
            className={`flex-1 py-2 rounded font-bold text-sm shadow transition bg-gradient-to-r from-orange-500 to-yellow-500 hover:opacity-90
    ${hasAttemptedBingo || isDisqualified ? "opacity-50 cursor-not-allowed" : ""}
  `}
            disabled={hasAttemptedBingo || isDisqualified}
          >
            {t('bingo')}
          </button>
        </div>

        {/* Row with Bingo Laws */}
        <button
          onClick={() => setShowPatterns(true)}
          className="w-full bg-gradient-to-r from-theme-primary to-theme-secondary py-2 rounded-lg font-bold text-sm shadow hover:opacity-90 transition"
        >
          {t('pattern')}
        </button>
      </div>


      {/* Footer: Betted Players */}
      <div className="w-full mt-6 bg-theme-light/10 rounded border border-theme-accent/30 p-3">
        <h3 className="font-bold text-sm mb-2">{t("players_in_room")}</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
          {currentRoom?.players && Object.keys(currentRoom.players || {}).length > 0 ? (
            Object.values(currentRoom.players || {}).map((player: any) => {
              const maskedUsername = player.username
                ? `${player.username.slice(0, 7)}***`
                : `user_${player.telegramId?.slice(0, 3) ?? '???'}***`;

              // ✅ Determine background color
              let bgColor = "bg-theme-light/20"; // default
              if ((currentRoom as any).winners?.some((w: any) => w.telegramId === player.telegramId)) {
                bgColor = "bg-theme-primary"; // winner
              } else if (player.attemptedBingo) {
                bgColor = "bg-theme-secondary"; // attempted bingo
              }

              return (
                <div
                  key={player.id}
                  className={`${bgColor} rounded p-2 flex flex-col items-center text-center transition`}
                >
                  <span className="font-semibold">{maskedUsername}</span>
                  <span className="text-xs">Bet: {player.betAmount}</span>
                </div>
              );
            })
          ) : (
            <div className="col-span-full text-center text-gray-300">
              No players have bet yet...
            </div>
          )}
        </div>

      </div>




    </div>
  );
  

};


export default Room;