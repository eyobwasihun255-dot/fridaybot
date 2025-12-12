import React, { useState } from 'react';
import { useLanguageStore } from '../store/languageStore';
import { useGameStore } from '../store/gameStore';
import RoomCard from '../components/RoomCard';
import { ref, get, update } from 'firebase/database';
import { rtdb } from '../firebase/config';

import { useAuthStore } from '../store/authStore';
const Landing: React.FC = () => {
  const { t } = useLanguageStore();
  const { rooms, fetchRooms } = useGameStore();
  const [leaderboardOpen, setLeaderboardOpen] = useState(false);
const [leaders, setLeaders] = useState<any[]>([]);
const [loadingLeaders, setLoadingLeaders] = useState(false);

  const [referralCode, setReferralCode] = useState('');
  const [status, setStatus] = useState('');
  
  
  const { user } = useAuthStore();
  // Make sure you store user in localStorage on login

  React.useEffect(() => {
    fetchRooms();
  }, [fetchRooms]);
 
  const loadLeaderboard = async () => {
    setLeaderboardOpen(true);
    setLoadingLeaders(true);
  
    try {
      const usersRef = ref(rtdb, "users");
      const snap = await get(usersRef);
  
      if (snap.exists()) {
        const data = Object.values(snap.val());
  
        // sort by game wins desc & take top 20
        const sorted = data
          .filter((u: any) => u.gamesWon > 0)
          .sort((a: any, b: any) => (b.gamesWon || 0) - (a.gamesWon || 0))
          .slice(0, 20);
  
        setLeaders(sorted);
      }
    } catch (e) {
      console.error("Leaderboard fetch error", e);
    }
  
    setLoadingLeaders(false);
  };
  

  // -------------------------------
  // HANDLE REFERRAL SUBMISSION
  // -------------------------------
  const handleSendReferral = async () => {
    try {
      if (!referralCode.trim()) {
        setStatus("Enter referral code");
        return;
      }

      const userId = user?.telegramId;
      if (!userId) {
        setStatus("User not logged in");
        return;
      }

      // Read current user's profile
      const userRef = ref(rtdb, `users/${userId}`);
      const userSnap = await get(userRef);
      const userData = userSnap.val();

      if (!userData) {
        setStatus("User data missing");
        return;
      }

      if (userData.noreferral === false) {
        setStatus("Referral already used");
        return;
      }

      // Check referral target
      const referralRef = ref(rtdb, `referrals/${referralCode}`);
      const referralSnap = await get(referralRef);

      if (!referralSnap.exists()) {
        setStatus("Invalid referral code");
        return;
      }

      const ownerUserId = referralSnap.val().userId;

      // Apply bonuses
      await update(userRef, {
        balance: (userData.balance || 0) + 10,
        noreferral: false
      });

      // Give owner 5 birr
      const ownerRef = ref(rtdb, `users/${ownerUserId}`);
      const ownerSnap = await get(ownerRef);
      const ownerData = ownerSnap.val();

      if (ownerData) {
        await update(ownerRef, {
          balance: (ownerData.balance || 0) + 5
        });
      }

      setStatus("Referral applied!");

    } catch (err) {
      console.error(err);
      setStatus("Error applying referral");
    }
  };



  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      {/* Hero Section */}
      <div className="text-center mb-12">
      
        <h1 className="text-4xl md:text-6xl font-bold text-white">
          {t('friday_bingo')}
        </h1>
        <p className="text-xl text-white/80 mb-8 max-w-2xl mx-auto">
          {t('welcome')}
        </p>
      </div>


      {/* ------------------------------------------ */}
      {/* REFERRAL INPUT FIELD */}
      {/* ------------------------------------------ */}

  <div className="max-w-md mx-auto mb-6 bg-white/10 p-2 rounded-lg shadow">
    <h3 className="text-white font-bold mb-2">Enter Referral Code</h3>

    <div className="flex space-x-2">
      <input
        type="text"
        value={referralCode}
        onChange={(e) => setReferralCode(e.target.value)}
        placeholder="Referral code"
        className="flex-1 px-3 py-2 rounded bg-black/30 text-white border border-white/20"
      />
      <button
        onClick={handleSendReferral}
        className="px-4 py-2 bg-green-600 text-white font-bold rounded hover:bg-green-700"
      >
        {t("send")}
      </button>
    </div>

    {status && <p className="text-sm text-white mt-2">{status}</p>}
  </div>


      {/* ------------------------------------------ */}
{/* TELEGRAM SUPPORT BUTTON */}
{/* ------------------------------------------ */}




      {/* Rooms Section */}
      <div className="mb-8">
      <h2 className="text-2xl font-bold text-white mb-6 flex items-center space-x-3">
  <span>{t('available_rooms')}</span>

  {/* Room count badge */}
  <span className="bg-white/20 text-sm px-3 py-1 rounded-full">
    {rooms.length}
  </span>

  {/* Support Button same size as span */}
  <a
    href="https://t.me/FridayBingoSupport"
    target="_blank"
    rel="noopener noreferrer"
    className="text-sm bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded-full font-semibold"
  >
    Support
  </a>

  {/* Leaderboard Button same size */}
  <button
    onClick={loadLeaderboard}
    className="text-sm bg-yellow-500 hover:bg-yellow-600 text-black px-3 py-1 rounded-full font-semibold"
  >
    🏆
  </button>
</h2>
{leaderboardOpen && (
  <div className="fixed inset-0 bg-black/70 flex justify-center items-center z-50">
    <div className="w-96 bg-gray-900 text-white rounded-lg p-6 shadow-lg relative">

      <h2 className="text-xl font-bold mb-4 text-center">🏆 Top Players</h2>

      <button
        className="absolute top-3 right-4 text-red-400 text-lg"
        onClick={() => setLeaderboardOpen(false)}
      >
        ✖
      </button>

      {loadingLeaders ? (
        <p className="text-center py-4">Loading...</p>
      ) : leaders.length === 0 ? (
        <p className="text-center py-4">No players with wins yet</p>
      ) : (
        <ul className="space-y-2 max-h-80 overflow-y-auto">
          {leaders.map((u, i) => (
            <li
              key={i}
              className="bg-white/10 p-2 rounded flex justify-between pr-3"
            >
              <span>#{i + 1} {u.username || u.telegramId}</span>
              <span>Wins: {u.gamesWon || 0}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  </div>
)}


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
