import React from 'react';
import { Users, Coins, Play } from 'lucide-react';
import { useLanguageStore } from '../store/languageStore';
import { useNavigate } from 'react-router-dom';

interface Room {
  id: string;
  name: string;
  betAmount: number;
  maxPlayers: number;
  players: number;
  status: string;
  isDemoRoom?: boolean;
}

interface RoomCardProps {
  room: Room;
}

const RoomCard: React.FC<RoomCardProps> = ({ room }) => {
  const { t } = useLanguageStore();
  const navigate = useNavigate();

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'text-green-300';
      case 'waiting':
        return 'text-yellow-300';
      case 'in_progress':
        return 'text-blue-300';
      default:
        return 'text-gray-300';
    }
  };

  const handleJoinRoom = () => {
    navigate(`/room/${room.id}`);
  };

  // 🎯 Choose billboard image based on betAmount
  const getBillboardImage = () => {
    switch (room.betAmount) {
      case 20:
        return '/images/starter.webp';   // Starter’s Luck
      case 50:
        return '/images/silver.jpg';    // Silver Spin
      case 100:
        return '/images/golden.jpg';    // Golden Jackpot
      case 200:
        return '/images/royal.webp';     // Royal Bingo
      default:
        return '/images/demo.jpg';
    }
  };

  return (
    <div
      className="relative rounded-xl overflow-hidden border border-white/20 shadow-lg hover:scale-105 transition-all duration-300"
      style={{
        backgroundImage: `url(${getBillboardImage()})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }}
    >
      {/* Dark overlay for readability */}
      <div className="absolute inset-0 bg-black/50" />

      {/* Content */}
      <div className="relative p-6 flex flex-col justify-between h-full">
        <div className="flex items-center justify-between mb-4 space-x-3">
  {/* Room Name */}
  <h3 className="text-white font-bold text-xl flex items-center space-x-2">
    <span>{room.name}</span>

    {/* 🔥 Bet Amount Badge */}
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
      {room.players ? Object.keys(room.players).length : 0}/{room.maxPlayers}
    </span>
  </div>
</div>


          <div className="flex items-center justify-between">
            <span className="text-white/80">{t('status')}:</span>
            <span className={`font-medium ${getStatusColor(room.status)}`}>
              {t(room.status)}
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
    </div>
  );
};

export default RoomCard;
