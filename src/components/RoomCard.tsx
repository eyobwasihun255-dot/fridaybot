import React, { useEffect, useState } from 'react';
import { Users, Coins, Play } from 'lucide-react';
import { useLanguageStore } from '../store/languageStore';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';

interface Room {
  id: string;
  name: string;
  betAmount: number;
  maxPlayers: number;
  gameStatus: string;
  isDemoRoom?: boolean;
  countdownEndAt: number;
  claimedCards?: { [cardId: string]: any }; // new structure
}

interface RoomCardProps {
  room: Room;
}

const RoomCard: React.FC<RoomCardProps> = ({ room }) => {
  const { t } = useLanguageStore();
  const navigate = useNavigate();
  const { user } = useAuthStore.getState();

  const [timeLeft, setTimeLeft] = useState(0);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'playing':
        return 'text-theme-light';
      case 'waiting':
        return 'text-theme-accent';
      case 'countdown':
        return 'text-theme-light';
      default:
        return 'text-gray-300';
    }
  };

  const handleJoinRoom = () => {
    navigate(`/room/${room.id}`);
  };

  const getBillboardImage = () => {
    switch (room.betAmount) {
      case 20:
        return '/images/starter.webp';
      case 50:
        return '/images/silver.jpg';
      case 100:
        return '/images/golden.jpg';
      case 200:
        return '/images/royal.webp';
      default:
        return '/images/demo.jpg';
    }
  };

  // ✅ Check if current user claimed a card
  const hasClaimedCard =
    room.claimedCards &&
    user &&
    Object.values(room.claimedCards).some(card => card.claimedBy === user.telegramId);

  // ✅ Count unique players
  const uniquePlayers = room.claimedCards
    ? new Set(Object.values(room.claimedCards).map(card => card.claimedBy))
    : new Set();

  const playerCount = uniquePlayers.size;

  // ✅ Calculate payout
  const payout =
    !room.isDemoRoom && playerCount > 1
      ? Math.max(0, Math.floor(playerCount * room.betAmount * 0.8))
      : 0;

  // Countdown timer
  useEffect(() => {
    if (room.gameStatus === 'countdown' && room.countdownEndAt) {
      const updateTimer = () => {
        const now = Date.now();
        const diff = Math.max(0, Math.floor((room.countdownEndAt - now) / 1000)); // seconds
        setTimeLeft(diff);
      };

      updateTimer();
      const interval = setInterval(updateTimer, 1000);
      return () => clearInterval(interval);
    }
  }, [room.gameStatus, room.countdownEndAt]);

  const formatTime = (seconds: number) => {
    const m = String(Math.floor(seconds / 60)).padStart(2, '0');
    const s = String(seconds % 60).padStart(2, '0');
    return `${m}:${s}`;
  };

  return (
    <div
      className={`relative rounded-xl overflow-hidden border border-white/20 shadow-lg hover:scale-105 transition-all duration-300
        ${hasClaimedCard ? 'animate-green-blink' : ''}`}
      style={{
        backgroundImage: `url(${getBillboardImage()})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }}
    >
      <div className="absolute inset-0 bg-black/50" />

      <div className="relative p-6 flex flex-col justify-between h-full">
        <div className="flex items-center justify-between mb-4 space-x-3">
          <h3 className="text-white font-bold text-xl flex items-center space-x-2">
            <span>{room.name}</span>
            {!room.isDemoRoom && (
              <span className="bg-yellow-400 text-black font-bold px-3 py-1 rounded-full shadow-lg animate-pulse">
                {Number(room.betAmount ?? 0).toFixed(2)} {t('etb')}
              </span>
            )}
          </h3>
          {room.isDemoRoom && (
            <span className="bg-green-500 text-white text-xs px-2 py-1 rounded-full shadow-md">
              {t('free_play')}
            </span>
          )}
        </div>

        <div className="space-y-3 mb-6">
          <div className="flex items-center justify-between">
            <span className="text-white/80">{t('players')}:</span>
            <div className="flex items-center space-x-1">
              <Users className="w-4 h-4 text-theme-accent" />
              <span className="text-white">
                {playerCount}/{room.maxPlayers}
              </span>
            </div>
          </div>

          <div className="flex items-center justify-between" id="gamestatus">
            <span className="text-white/80">{t('status')}:</span>
            <span
              className={`font-medium ${
                room.gameStatus === 'playing'
                  ? 'bg-red-400 text-black font-bold px-3 py-1 rounded-full shadow-lg animate-pulse'
                  : getStatusColor(room.gameStatus)
              }`}
            >
              {t(room.gameStatus)}
              {room.gameStatus === 'countdown' && timeLeft > 0 && (
                <span className="ml-2 bg-red-400 px-2 py-1 rounded">{formatTime(timeLeft)}</span>
              )}
            </span>
          </div>

          {!room.isDemoRoom && (
            <div className="flex items-center justify-between">
              <span className="text-white/80">{t('payout')}:</span>
              <div className="flex items-center space-x-1">
                <Coins className="w-4 h-4 text-theme-light" />
                <span className="text-theme-light font-bold">
                  {payout} {t('etb')}
                </span>
              </div>
            </div>
          )}
        </div>

        <button
          onClick={handleJoinRoom}
          className="w-full bg-gradient-to-r from-theme-primary to-theme-secondary hover:from-theme-secondary hover:to-theme-accent text-white font-bold py-3 px-4 rounded-lg transition-all duration-200 flex items-center justify-center space-x-2 shadow-md hover:shadow-xl"
        >
          <Play className="w-4 h-4" />
          <span>{t('join_room')}</span>
        </button>
      </div>

      <style>
        {`
          @keyframes green-blink {
            0%, 100% { box-shadow: 0 0 20px 4px rgba(0,255,0,0.7); }
            50% { box-shadow: 0 0 40px 10px rgba(0,255,0,1); }
          }
          .animate-green-blink {
            animation: green-blink 1.2s infinite;
            border-color: #00ff00;
          }
        `}
      </style>
    </div>
  );
};

export default RoomCard;
