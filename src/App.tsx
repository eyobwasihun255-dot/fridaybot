import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { useAuthStore } from './store/authStore';
import { useLanguageStore } from './store/languageStore';
import Landing from './pages/Landing';
import Room from './pages/Room';
import Header from './components/Header';
import LoadingSpinner from './components/LoadingSpinner';
import './firebase/config';
import { getOrCreateUser } from './services/firebaseApi';
import { useSearchParams } from "react-router-dom";

function App() {
  const { user, loading, initializeUser } = useAuthStore();
  const { language } = useLanguageStore();

  return (
    <Router>
      <Initializer initializeUser={initializeUser} user={user} />
      {loading ? (
        <LoadingSpinner />
      ) : (
        <div className="min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-800">
          <Header />
          <main className="pt-20">
            <Routes>
              <Route path="/" element={<Landing />} />
              <Route path="/room/:roomId" element={<Room />} />
            </Routes>
          </main>
        </div>
      )}
    </Router>
  );
}

// 🔑 Separate hook into a child component inside Router
// 🔑 Separate hook into a child component inside Router
const Initializer: React.FC<InitializerProps> = ({ initializeUser, user }) => {
  const [searchParams] = useSearchParams();

  React.useEffect(() => {
    const initUser = async () => {
      try {
        let telegramId = user?.telegramId;
        let username = user?.username;
        let lang = user?.lang || "am";

        // 1️⃣ Try URL params first (PC / web)
        const userId = searchParams.get("id");
        const sig = searchParams.get("sig");
        if (userId && sig) {
          const res = await fetch(`/api/verifyUser?${searchParams.toString()}`);
          const data = await res.json();

          if (data.valid) {
            telegramId = data.id;
            username = data.username || `user_${telegramId}`;
            lang = data.lang || "am";
          }
        }
        // 2️⃣ Fallback: Telegram WebApp (iOS & Android)
        else if (window.Telegram?.WebApp?.initDataUnsafe?.user) {
          const tgUser = window.Telegram.WebApp.initDataUnsafe.user;
          telegramId = tgUser.id?.toString();
          username = tgUser.username || `user_${telegramId}`;
          lang = tgUser.language_code || "am";
        }

        // 3️⃣ Last fallback: demo user
        if (!telegramId) {
          telegramId = "demo123";
          username = "demo_user";
        }

        // ✅ Fetch or create user from RTDB
        const freshUser = await getOrCreateUser({
          telegramId,
          username,
          lang,
        });

        initializeUser(freshUser);
      } catch (err) {
        console.error("Failed to init user:", err);
      }
    };

    initUser();
  }, [initializeUser, searchParams, user]);

  return null;
};




export default App;
