// Room.tsx (refactor)
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useLanguageStore } from '../store/languageStore';
import { useGameStore } from '../store/gameStore';
import { useAuthStore } from '../store/authStore';
import { getApiUrl } from '../config/api';

const CARDS_PER_PAGE = 100;

const Room: React.FC = () => {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const { t, language } = useLanguageStore();

  // helper to safely get translation arrays
  const getList = useCallback((key: string): string[] => {
    const anyT = t as unknown as (k: string) => any;
    const val = anyT(key);
    return Array.isArray(val) ? (val as string[]) : [];
  }, [t]);

  // store selectors (keep retrieval grouped)
  const {
    winnerCard,
    showWinnerPopup,
    closeWinnerPopup,
    currentRoom,
    bingoCards,
    joinRoom,
    selectCard,
    placeBet,
    selectedCard,
    showLoserPopup,
    setShowLoserPopup,
    connectToServer,
    checkBingo,
    setEnteredRoom,
    syncRoomState,
    setShowWinnerPopup,
    cancelBet,
    displayedCalledNumbers: storeDisplayedCalledNumbers,
    isBetActive: storeIsBetActive,
  } = useGameStore();

  const { user } = useAuthStore();

  // ---- Derived memos (single place for lookups) ----
  const playerData = useMemo(() => currentRoom?.players?.[user?.telegramId as string], [currentRoom, user?.telegramId]);
  const alreadyBetted = !!playerData?.betAmount && playerData.betAmount > 0;
  const userCard = useMemo(
    () => bingoCards.find((c) => c?.claimed && String(c.claimedBy) === String(user?.telegramId)),
    [bingoCards, user?.telegramId]
  );

  const displayedCard = useMemo(
    () => selectedCard || userCard,
    [selectedCard, userCard]
  );

  const cardNumbers = useMemo(() => displayedCard?.numbers ?? userCard?.numbers ?? [[0]], [displayedCard, userCard]);

  // pull displayedCalledNumbers for current room (safe)
  const displayedCalledNumbers = useMemo(() => {
    if (!currentRoom?.id) return [];
    // storeDisplayedCalledNumbers is expected shape: { [roomId]: number[] }
    // If it's stored differently in gameStore, adapt accordingly.
    const pool = (storeDisplayedCalledNumbers && (storeDisplayedCalledNumbers as any)[currentRoom.id]) || [];
    return Array.isArray(pool) ? pool : [];
  }, [storeDisplayedCalledNumbers, currentRoom?.id]);

  // UI local state
  const [cardPage, setCardPage] = useState(0);
  const [hasBet, setHasBet] = useState(false);
  const [timeLeft, setTimeLeft] = useState(0);
  const [markedNumbers, setMarkedNumbers] = useState<number[]>([]);
  const [hasAttemptedBingo, setHasAttemptedBingo] = useState(false);
  const [isDisqualified, setIsDisqualified] = useState(false);
  const [gameMessage, setGameMessage] = useState('');
  const [popupMessage, setPopupMessage] = useState<string | null>(null);
  const [showPatterns, setShowPatterns] = useState(false);
  const [showNetworkPopup, setShowNetworkPopup] = useState(false);

  // unify isBetActive
  const isBetActive = hasBet || alreadyBetted || !!storeIsBetActive;

  // ---- Utility functions (memoized where helpful) ----
  const formatTime = useCallback((seconds: number) => {
    const m = String(Math.floor(seconds / 60)).padStart(2, '0');
    const s = String(seconds % 60).padStart(2, '0');
    return `${m}:${s}`;
  }, []);

  const getPartitionColor = useCallback((num: number) => {
    if (num >= 1 && num <= 15) return 'from-blue-400 to-blue-600';
    if (num >= 16 && num <= 30) return 'from-green-400 to-green-600';
    if (num >= 31 && num <= 45) return 'from-yellow-400 to-yellow-600';
    if (num >= 46 && num <= 60) return 'from-orange-400 to-orange-600';
    if (num >= 61 && num <= 75) return 'from-red-400 to-red-600';
    return 'from-gray-400 to-gray-600';
  }, []);

  function generatePatterns() {
    const size = 5;
    const indices: number[][] = [];

    for (let r = 0; r < size; r++) indices.push([...Array(size)].map((_, c) => r * size + c)); // rows
    for (let c = 0; c < size; c++) indices.push([...Array(size)].map((_, r) => r * size + c)); // cols
    indices.push([...Array(size)].map((_, i) => i * size + i)); // diag
    indices.push([...Array(size)].map((_, i) => i * size + (size - 1 - i))); // anti-diag
    indices.push([12, 6, 8, 16, 18]); // small X
    indices.push([0, 4, 20, 24]); // corners
    return indices;
  }

  // ---- Single responsibility: effect to connect & join once ----
  useEffect(() => {
    // connect socket once and join room when roomId exists
    connectToServer();
    if (roomId) {
      joinRoom(roomId);
    }
    // cleanup is handled inside store/socket if implemented
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectToServer, joinRoom, roomId]);
  // ---- Detect network lag / lost sync ----
useEffect(() => {
  let lastUpdate = Date.now();
  
  // Whenever currentRoom updates, refresh timestamp
  if (currentRoom) {
    lastUpdate = Date.now();
  }

  const interval = setInterval(() => {
    const now = Date.now();

    // If 7 seconds pass without room updates → assume lag
    if (now - lastUpdate > 7000) {
      setShowNetworkPopup(true);
    }
  }, 3000);

  return () => clearInterval(interval);
}, [currentRoom]);

  // ---- Countdown timer effect (single, based on countdownEndAt) ----
  useEffect(() => {
    if (!currentRoom?.gameStatus || !currentRoom.countdownEndAt) {
      setTimeLeft(0);
      return;
    }

    const update = () => {
      const now = Date.now();
      const end = new Date(currentRoom.countdownEndAt).getTime();
      const sec = Math.max(0, Math.floor((end - now) / 1000));
      setTimeLeft(sec);
    };

    update();
    const iv = setInterval(update, 1000);
    return () => clearInterval(iv);
  }, [currentRoom?.countdownEndAt, currentRoom?.gameStatus]);

  // ---- Unified popups/message timeouts (one effect for all ephemeral messages) ----
  useEffect(() => {
    const timers: number[] = [];

    if (showWinnerPopup) {
      timers.push(window.setTimeout(() => setShowWinnerPopup(false), 3000));
    }
    if (showLoserPopup) {
      setGameMessage(t('loser_bingo'));
      timers.push(window.setTimeout(() => setShowLoserPopup(false), 3000));
    }
    if (gameMessage) {
      timers.push(window.setTimeout(() => setGameMessage(''), 3000));
    }
    if (popupMessage) {
      timers.push(window.setTimeout(() => setPopupMessage(null), 3000));
    }

    return () => timers.forEach((t) => clearTimeout(t));
  }, [showWinnerPopup, showLoserPopup, gameMessage, popupMessage, setShowWinnerPopup, setShowLoserPopup, t]);

  // ---- reset marks when game starts playing ----
  useEffect(() => {
    if (currentRoom?.gameStatus === 'playing') {
      setMarkedNumbers([]);
      setHasAttemptedBingo(false);
      setIsDisqualified(false);
    }
  }, [currentRoom?.gameStatus]);

  // ---- sync bet state with user balance/room info (single effect) ----
  useEffect(() => {
    if (!currentRoom || !user) return;

    const card = bingoCards.find(
      (c) => c.roomId === currentRoom.id && c.claimed && String(c.claimedBy) === String(user.telegramId)
    ) || selectedCard;

    if (!card) return;

    // if user can't afford and not demo room and not playing -> cancel bet
    if (!currentRoom.isDemoRoom && currentRoom.gameStatus !== 'playing' && (user.balance || 0) < (currentRoom.betAmount || 0)) {
      (async () => {
        const ok = await cancelBet(card.id);
        if (ok) {
          setHasBet(false);
          setGameMessage(t('insufficient_balance'));
        }
      })();
    } else {
      const pdata = currentRoom.players?.[user.telegramId];
      if (pdata?.betAmount && pdata.betAmount > 0) setHasBet(true);
    }
  }, [currentRoom, user, bingoCards, selectedCard, cancelBet, t]);

  // ---- keep "hasAttemptedBingo" in sync with player data ----
  useEffect(() => {
    setHasAttemptedBingo(Boolean(playerData?.attemptedBingo));
  }, [playerData?.attemptedBingo]);

  // ---- helpers / callbacks (memoized) ----
  const handleNumberClick = useCallback((num: number) => {
    setMarkedNumbers((prev) => (prev.includes(num) ? prev.filter((n) => n !== num) : [...prev, num]));
  }, []);

  const handlePlaceBet = useCallback(async () => {
    if (!displayedCard || !currentRoom) return;
    if (!currentRoom.isDemoRoom && (user?.balance || 0) < (currentRoom.betAmount || 0)) {
      setGameMessage(t('insufficient_balance'));
      return;
    }
    const success = await placeBet();
    if (success) {
      setHasBet(true);
      setGameMessage(t('bet_placed'));
    }
  }, [displayedCard, currentRoom, user?.balance, placeBet, t]);

  const handleCancelBet = useCallback(async () => {
    const cardId = userCard?.id || selectedCard?.id;
    if (!cardId) return;
    const success = await cancelBet(cardId);
    if (success) {
      setHasBet(false);
      setEnteredRoom(false);
      setGameMessage(t('bet_canceled') || 'Bet canceled');
    } else {
      console.error('❌ Failed to cancel bet');
    }
  }, [cancelBet, selectedCard, userCard, setEnteredRoom, t]);

  const handleToggleAuto = useCallback(async () => {
    if (!displayedCard || !currentRoom) return;
    const auto = displayedCard.auto ? false : true;
    try {
      const res = await fetch(getApiUrl('/api/toggle-auto'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId: currentRoom.id, cardId: displayedCard.id, auto }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setPopupMessage(json.message || t('error'));
        return;
      }
      await syncRoomState(currentRoom.id);
      setPopupMessage(auto ? t('auto_bet_en') : t('auto_bet_dis'));
    } catch (err) {
      console.error('toggle auto failed', err);
      setPopupMessage(t('error'));
    }
  }, [displayedCard, currentRoom, syncRoomState, t]);

  // helper for bingo marking detection
  const findCoveredPatternByMarks = useCallback(() => {
    if (!displayedCard) return null;
    const flatCard = displayedCard.numbers.flat().map((n: number) => n || 0);
    const markedSet = new Set(markedNumbers);
    const patterns = generatePatterns();
    for (let pIdx = 0; pIdx < patterns.length; pIdx++) {
      const indices = patterns[pIdx];
      const fullyCovered = indices.every((i) => {
        const num = flatCard[i];
        return num === 0 || markedSet.has(num);
      });
      if (fullyCovered) {
        return { patternIndex: pIdx, patternIndices: indices, patternNumbers: indices.map((i) => flatCard[i]) };
      }
    }
    return null;
  }, [displayedCard, markedNumbers]);

  const patternExistsInCalled = useCallback((patternNumbers: number[]) => {
    const calledSet = new Set(displayedCalledNumbers);
    return patternNumbers.every((n) => n === 0 || calledSet.has(n));
  }, [displayedCalledNumbers]);

  const handleBingoClick = async () => {
    console.log("clicked bingo")
    if (!displayedCard) {
      setGameMessage("❌ You don't have a card");
      return;
    }

    if (currentRoom?.gameStatus !== 'playing') {
      setGameMessage(t('bingo_not_allowed'));
      return;
    }

    if (!currentRoom || !user) {
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
    } catch (err) {
      console.error('❌ Error sending bingo claim:', err);
      setGameMessage('Network error');
      setHasAttemptedBingo(false);
    }

}

  // ---- small helpers used by UI ----
  function getBingoLetter(num: number) {
    if (num >= 1 && num <= 15) return 'B-';
    if (num >= 16 && num <= 30) return 'I-';
    if (num >= 31 && num <= 45) return 'N-';
    if (num >= 46 && num <= 60) return 'G-';
    if (num >= 61 && num <= 75) return 'O-';
    return '';
  }

  // ---- Card selection grid as a small inner component (memoizable) ----
  const CardSelectionGrid = useCallback(({ page, setPage }: { page: number; setPage: (p: number) => void }) => {
    // safe sort & pagination
    const safeCards = (bingoCards || []).filter(Boolean);
    const sortedCards = [...safeCards].sort((a, b) => (a.serialNumber ?? 0) - (b.serialNumber ?? 0));
    const totalPages = Math.max(1, Math.ceil(sortedCards.length / CARDS_PER_PAGE));
    const paginatedCards = sortedCards.slice(page * CARDS_PER_PAGE, (page + 1) * CARDS_PER_PAGE);

    const myClaimedCard = safeCards.find((c: any) => c.claimedBy === user?.telegramId);
    const displayed = safeCards.find((c: any) => c.id === selectedCard?.id) || myClaimedCard;

    const handleSelectCardLocal = (cardId: string) => {
      const found = safeCards.find((c: any) => c.id === cardId);
      if (found && !found.claimed) selectCard(cardId);
    };

    return (
      <div className="flex flex-col items-center min-h-screen text-white p-4">
        <button onClick={() => navigate('/')} className="fixed top-3 left-3 bg-gradient-to-r from-red-500 to-pink-500 px-4 py-2 rounded font-bold text-sm shadow hover:opacity-90 transition z-50">
          {t('home')}
        </button>

        {currentRoom?.gameStatus === 'countdown' && (
          <div className="mt-10 mb-4 text-center">
            <h2 className="text-2xl font-bold mb-1">{t('select_card')}</h2>
            <p className="text-sm text-theme-accent font-semibold">{formatTime(timeLeft)} {t('seconds')}</p>
          </div>
        )}

        <div className="w-full max-w-3xl overflow-y-auto max-h-[80vh] mb-6 rounded-lg border border-white/10 p-3 bg-black/20">
          <div className="grid grid-cols-10 gap-2 justify-items-center">
            {paginatedCards.map((card: any) => {
              const isClaimed = card.claimed;
              const isMine = card.claimedBy === user?.telegramId;
              const isSelected = selectedCard?.id === card.id;
              const isHighlighted = isMine || isSelected;

              let colorClass = '';
              if (isHighlighted) colorClass = 'bg-gradient-to-br from-theme-green to-emerald-600 text-white shadow-md border border-green-700';
              else if (isClaimed) colorClass = 'bg-gradient-to-br from-theme-red to-rose-700 text-white border border-red-700 shadow-sm';
              else colorClass = 'bg-gradient-to-br from-theme-light to-white text-gray-800 border border-gray-300 hover:from-theme-accent hover:to-theme-secondary hover:text-white transition';

              return (
                <div key={card.id} onClick={() => !card.claimed && handleSelectCardLocal(card.id)} className={`w-8 h-8 flex items-center justify-center rounded-lg font-bold cursor-pointer transition-transform duration-150 transform hover:scale-105 text-xs ${colorClass}`}>
                  {card.serialNumber}
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-4 mb-4">
          <button disabled={page === 0} onClick={() => setPage((p) => p - 1)} className="px-4 py-2 rounded bg-theme-primary disabled:opacity-40">
            {t('previous')}
          </button>

          <span className="font-bold text-sm">{t('page')} {page + 1} / {totalPages}</span>

          <button disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)} className="px-4 py-2 rounded bg-theme-green disabled:opacity-40">
            {t('next')}
          </button>
        </div>

        {displayed && (
          <div className="mb-6 p-3 bg-white/10 rounded-lg shadow-inner flex flex-col items-center w-full max-w-[180px]">
            <div className="text-xs mb-2 font-semibold text-theme-light">{t('selected_card')} #{displayed.serialNumber}</div>
            <div className="grid grid-cols-5 gap-0.5">
              {displayed.numbers.slice(0, 5).map((row: number[], rowIdx: number) => row.map((num, colIdx) => (
                <div key={`${rowIdx}-${colIdx}`} className="w-5 h-5 flex items-center justify-center text-[10px] rounded bg-gradient-to-br bg-theme-primary text-white font-bold border border-white/20">
                  {num === 0 && rowIdx === 2 && colIdx === 2 ? '★' : num}
                </div>
              )))}
            </div>
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-3 w-full max-w-xs">
          <button onClick={isBetActive ? handleCancelBet : handlePlaceBet} className="w-full px-4 py-2 rounded-lg shadow font-semibold transition bg-gradient-to-r from-theme-primary to-theme-green hover:opacity-90 text-white">
            {t('place_bet')} card:{displayed?.serialNumber ?? 0}
          </button>
        </div>
      </div>
    );
  }, [bingoCards, selectedCard, user?.telegramId, selectCard, navigate, t, timeLeft, isBetActive, handleCancelBet, handlePlaceBet, formatTime]);

  // If room isn't loaded show loader
  if (!currentRoom) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="text-center text-white">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-white border-t-transparent mx-auto mb-4"></div>
          <p>{t('loading')}</p>
        </div>
      </div>
    );
  }

  // If waiting or countdown and user has no claimed card -> show selection grid
  if (['waiting', 'countdown'].includes(currentRoom.gameStatus || '') && !userCard) {
    return <CardSelectionGrid page={cardPage} setPage={setCardPage} />;
  }

  // ---- Render main room UI (playing / preview) ----
  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-800 via-purple-900 to-blue-900 flex flex-col items-center p-2 text-white">
      {/* header & info */}
      
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-1 mb-3 w-full text-xs">
        <button onClick={() => navigate('/')} className="fixed top-3 left-3 bg-gradient-to-r from-red-500 to-pink-500 px-4 py-2 rounded font-bold text-sm shadow hover:opacity-90 transition z-50">
          {t('home')}
        </button>

        <button onClick={() => window.location.reload()} className="bg-gradient-to-r from-indigo-500 to-blue-500 px-4 py-2 rounded font-bold text-sm shadow ">
          {t('refresh') ?? 'Refresh'}
        </button>

        <div className="bg-white/10 rounded text-center py-1 border border-white/20">{t('bet')}: {currentRoom.betAmount}</div>

        <div className="bg-white/10 rounded text-center py-1 border border-white/20">
          {t('payout')}: {Math.max(0, ((Object.keys(currentRoom.players || {}).length || 0) * (currentRoom.betAmount || 0) * 0.8))}
        </div>
      </div>

      <div className="bg-white/10 rounded text-center py-1 border border-white/20 w-full mb-2">
        {currentRoom?.gameStatus ?? t('waiting')}
      </div>
      
      {/* popups */}
      {showLoserPopup && winnerCard  && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          {/* loser popup content (kept similar to yours) */}
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-96 max-w-full text-center">
            <h2 className="text-2xl font-bold mb-3 text-theme-primary">{t('winner_pattern')}</h2>
            <p className="mb-2 text-lg">{t('you_lost')}</p>
            <p className="mb-4 text-sm text-gray-600">
              {t('card_number')}: {winnerCard.serialNumber}
              <p></p>
              {t('winner')}: {currentRoom?.players?.[winnerCard.claimedBy as string]?.username || winnerCard.claimedBy || 'no Username'}
            </p>

            <div className="mb-4 animate-scale-in">
              <div className="grid grid-cols-5 gap-1 mb-2">
                {['B', 'I', 'N', 'G', 'O'].map((letter) => (
                  <div key={letter} className="w-10 h-10 flex items-center justify-center rounded-lg font-extrabold text-sm bg-gradient-to-br from-theme-primary to-theme-secondary text-white shadow-md">
                    {letter}
                  </div>
                ))}
              </div>

              <div className="p-2 rounded-xl bg-gradient-to-br from-theme-light to-white shadow-lg border border-theme-accent">
                {winnerCard.numbers.map((row: number[], rowIdx: number) => (
                  <div key={rowIdx} className="grid grid-cols-5 gap-1 mb-1">
                    {row.map((num: number, colIdx: number) => {
                      const flatIdx = rowIdx * 5 + colIdx;
                      const isInWinningPattern = winnerCard.winningPatternIndices?.includes(flatIdx) || false;
                      const displayNum = num === 0 && rowIdx === 2 && colIdx === 2 ? '★' : num;
                      return (
                        <div key={`${rowIdx}-${colIdx}`} className={`text-sm font-bold w-10 h-10 flex items-center justify-center rounded-lg border transition-all duration-200 ${isInWinningPattern ? 'bg-gradient-to-br from-theme-green to-emerald-600 text-white border-green-700 shadow-md scale-105' : 'bg-white text-gray-800 border-gray-300 hover:bg-theme-light hover:text-theme-primary'}`}>
                          {displayNum}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>

            <button onClick={() => setShowLoserPopup(false)} className="mt-2 px-5 py-2 bg-red-600 text-white rounded-lg shadow hover:bg-red-700">
              {t('close')}
            </button>
          </div>
        </div>
      )}

      {popupMessage && <div className="fixed top-4 right-4 bg-black/80 text-white px-4 py-2 rounded-lg shadow-lg z-50 animate-fade-in-out">{popupMessage}</div>}
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
      {showWinnerPopup && winnerCard && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="relative bg-gradient-to-br from-theme-primary via-theme-secondary to-theme-accent rounded-3xl shadow-2xl p-8 w-96 max-w-full text-center overflow-hidden animate-scale-in">
            {[...Array(25)].map((_, i) => (
              <div key={i} className="absolute text-lg animate-fall" style={{ top: `${Math.random() * 100}%`, left: `${Math.random() * 100}%`, animationDelay: `${Math.random() * 2}s` }}>🎉</div>
            ))}

            <div className="absolute -top-6 -left-10 text-5xl animate-wiggle">🎺</div>
            <div className="absolute -top-6 -right-10 text-5xl animate-wiggle">🎺</div>

            <button onClick={closeWinnerPopup} className="absolute top-2 right-2 text-white hover:text-gray-200">✕</button>

            <h2 className="text-5xl font-extrabold tracking-wide text-yellow-300 drop-shadow-lg animate-bounce">{t('bingo')}!</h2>
            <p className="mb-4 text-lg text-white font-semibold">{t('card')} #{winnerCard.serialNumber} {t('winner')} 🎉</p>
            <button onClick={closeWinnerPopup} className="mt-2 px-5 py-3 bg-gradient-to-r from-green-500 to-blue-600 text-white rounded-xl shadow-lg hover:scale-105 transform transition">Close</button>
          </div>
        </div>
      )}

      {/* main columns */}
      <div className="flex flex-row gap-2 w-full max-w-full h-full">
        {/* LEFT: called numbers */}
        <div className="relative w-2/5 h-full flex flex-col bg-theme-light/20 p-2 rounded border border-theme-accent/30 text-xs">
          <div className="grid grid-cols-5 gap-1 mb-1">
            {['B', 'I', 'N', 'G', 'O'].map((letter) => (
              <div key={letter} className="w-6 h-6 flex items-center justify-center font-bold text-[10px] bg-theme-primary rounded ">{letter}</div>
            ))}
          </div>

          <div className="relative flex-1">
            <div className="grid grid-cols-5 gap-1 w-full h-full">
              {[...Array(15)].map((_, rowIdx) =>
                ['B', 'I', 'N', 'G', 'O'].map((col, colIdx) => {
                  const num = rowIdx + 1 + colIdx * 15;
                  const lastCalled = displayedCalledNumbers[displayedCalledNumbers.length - 1];
                  const previouslyCalledNumbers = lastCalled ? displayedCalledNumbers.slice(0, -1) : [];
                  const isLastCalled = num === lastCalled;
                  const isPreviouslyCalled = previouslyCalledNumbers.includes(num);

                  return (
                    <div key={`${col}-${num}`} className={`flex items-center justify-center p-[3px] rounded font-bold text-[11px] transition ${isLastCalled ? 'bg-theme-green text-white scale-105' : isPreviouslyCalled ? 'bg-theme-red text-white' : 'bg-theme-primary'}`}>
                      {num}
                    </div>
                  );
                })
              )}
            </div>

            {currentRoom?.gameStatus === 'countdown' && currentRoom.countdownEndAt && timeLeft > 0 && (
              <div className="absolute inset-0 bg-black/70 flex items-center justify-center rounded">
                <div className="bg-white text-black text-center shadow-xl flex flex-col items-center justify-center w-4/5 h-2/5 rounded-xl p-2">
                  <h2 className="font-bold mb-2">{t('time_left')}</h2>
                  <p className="text-l font-mono">{formatTime(timeLeft)} {t('seconds')}</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT: player card and controls */}
        <div className="w-3/5 bg-theme-light/20 p-2 rounded border border-theme-accent/30 text-xs">
          <div className="relative flex flex-col items-center justify-center bg-theme-light/10 p-2 rounded border border-theme-accent/20 min-h-[100px]">
            <div className="flex items-center gap-2">
              <div className={`w-14 h-14 rounded-full flex items-center justify-center text-lg font-bold shadow bg-gradient-to-br border-4 border-yellow-300 ${displayedCalledNumbers.length > 0 ? getPartitionColor(displayedCalledNumbers[displayedCalledNumbers.length - 1]!) : 'from-gray-400 to-gray-600'}`}>
                {displayedCalledNumbers.length > 0 ? `${getBingoLetter(displayedCalledNumbers[displayedCalledNumbers.length - 1]!)}${displayedCalledNumbers[displayedCalledNumbers.length - 1]}` : '-'}
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
          </div>

          {/* bingo header */}
          <div className="grid grid-cols-5 gap-1 mb-1">
            {['B', 'I', 'N', 'G', 'O'].map((letter, idx) => {
              const colors = [
                'bg-gradient-to-br from-theme-primary to-theme-secondary w-8 h-8 flex items-center justify-center rounded font-bold text-[11px]',
                'bg-gradient-to-br from-theme-secondary to-theme-accent w-8 h-8 flex items-center justify-center rounded font-bold text-[11px]',
                'bg-gradient-to-br from-theme-accent to-theme-light w-8 h-8 flex items-center justify-center rounded font-bold text-[11px]',
                'bg-gradient-to-br from-theme-light to-theme-primary w-8 h-8 flex items-center justify-center rounded font-bold text-[11px]',
                'bg-gradient-to-br from-theme-primary to-theme-accent w-8 h-8 flex items-center justify-center rounded font-bold text-[11px]',
              ];
              return <div key={letter} className={`w-6 h-6 flex items-center justify-center font-bold text-[10px] rounded text-white shadow ${colors[idx]}`}>{letter}</div>;
            })}
          </div>

          {/* numbers grid */}
          <div className="grid grid-cols-5 gap-1">
            {cardNumbers.flat().map((num: number, idx: number) => {
              const isMarked = markedNumbers.includes(num);
              return (
                <div key={`${num}-${idx}`} onClick={() => handleNumberClick(num)} className={`w-8 h-8 flex items-center justify-center rounded font-bold text-[11px] cursor-pointer transition ${isMarked ? 'bg-theme-primary text-white scale-105' : 'bg-theme-light/20 hover:bg-theme-light/30'}`}>
                  {num === 0 ? '★' : num}
                </div>
              );
            })}
          </div>

          {/* Bet controls */}
          {displayedCard ? (
            <div className="mt-6 space-y-3">
              {userCard && currentRoom?.gameStatus !== 'playing' && (
                <button onClick={isBetActive ? handleCancelBet : handlePlaceBet} className={`w-full px-4 py-2 rounded-lg shadow font-semibold transition ${isBetActive ? 'bg-gradient-to-r from-theme-secondary to-theme-red hover:opacity-90 text-white' : 'bg-gradient-to-r from-theme-primary to-theme-green hover:opacity-90 text-white'}`}>
                  {isBetActive ? `${t('cancel_bet')} card:${displayedCard?.serialNumber ?? 0}` : `${t('place_bet')} card:${displayedCard?.serialNumber ?? 0}`}
                </button>
              )}

              {displayedCard && displayedCard.auto !== undefined && isBetActive && displayedCard.claimed && (
                <button onClick={handleToggleAuto} className={`w-full px-4 py-2 rounded-lg shadow font-semibold ${displayedCard.auto ? 'bg-theme-red hover:bg-theme-secondary text-white' : 'bg-theme-green hover:bg-theme-primary text-white'}`}>
                  {displayedCard.auto ? `${t('remove_auto_bet')} card:${displayedCard?.serialNumber}` : `${t('set_auto_bet')} card:${displayedCard?.serialNumber}`}
                </button>
              )}
            </div>
          ) : (
            <p className="mt-6 text-gray-400">{t('no_card_selected')}</p>
          )}
        </div>
      </div>

      {/* bottom controls */}
      <div className="flex flex-col gap-2 mt-3 w-full">
        {['countdown', 'waiting'].includes(currentRoom.gameStatus || '') && (
          <div className="w-full bg-yellow-400/80 text-black rounded-lg p-3 mb-2 shadow text-sm">
            <h3 className="font-bold mb-1">📜 {language === 'am' ? 'የቢንጎ ደንቦች' : 'Bingo Rules & Info'}</h3>
            <ul className="list-disc list-inside space-y-1">
              {getList('bingo_rules_countdown').map((rule: string, i: number) => <li key={i}>{rule}</li>)}
            </ul>
          </div>
        )}

        {currentRoom?.gameStatus === 'ended' && (
          <div className="w-full bg-yellow-400/80 text-black rounded-lg p-3 mb-2 shadow text-sm">
            <h3 className="font-bold mb-1">📜 {language === 'am' ? 'የቢንጎ ደንቦች' : 'Bingo Rules & Info'}</h3>
            <ul className="list-disc list-inside space-y-1">
              {getList('bingo_rules_ended').map((rule: string, i: number) => <li key={i}>{rule}</li>)}
            </ul>
          </div>
        )}
        {showNetworkPopup && (
  <div className="w-full bg-yellow-500 text-black text-center py-2 font-bold animate-pulse rounded mb-2 shadow-lg">
    ⚠️ Network slow or out of sync — please refresh the page.
    <button onClick={() => window.location.reload()} className="ml-2 underline">
      Refresh
    </button>
  </div>
)}


        <div className="flex flex-row gap-2">
          <button onClick={handleBingoClick} disabled={hasAttemptedBingo || isDisqualified} className={`flex-1 py-2 rounded font-bold text-sm shadow transition bg-gradient-to-r from-orange-500 to-yellow-500 hover:opacity-90 ${hasAttemptedBingo || isDisqualified ? 'opacity-50 cursor-not-allowed' : ''}`}>
            {t('bingo')}
          </button>
          
        </div>
        {gameMessage && <p>{gameMessage}</p>}
        <button onClick={() => setShowPatterns(true)} className="w-full bg-gradient-to-r from-theme-primary to-theme-secondary py-2 rounded-lg font-bold text-sm shadow hover:opacity-90 transition">
          {t('pattern')}
        </button>
        
      </div>

      {/* players footer */}
      <div className="w-full mt-6 bg-theme-light/10 rounded border border-theme-accent/30 p-3">
        <h3 className="font-bold text-sm mb-2">{t('players_in_room')}</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
          {currentRoom?.players && Object.keys(currentRoom.players || {}).length > 0 ? (
            Object.values(currentRoom.players || {}).map((player: any) => {
              const maskedUsername = player.username ? `${player.username.slice(0, 7)}***` : `user_${player.telegramId?.slice(0, 3) ?? '???'}***`;
              let bgColor = 'bg-theme-light/20';
              if ((currentRoom as any).winners?.some((w: any) => w.telegramId === player.telegramId)) bgColor = 'bg-theme-primary';
              else if (player.attemptedBingo) bgColor = 'bg-theme-secondary';

              return (
                <div key={player.id} className={`${bgColor} rounded p-2 flex flex-col items-center text-center transition`}>
                  <span className="font-semibold">{maskedUsername}</span>
                  <span className="text-xs">Bet: {player.betAmount}</span>
                </div>
              );
            })
          ) : (
            <div className="col-span-full text-center text-gray-300">No players have bet yet...</div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Room;
