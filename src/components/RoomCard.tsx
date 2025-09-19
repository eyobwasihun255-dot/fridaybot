import React from 'react';
import { Users, Coins, Play } from 'lucide-react';
import { useLanguageStore } from '../store/languageStore';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';

interface Room {
  id: string;
  name: string;
  betAmount: number;
  maxPlayers: number;
  players: { [id: string]: any } | number; // could be number or object
  gameStatus: string;
  isDemoRoom?: boolean;
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
        return 'text-green-300';
      case 'waiting':
        return 'text-yellow-300';
      case 'countdown':
        return 'text-blue-300';
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
              <Users className="w-4 h-4 text-blue-300" />
              <span className="text-white">
                {room.players && typeof room.players === 'object'
                  ? Object.keys(room.players).length
                  : 0}
                /{room.maxPlayers}
              </span>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-white/80">{t('status')}:</span>
            <span className={`font-medium ${getStatusColor(room.gameStatus)}`}>
              {t(room.gameStatus)}
            </span>
          </div>
        </div>

        <button
          onClick={handleJoinRoom}
          className="w-full bg-gradient-to-r from-purple-500 to-blue-500 hover:from-purple-600 hover:to-blue-600 text-white font-bold py-3 px-4 rounded-lg transition-all duration-200 flex items-center justify-center space-x-2 shadow-md hover:shadow-xl"
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
