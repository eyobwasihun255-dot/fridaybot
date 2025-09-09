import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Users, Coins, Clock, Trophy } from 'lucide-react';
import { useLanguageStore } from '../store/languageStore';
import { useGameStore } from '../store/gameStore';
import { useAuthStore } from '../store/authStore';
import BingoGrid from '../components/BingoGrid';
import { rtdb } from '../firebase/config';
import { ref, runTransaction, update } from 'firebase/database';

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

  // ✅ Format seconds into mm:ss
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
            ? "w-4/5 h-4/5 rounded scale-75"   // 🔹 1/4th size (next round)
            : "w-4/5 h-2/5 rounded-xl p-2"}    // 🔹 30s countdown always fits
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
   
   const { winnerCard, showWinnerPopup, closeWinnerPopup } = useGameStore();

  const { currentRoom, bingoCards, joinRoom, selectCard, placeBet, checkBingo , selectedCard } = useGameStore();
  const { user, updateBalance } = useAuthStore();
 const userCard = bingoCards.find(
  (card) =>
    card.roomId === currentRoom?.id && // ✅ make sure it's the same room
    card.claimed &&
    card.claimedBy === user?.telegramId
);

const [remaining, setRemaining] = useState<number | null>(null);
     const displayedCard = userCard || selectedCard ;
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

const startNumberStream = useGameStore((s) => s.startNumberStream);
// Find this player's data inside the room
const playerData = currentRoom?.players?.[user?.telegramId];

// True if backend says this player already bet
const alreadyBetted = !!playerData?.betAmount && playerData.betAmount > 0;

// ✅ Always at top of component
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


function findCoveredPatternByMarks() {
  const patterns = generatePatterns();
  const markedSet = new Set(markedNumbers);

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

// Only allow Bingo if:
// - Room is not in "playing", OR
// - (Room is playing AND they have a valid pattern & it's in called numbers)
// AND they are not in the winners list


// Combine with local state for smoother UX
const isBetActive = hasBet || alreadyBetted || storeIsBetActive;
React.useEffect(() => {
  if (currentRoom?.gameStatus === "playing" && currentRoom.gameId) {
    startNumberStream(currentRoom.id, currentRoom.gameId);
  }
}, [currentRoom?.gameStatus, currentRoom?.gameId]);
 // Inside Room.tsx

const alreadyAttempted = playerData?.attemptedBingo ?? false;
React.useEffect(() => {
  setHasAttemptedBingo(alreadyAttempted);
  checkIfLoser(currentRoom, t);
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


React.useEffect(() => {
  if (!selectedCard) return;

  // find the updated version of this card in bingoCards
  const updatedCard = bingoCards.find((c) => c.id === selectedCard.id);

  if (!updatedCard) return;

  // ✅ If my card is still available OR claimed by me → keep it
  if (!updatedCard.claimed || updatedCard.claimedBy === user?.telegramId) {
    return;
  }

  // ❌ If my card was claimed by another player → clear/reset selection
  selectCard("");
}, [bingoCards, selectedCard, user?.telegramId, selectCard]);

  // Start countdown if 2+ players bet
React.useEffect(() => {
  if (!currentRoom || !currentRoom.players) return; // ✅ guard against null

  const activePlayers = Object.values(currentRoom.players).filter(
    (p: any) => p.betAmount && p.betAmount > 0
  );

  
}, [currentRoom]);

React.useEffect(() => {
  if (!currentRoom?.countdownEndAt || currentRoom?.gameStatus !== "countdown") return;

  const interval = setInterval(() => {
    if (Date.now() >= currentRoom.countdownEndAt) {
      useGameStore.getState().startGameIfCountdownEnded();
      clearInterval(interval);
    }
  }, 1000);

  return () => clearInterval(interval);
}, [currentRoom?.countdownEndAt, currentRoom?.gameStatus]);
// Countdown tick



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
    setHasBet(true); // ✅ mark bet placed
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
// Check if a card has bingo
function checkCardBingo(cardNumbers: number[][], calledNumbers: number[]) {
  const flatCard = cardNumbers.flat();
  const calledSet = new Set(calledNumbers);

  return generatePatterns().some((pattern) =>
    pattern.every((index) => {
      const num = flatCard[index];
      return num === 0 || calledSet.has(num); // 0 = Free space
    })
  );
}

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
  if (currentRoom?.gameStatus === "playing" || currentRoom?.gameStatus === "ended") {
    if (!displayedCard || !currentRoom || !user) {
      setGameMessage(t('error_player_card'));
      return;
    }

    if (hasAttemptedBingo) return;

    const playerPath = `rooms/${currentRoom.id}/players/${user.telegramId}`;
    const playerData = currentRoom.players?.[user.telegramId];
    if (playerData?.attemptedBingo) {
      setGameMessage(t('already_attempted_bingo'));
      setHasAttemptedBingo(true);
      return;
    }

    setHasAttemptedBingo(true);

    await update(ref(rtdb, playerPath), { attemptedBingo: true });

    if (currentRoom.payed) {
      setGameMessage(t('already_paid'));
      return;
    }

    const covered = findCoveredPatternByMarks();
    if (!covered || !patternExistsInCalled(covered.patternNumbers)) {
      setGameMessage(t('not_a_winner'));
      setIsDisqualified(true);
      return;
    }

    try {
      const activePlayersCount = currentRoom.players
        ? Object.keys(currentRoom.players).length
        : 0;
      const payout = activePlayersCount * currentRoom.betAmount * 0.9;

      // Update player balance
      const balanceRef = ref(rtdb, `users/${user.telegramId}/balance`);
      await runTransaction(balanceRef, (current) => (current || 0) + payout);

      // Register player as winner in room
      const roomWinnersRef = ref(rtdb, `rooms/${currentRoom.id}/winners`);
      const newWinner = {
        cardId: displayedCard.id,
        telegramId: user.telegramId,
        username: user.username || `user_${user.telegramId}`,
        payout,
        timestamp: Date.now(),
        checked: false
      };
      await runTransaction(roomWinnersRef, (current: any) => {
        const arr = Array.isArray(current) ? current : [];
        arr.push(newWinner);
        return arr;
      });

      // ✅ Additional: log winning history
      const winningHistoryRef = ref(rtdb, `winningHistory`);
      const historyEntry = {
        gameId: currentRoom.gameId,
        rollNumber: currentRoom.rollNumber ?? 0,
        roomId: currentRoom.id,
        playerId: user.telegramId,
        username: user.username || `user_${user.telegramId}`,
        cardId: displayedCard.id,
        date: Date.now(),
        payout
      };
      const newHistoryRef = ref(rtdb, `winningHistory/${currentRoom.gameId}_${user.telegramId}_${Date.now()}`);
      await update(newHistoryRef, historyEntry);

      // Mark room as paid (optional if only one winner)
      await update(ref(rtdb, `rooms/${currentRoom.id}`), { payed: true });

      // Update local state
      useGameStore.getState().setWinnerCard(displayedCard);
      useGameStore.getState().setShowWinnerPopup(true);
      useGameStore.getState().endGame(currentRoom.id);

    } catch (err) {
      console.error("❌ Error processing Bingo payout:", err);
      setGameMessage(t('error_processing_bingo'));
    }
  } else {
    setGameMessage(t('bingo_not_allowed'));
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
      <div className="bg-white/10 rounded text-center py-1 border border-white/20">
        {t('bet')}: {currentRoom.betAmount}
      </div>
     <div className="bg-white/10 rounded text-center py-1 border border-white/20">
  {t('payout')}: {
    Math.max(
      0,
      Math.floor(
        (Object.keys(currentRoom.players || {}).length || 0) *
          currentRoom.betAmount *
          0.9 -
          currentRoom.betAmount
      )
    )
  }
</div>

      <div className="bg-white/10 rounded text-center py-1 border border-white/20">
         {currentRoom?.gameStatus ?? t('waiting')}
      </div>
      
    </div>

    {/* Main content row */}
    <div className="flex flex-row gap-2 w-full max-w-full h-full">
      {loserPopup.visible && (
  <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
    <div className="bg-white text-black rounded-2xl shadow-2xl p-8 w-96 max-w-full text-center">
      <h2 className="text-2xl font-bold mb-3"> {loserPopup.message} </h2>
      <button
        onClick={() => setLoserPopup({ visible: false, message: '' })}
        className="mt-2 px-5 py-3 bg-red-500 text-white rounded-xl shadow-lg hover:scale-105 transform transition"
      >
        Close
      </button>
    </div>
  </div>
)}

{showWinnerPopup && winnerCard && (
  <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
    <div className="relative bg-gradient-to-br from-red-500 via-yellow-400 to-blue-500 rounded-3xl shadow-2xl p-8 w-96 max-w-full text-center overflow-hidden animate-scale-in">

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
        {t('card')} #{winnerCard.serialNumber} is {t('winner')} 🎉
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
    <div className="relative w-2/5 h-full flex flex-col bg-white/10 p-2 rounded border border-white/20 text-xs">
  {/* Bingo Header */}
  <div className="grid grid-cols-5 gap-1 mb-1">
    {["B", "I", "N", "G", "O"].map((letter) => (
      <div
        key={letter}
        className="w-6 h-6 flex items-center justify-center font-bold text-[10px] bg-purple-600 rounded "
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
        const lastCalled = displayedCalledNumbers.at(-1);
        const isLastCalled = num === lastCalled;
        const isPreviouslyCalled =
          displayedCalledNumbers.includes(num) && !isLastCalled;

        return (
          <div
            key={`${col}-${num}`}
            className={`flex items-center justify-center p-[3px] rounded font-bold text-[11px] transition
              ${isLastCalled
                ? "bg-green-500 text-white scale-105"
                : isPreviouslyCalled
                ? "bg-red-500 text-white"
                : "bg-white/20"}
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
      <div className="w-3/5 bg-white/10 p-2 rounded border border-white/20 text-xs">
        {/* Current Call */}
        <div className="relative flex flex-col items-center justify-center bg-white/10 p-2 rounded border border-white/20 min-h-[100px]">


 <div
  className={`w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold shadow bg-gradient-to-br ${
    displayedCalledNumbers.length > 0
      ? getPartitionColor(displayedCalledNumbers.at(-1)!)
      : "from-gray-400 to-gray-600"
  }`}
>
  {displayedCalledNumbers.length > 0
    ? `${getBingoLetter(displayedCalledNumbers.at(-1)!)}${displayedCalledNumbers.at(-1)}`
    : "-"}
</div>



  

  {currentRoom?.gameStatus === "ended" && currentRoom.nextGameCountdownEndAt && (
    <CountdownOverlay
      countdownEndAt={currentRoom.nextGameCountdownEndAt}
      label=""
    />
  )}
</div>



        {/* Card header */}
        <div className="flex justify-between items-center mb-1">
          <h3 className="font-bold text-sm">{t('select_card')}</h3>
         <select
  value={selectedCard?.id ?? ''}
  onChange={(e) => handleCardSelect(e.target.value)}
  className="bg-white/20 text-white rounded px-1 py-0.5 text-[10px]"
  disabled={isBetActive} // ✅ disable dropdown once bet is active
>
  <option value="" disabled>Select Card</option>
  {bingoCards
    .slice()
    .sort((a, b) => a.serialNumber - b.serialNumber)
    .map((card) => (
      <option key={card.id} value={card.id} disabled={card.claimed}>
        {t('cards')} {card.serialNumber} {card.claimed ? "(claimed)" : ""}
      </option>
    ))}
</select>

        </div>

        {/* Bingo Header */}
        <div className="grid grid-cols-5 gap-1 mb-1">
          {["B", "I", "N", "G", "O"].map((letter) => (
            <div
              key={letter}
              className="w-8 h-8 flex items-center justify-center font-bold text-[12px] bg-purple-600 rounded"
            >
              {letter}
            </div>
          ))}
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
                  ${isMarked ? "bg-green-500 text-white scale-105" : "bg-white/20 hover:bg-white/30"}
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
  <div className="mt-6">
    {["waiting", "countdown"].includes(currentRoom?.gameStatus ?? "") ? (
  <button
    onClick={isBetActive ? handleCancelBet : handlePlaceBet}
    className={`mt-4 px-4 py-2 rounded-lg shadow font-semibold ${
      isBetActive
        ? "bg-red-600 hover:bg-red-700 text-white"
        : "bg-blue-600 hover:bg-blue-700 text-white"
    }`}
  >
    {isBetActive
      ? t("cancel_bet") + " card:" + displayedCard.serialNumber
      : t("place_bet") + " card:" + displayedCard.serialNumber}
  </button>
) : (
  <p className="text-gray-400 italic text-sm">{t("game_already_in_progress")}</p>
)}

  </div>
) : (
  <p className="mt-6 text-gray-400">{t('no_card_selected')}</p>
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
      {t("bingo_rules_countdown").map((rule: string, i: number) => (
        <li key={i}>{rule}</li>
      ))}
    </ul>
  </div>
)}
{currentRoom?.gameStatus === "waiting" && (
  <div className="w-full bg-yellow-400/80 text-black rounded-lg p-3 mb-2 shadow text-sm">
    <h3 className="font-bold mb-1">📜 {language === "am" ? "የቢንጎ ደንቦች" : "Bingo Rules & Info"}</h3>
    <ul className="list-disc list-inside space-y-1">
      {t("bingo_rules_countdown").map((rule: string, i: number) => (
        <li key={i}>{rule}</li>
      ))}
    </ul>
  </div>
)}

{currentRoom?.gameStatus === "ended" && (
  <div className="w-full bg-yellow-400/80 text-black rounded-lg p-3 mb-2 shadow text-sm">
    <h3 className="font-bold mb-1">📜 {language === "am" ? "የቢንጎ ደንቦች" : "Bingo Rules & Info"}</h3>
    <ul className="list-disc list-inside space-y-1">
      {t("bingo_rules_ended").map((rule: string, i: number) => (
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
  disabled={hasAttemptedBingo || isDisqualified }
>
  {t('bingo')}
</button>



    <button
      onClick={() => navigate("/")}
      className="flex-1 bg-gradient-to-r from-red-500 to-pink-500 py-2 rounded font-bold text-sm shadow hover:opacity-90 transition"
    >
      {t('home')}
    </button>
  </div>

  {/* Row with Bingo Laws */}
  <button
    onClick={() => setShowPatterns(true)}
    className="w-full bg-gradient-to-r from-blue-600 to-purple-600 py-2 rounded-lg font-bold text-sm shadow hover:opacity-90 transition"
  >
    {t('pattern')}
  </button>
</div>


    {/* Footer: Betted Players */}
    <div className="w-full mt-6 bg-white/10 rounded border border-white/20 p-3">
      <h3 className="font-bold text-sm mb-2">{t("players_in_room")}</h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
  {currentRoom?.players && Object.keys(currentRoom.players || {}).length > 0 ? (
    Object.values(currentRoom.players || {}).map((player: any) => {
      const maskedUsername = player.username
        ? `${player.username.slice(0, 3)}***`
        : `user_${player.telegramId?.slice(0, 3) ?? '???'}***`;

      // ✅ Determine background color
      let bgColor = "bg-white/20"; // default
      if (currentRoom.winners?.some((w: any) => w.telegramId === player.telegramId)) {
        bgColor = "bg-green-400"; // winner
      } else if (player.attemptedBingo) {
        bgColor = "bg-red-400"; // attempted bingo
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