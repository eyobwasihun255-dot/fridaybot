
import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useLanguageStore } from '../store/languageStore';
import { useGameStore } from '../store/gameStore';
import { useAuthStore } from '../store/authStore';
import { rtdb } from '../firebase/config';
import { ref, runTransaction, update, get, onValue } from 'firebase/database';

const CountdownOverlay = ({
  countdownEndAt,
  label,
}: {
  countdownEndAt: number;
  label: string;
}) => {
  const [remaining, setRemaining] = React.useState(
    Math.max(0, Math.floor((countdownEndAt - Date.now()) / 1000))
  );

  React.useEffect(() => {
    const interval = setInterval(() => {
      setRemaining(
        Math.max(0, Math.floor((countdownEndAt - Date.now()) / 1000))
      );
    }, 1000);
    return () => clearInterval(interval);
  }, [countdownEndAt]);

  if (remaining <= 0) return null;

  const isNextRound = label === "Next round starting in";

  // Format seconds into mm:ss
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
  const { t, language } = useLanguageStore();
   
  const {
    winnerCard, showWinnerPopup, closeWinnerPopup,
    currentRoom, bingoCards, joinRoom, selectCard,
    placeBet, selectedCard, showLoserPopup, setShowLoserPopup,
    connectToServer, checkBingo
  } = useGameStore();
  const { user, updateBalance } = useAuthStore();

  const userCard = bingoCards.find(
    (card) =>
      card.roomId === currentRoom?.id &&
      card.claimed &&
      card.claimedBy === user?.telegramId
  );

  const [remaining, setRemaining] = useState<number | null>(null);
  const displayedCard = userCard || selectedCard;
  const cardNumbers = displayedCard?.numbers ?? [];
  const [hasBet, setHasBet] = useState(false);
  const [gameMessage, setGameMessage] = useState('');
  const [markedNumbers, setMarkedNumbers] = React.useState<number[]>([]);
  const cancelBet = useGameStore((state) => state.cancelBet);
  const displayedCalledNumbers = useGameStore(
    (s) => s.displayedCalledNumbers[currentRoom?.id ?? ""] || []
  );
  const [hasAttemptedBingo, setHasAttemptedBingo] = useState(false);
  const [isDisqualified, setIsDisqualified] = useState(false);

  // Find this player's data inside the room
  const playerData = currentRoom?.players?.[user?.telegramId];

  // True if backend says this player already bet
  const alreadyBetted = !!playerData?.betAmount && playerData.betAmount > 0;

  // Always at top of component
  const storeIsBetActive = useGameStore((s) => s.isBetActive);

  // Flatten current card once for quick lookups
  const flatCard = React.useMemo(() => cardNumbers.flat(), [cardNumbers]);
  const [loserPopup, setLoserPopup] = useState<{ visible: boolean; message: string }>({
    visible: false,
    message: ''
  });

  function checkIfLoser(currentRoom: any, t: (key: string) => string) {
    const { user } = useAuthStore.getState();
    if (!currentRoom || !user) return;

    const winners = currentRoom.winners || [];
    const isWinner = winners.some((w: any) => w.telegramId === user.telegramId);

    if (!isWinner && currentRoom.paid) {
      setLoserPopup({ visible: true, message: t('you_lost') });
    }
  }

  const [claimed, setClaimed] = useState(false);

  // Connect to server on component mount
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

  // Client-side pattern detection for UI feedback only
  // Server validates actual bingo claims
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

  // Find if player is in winners list
  const isInWinnerList = currentRoom?.winners?.some(
    (w: any) => w.cardId === displayedCard?.id && !w.checked
  ) ?? false;

  // Reuse your existing covered pattern logic
  const coveredPattern = findCoveredPatternByMarks();
  const patternValidAgainstCalled = coveredPattern
    ? patternExistsInCalled(coveredPattern.patternNumbers)
    : false;

  // Combine with local state for smoother UX
  const isBetActive = hasBet || alreadyBetted || storeIsBetActive;

  const alreadyAttempted = playerData?.attemptedBingo ?? false;
  React.useEffect(() => {
    setHasAttemptedBingo(alreadyAttempted);
    checkIfLoser(currentRoom, t);
  }, [alreadyAttempted]);

  // Reset card marks when countdown ends and game starts
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

  React.useEffect(() => {
    if (!selectedCard) return;

    // find the updated version of this card in bingoCards
    const updatedCard = bingoCards.find((c) => c.id === selectedCard.id);

    if (!updatedCard) return;

    // If my card is still available OR claimed by me → keep it
    if (!updatedCard.claimed || updatedCard.claimedBy === user?.telegramId) {
      return;
    }

    // If my card was claimed by another player → clear/reset selection
    selectCard("");
  }, [bingoCards, selectedCard, user?.telegramId, selectCard]);

  const [popupMessage, setPopupMessage] = useState<string | null>(null);
  React.useEffect(() => {
    if (!popupMessage) return;

    const timer = setTimeout(() => setPopupMessage(null), 3000); // hide after 3s
    return () => clearTimeout(timer);
  }, [popupMessage]);

  // At the top inside Room.tsx
  const [loserWinnerCard, setLoserWinnerCard] = useState<any | null>(null);
  const [showLoserWinnerPopup, setShowLoserWinnerPopup] = useState(false);

  React.useEffect(() => {
    if (!currentRoom || !user) return;

    const gameRef = ref(rtdb, `games/${currentRoom.id}`);
    
    const unsubscribe = onValue(gameRef, async (snapshot) => {
      const gameData = snapshot.val();
      if (!gameData) return;

      const { winner, winners } = gameData;
      if (!winner || !winners) return;

      const isPaid = currentRoom.payed ?? false;

      // Only proceed if user is NOT the winner and game is paid
      if (isPaid && winner.winnerId !== user.telegramId) {
        try {
          // Find the winner object to get cardId
          const winnerObj = winners.find((w: any) => w.userId === winner.winnerId);
          if (!winnerObj) return;

          // Fetch winner card data
          const cardSnap = await get(ref(rtdb, `rooms/${currentRoom.id}/bingoCards/${winnerObj.cardId}`));
          const cardData = cardSnap.val();
          if (!cardData) return;

          // Highlight winning numbers
          const highlightedNumbers = cardData.numbers.map(
            (num: number, idx: number) => winner.winningPattern.includes(idx) ? num : 0
          );

          setLoserWinnerCard({ ...cardData, numbers: highlightedNumbers });
          setShowLoserWinnerPopup(true);
        } catch (err) {
          console.error("Failed to fetch winner card for loser popup:", err);
        }
      }
    });

    return () => unsubscribe();
  }, [currentRoom?.id, user?.telegramId]);

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
      setHasBet(true); // mark bet placed
      if (!currentRoom.isDemoRoom) {
        await updateBalance(-currentRoom.betAmount);
      }
      setGameMessage(t('bet_placed'));
    }
  };

  const getPartitionColor = (num: number) => {
    if (num >= 1 && num <= 15) return "from-blue-400 to-blue-600";
    if (num >= 16 && num <= 30) return "from-green-400 to-green-600";
    if (num >= 31 && num <= 45) return "from-yellow-400 to-yellow-600";
    if (num >= 46 && num <= 60) return "from-orange-400 to-orange-600";
    if (num >= 61 && num <= 75) return "from-red-400 to-red-600";
    return "from-gray-400 to-gray-600"; // fallback
  };

  // Add state at the top inside Room component
  const [showPatterns, setShowPatterns] = useState(false);

  // Utility to pick patterns
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
      setGameMessage('Bet canceled');
    }
  };

  // Server-side bingo check
  const handleBingo = async () => {
    if (!coveredPattern || !patternValidAgainstCalled || hasAttemptedBingo) {
      return;
    }

    try {
      setHasAttemptedBingo(true);
      const result = await checkBingo(coveredPattern.patternIndices);
      
      if (result.success) {
        setGameMessage('🏆 BINGO! You won!');
      } else {
        setGameMessage(`❌ ${result.message}`);
        setIsDisqualified(true);
      }
    } catch (error) {
      console.error('Error checking bingo:', error);
      setGameMessage('❌ Error checking bingo');
      setHasAttemptedBingo(false); // Allow retry on network error
    }
  };

  const toggleNumberMark = (number: number) => {
    if (currentRoom?.gameStatus !== "playing") return;

    setMarkedNumbers(prev => {
      if (prev.includes(number)) {
        return prev.filter(n => n !== number);
      } else {
        return [...prev, number];
      }
    });
  };

  const isNumberCalled = (number: number) => {
    return displayedCalledNumbers.includes(number);
  };

  const isNumberMarked = (number: number) => {
    return markedNumbers.includes(number);
  };

  if (!currentRoom) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900 flex items-center justify-center">
        <div className="text-white text-xl">Loading room...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900 p-4">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="bg-white/10 backdrop-blur-md rounded-xl p-6 mb-6">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-3xl font-bold text-white mb-2">{currentRoom.name}</h1>
              <div className="flex gap-4 text-sm text-white/80">
                <span>Bet: ${currentRoom.betAmount}</span>
                <span>Players: {Object.keys(currentRoom.players || {}).length}/{currentRoom.maxPlayers}</span>
                <span className={`px-2 py-1 rounded ${
                  currentRoom.gameStatus === 'playing' ? 'bg-green-500' :
                  currentRoom.gameStatus === 'countdown' ? 'bg-yellow-500' :
                  currentRoom.gameStatus === 'ended' ? 'bg-red-500' : 'bg-gray-500'
                }`}>
                  {currentRoom.gameStatus.toUpperCase()}
                </span>
              </div>
            </div>
            <button
              onClick={() => navigate('/')}
              className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg transition-colors"
            >
              Leave Room
            </button>
          </div>
        </div>

        {/* Game Message */}
        {gameMessage && (
          <div className="bg-blue-500/20 border border-blue-500 text-white p-4 rounded-lg mb-6 text-center">
            {gameMessage}
          </div>
        )}

        {/* Main Game Area */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Bingo Card */}
          <div className="lg:col-span-2">
            <div className="bg-white/10 backdrop-blur-md rounded-xl p-6 relative">
              {/* Countdown Overlays */}
              {currentRoom.gameStatus === "countdown" && currentRoom.countdownEndAt && (
                <CountdownOverlay
                  countdownEndAt={currentRoom.countdownEndAt}
                  label="Game starting in"
                />
              )}
              
              {currentRoom.gameStatus === "ended" && currentRoom.nextGameCountdownEndAt && (
                <CountdownOverlay
                  countdownEndAt={currentRoom.nextGameCountdownEndAt}
                  label="Next round starting in"
                />
              )}

              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-bold text-white">Your Bingo Card</h2>
                {displayedCard && (
                  <span className="text-white/80">Card #{displayedCard.serialNumber}</span>
                )}
              </div>

              {displayedCard ? (
                <div className="space-y-4">
                  {/* BINGO Header */}
                  <div className="grid grid-cols-5 gap-2 mb-2">
                    {['B', 'I', 'N', 'G', 'O'].map((letter, index) => (
                      <div key={letter} className="text-center text-2xl font-bold text-white py-2">
                        {letter}
                      </div>
                    ))}
                  </div>

                  {/* Bingo Grid */}
                  <div className="grid grid-cols-5 gap-2">
                    {displayedCard.numbers.flat().map((number, index) => {
                      const isCalled = isNumberCalled(number);
                      const isMarked = isNumberMarked(number);
                      const isFreeSpace = index === 12 && number === 0;
                      
                      return (
                        <button
                          key={index}
                          onClick={() => !isFreeSpace && toggleNumberMark(number)}
                          disabled={currentRoom.gameStatus !== "playing" || isFreeSpace}
                          className={`
                            aspect-square flex items-center justify-center text-lg font-bold rounded-lg
                            transition-all duration-200 border-2
                            ${isFreeSpace 
                              ? 'bg-yellow-500 text-black border-yellow-400 cursor-default' 
                              : isCalled && isMarked
                                ? 'bg-green-500 text-white border-green-400 shadow-lg scale-105'
                                : isCalled
                                  ? 'bg-blue-500 text-white border-blue-400'
                                  : isMarked
                                    ? 'bg-orange-500 text-white border-orange-400'
                                    : 'bg-white/20 text-white border-white/30 hover:bg-white/30'
                            }
                          `}
                        >
                          {isFreeSpace ? 'FREE' : number}
                        </button>
                      );
                    })}
                  </div>

                  {/* Bingo Button */}
                  {currentRoom.gameStatus === "playing" && coveredPattern && patternValidAgainstCalled && !hasAttemptedBingo && (
                    <button
                      onClick={handleBingo}
                      className="w-full py-4 bg-gradient-to-r from-yellow-400 to-orange-500 text-black font-bold text-xl rounded-lg hover:from-yellow-500 hover:to-orange-600 transition-all duration-200 shadow-lg animate-pulse"
                    >
                      🎉 BINGO! 🎉
                    </button>
                  )}

                  {/* Bet Controls */}
                  {!isBetActive && currentRoom.gameStatus === "waiting" && (
                    <button
                      onClick={handlePlaceBet}
                      className="w-full py-3 bg-green-500 hover:bg-green-600 text-white font-bold rounded-lg transition-colors"
                    >
                      Place Bet (${currentRoom.betAmount})
                    </button>
                  )}

                  {isBetActive && currentRoom.gameStatus === "waiting" && (
                    <button
                      onClick={handleCancelBet}
                      className="w-full py-3 bg-red-500 hover:bg-red-600 text-white font-bold rounded-lg transition-colors"
                    >
                      Cancel Bet
                    </button>
                  )}
                </div>
              ) : (
                <div className="text-center text-white/80 py-12">
                  <p className="text-lg mb-4">Select a card to start playing</p>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    {bingoCards.slice(0, 6).map((card) => (
                      <button
                        key={card.id}
                        onClick={() => handleCardSelect(card.id)}
                        disabled={card.claimed}
                        className={`
                          p-4 rounded-lg border-2 transition-all duration-200
                          ${card.claimed 
                            ? 'bg-gray-500/50 border-gray-400 text-gray-300 cursor-not-allowed' 
                            : 'bg-white/10 border-white/30 text-white hover:bg-white/20 hover:border-white/50'
                          }
                        `}
                      >
                        <div className="text-sm font-bold">Card #{card.serialNumber}</div>
                        {card.claimed && (
                          <div className="text-xs mt-1">Claimed</div>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Called Numbers */}
            <div className="bg-white/10 backdrop-blur-md rounded-xl p-6">
              <h3 className="text-lg font-bold text-white mb-4">Called Numbers</h3>
              <div className="grid grid-cols-5 gap-2 max-h-60 overflow-y-auto">
                {displayedCalledNumbers.map((number, index) => (
                  <div
                    key={index}
                    className={`
                      aspect-square flex items-center justify-center text-sm font-bold rounded
                      bg-gradient-to-br ${getPartitionColor(number)} text-white
                    `}
                  >
                    {number}
                  </div>
                ))}
              </div>
              {displayedCalledNumbers.length === 0 && (
                <p className="text-white/60 text-center py-4">No numbers called yet</p>
              )}
            </div>

            {/* Game Info */}
            <div className="bg-white/10 backdrop-blur-md rounded-xl p-6">
              <h3 className="text-lg font-bold text-white mb-4">Game Info</h3>
              <div className="space-y-2 text-sm text-white/80">
                <div>Status: <span className="text-white">{currentRoom.gameStatus}</span></div>
                <div>Players: <span className="text-white">{Object.keys(currentRoom.players || {}).length}</span></div>
                {currentRoom.payout && (
                  <div>Prize Pool: <span className="text-white">${currentRoom.payout}</span></div>
                )}
                {user && (
                  <div>Balance: <span className="text-white">${user.balance || 0}</span></div>
                )}
              </div>
            </div>

            {/* Winning Patterns */}
            <div className="bg-white/10 backdrop-blur-md rounded-xl p-6">
              <button
                onClick={() => setShowPatterns(!showPatterns)}
                className="w-full text-left text-lg font-bold text-white mb-4 flex justify-between items-center"
              >
                Winning Patterns
                <span className={`transform transition-transform ${showPatterns ? 'rotate-180' : ''}`}>
                  ▼
                </span>
              </button>
              {showPatterns && (
                <div className="text-sm text-white/80 space-y-2">
                  <div>• Any complete row</div>
                  <div>• Any complete column</div>
                  <div>• Any diagonal</div>
                  <div>• Four corners</div>
                  <div>• Small X (center + 4 adjacent)</div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Winner Popup */}
        {showWinnerPopup && winnerCard && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl p-8 max-w-md w-full mx-4">
              <div className="text-center">
                <h2 className="text-2xl font-bold text-green-600 mb-4">🏆 WINNER! 🏆</h2>
                <p className="text-gray-700 mb-6">Congratulations! You won the game!</p>
                <button
                  onClick={closeWinnerPopup}
                  className="px-6 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg transition-colors"
                >
                  Awesome!
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Loser Popup */}
        {showLoserPopup && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl p-8 max-w-md w-full mx-4">
              <div className="text-center">
                <h2 className="text-2xl font-bold text-red-600 mb-4">Game Over</h2>
                <p className="text-gray-700 mb-6">Better luck next time!</p>
                <button
                  onClick={() => setShowLoserPopup(false)}
                  className="px-6 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors"
                >
                  Play Again
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Room;