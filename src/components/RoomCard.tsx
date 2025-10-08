import React from 'react';
import { Users, Coins, Play } from 'lucide-react';
import { useLanguageStore } from '../store/languageStore';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { useEffect, useState } from 'react';
interface Room {
  id: string;
  name: string;
  betAmount: number;
  maxPlayers: number;
  players: { [id: string]: any } | number; // could be number or object
  gameStatus: string;
  isDemoRoom?: boolean;
  countdownEndAt : number;
}

interface RoomCardProps {
  room: Room;
}

const RoomCard: React.FC<RoomCardProps> = ({ room }) => {
  const { t } = useLanguageStore();
  const navigate = useNavigate();
  const { user } = useAuthStore.getState();

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

  // ✅ Check if current user claimed a card in this room
  const hasClaimedCard =
    room.players &&
    typeof room.players === 'object' &&
    user &&
    room.players[user.telegramId];

  // ✅ Calculate payout
  const playerCount =
    room.players && typeof room.players === 'object'
      ? Object.keys(room.players).length
      : 0;

  const payout =
    !room.isDemoRoom && playerCount > 1
      ? Math.max(0, Math.floor((playerCount ) * room.betAmount * 0.9))
      : 0;
      const [timeLeft, setTimeLeft] = useState(0);

useEffect(() => {
        if (room.gameStatus === "countdown" && room.countdownEndAt) {
          const updateTimer = () => {
            const now = new Date().getTime();
            const endTime = new Date(room.countdownEndAt).getTime();
            const diff = Math.max(0, Math.floor((endTime - now) / 1000)); // in seconds
            setTimeLeft(diff);
          };
    
          updateTimer(); // initial call
          const interval = setInterval(updateTimer, 1000);
    
          return () => clearInterval(interval); // cleanup
        }
      }, [room.gameStatus, room.countdownEndAt]);
      const formatTime = (seconds) => {
        const m = String(Math.floor(seconds / 60)).padStart(2, "0");
        const s = String(seconds % 60).padStart(2, "0");
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
      {/* Dark overlay */}
      <div className="absolute inset-0 bg-black/50" />

      {/* Content */}
      <div className="relative p-6 flex flex-col justify-between h-full">
        <div className="flex items-center justify-between mb-4 space-x-3">
          {/* Room Name */}
          <h3 className="text-white font-bold text-xl flex items-center space-x-2">
            <span>{room.name}</span>

            {/* Bet Amount Badge */}
            {!room.isDemoRoom && (
              <span className="bg-yellow-400 text-black font-bold px-3 py-1 rounded-full shadow-lg animate-pulse">
                {Number(room.betAmount ?? 0).toFixed(2)} {t('etb')}
              </span>
            )}
          </h3>

          {/* Demo Room Badge */}
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

          <div className="flex items-center justify-between">
      <span className="text-white/80">{t("status")}:</span>
      <span className={`font-medium ${getStatusColor(room.gameStatus)}`}>
        {t(room.gameStatus)}
        {room.gameStatus === "countdown" && timeLeft > 0 && (
          <span className="ml-2 bg-red-400">{formatTime(timeLeft)}</span>
        )}
      </span>
    </div>


          {/* ✅ Payout Display */}
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

      {/* ✅ Tailwind Keyframes for green blinking */}
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
