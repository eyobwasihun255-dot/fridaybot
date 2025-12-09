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

  const [referralCode, setReferralCode] = useState('');
  const [status, setStatus] = useState('');
  
  
  const { user } = useAuthStore();
  // Make sure you store user in localStorage on login

  React.useEffect(() => {
    fetchRooms();
  }, [fetchRooms]);


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
      const referralRef = ref(rtdb, `referral/${referralCode}`);
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
      {user?.noreferral === true && (
  <div className="max-w-md mx-auto mb-10 bg-white/10 p-4 rounded-lg shadow">
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
)}

      {/* ------------------------------------------ */}
{/* TELEGRAM SUPPORT BUTTON */}
{/* ------------------------------------------ */}
<div className="max-w-md mx-auto mb-10 flex justify-center">
  <a
    href="https://t.me/FridayBingoSupport"
    target="_blank"
    rel="noopener noreferrer"
    className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg shadow"
  >
    Join Telegram Support
  </a>
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
