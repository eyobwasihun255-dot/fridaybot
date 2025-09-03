import React from 'react';
import { Trophy, Users, Sparkles } from 'lucide-react';
import { useLanguageStore } from '../store/languageStore';
import { useGameStore } from '../store/gameStore';
import RoomCard from '../components/RoomCard';

const Landing: React.FC = () => {
  const { t } = useLanguageStore();
  const { rooms, fetchRooms } = useGameStore();

  React.useEffect(() => {
    fetchRooms();
  }, [fetchRooms]);


  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      {/* Hero Section */}
      <div className="text-center mb-12">
        <div className="flex items-center justify-center space-x-3 mb-4">
          
          <h1 className="text-4xl md:text-6xl font-bold text-white">
            {t('friday_bingo')}
          </h1>
        </div>
        
        <p className="text-xl text-white/80 mb-8 max-w-2xl mx-auto">
          {t('welcome')}
        </p>
        
        
      </div>

      {/* Rooms Section */}
      <div className="mb-8">
       <h2 className="text-2xl font-bold text-white mb-6 flex items-center space-x-2">
  <span>{t('available_rooms')}</span>
  <span className="bg-white/20 text-sm px-2 py-1 rounded-full">
    {rooms.length}
  </span>
</h2>

<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
  {rooms.map((room) => (
    <RoomCard key={room.id} room={room} />
  ))}
</div>

      </div>

   
    </div>
  );
};

export default Landing;