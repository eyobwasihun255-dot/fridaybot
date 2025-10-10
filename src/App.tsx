import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store/authStore';
import { useLanguageStore } from './store/languageStore';
import Landing from './pages/Landing';
import Room from './pages/Room';
import Header from './components/Header';
import LoadingSpinner from './components/LoadingSpinner';
import './firebase/config';
import { getOrCreateUser } from './services/firebaseApi';

function App() {
  const { user, loading, initializeUser } = useAuthStore();
  const { language } = useLanguageStore();

  return (
    <Router>
      <Initializer initializeUser={initializeUser} user={user} />
      {loading ? (
        <LoadingSpinner />
      ) : (
        <div className="min-h-screen bg-gradient-to-br from-theme-primary via-theme-secondary to-theme-accent">
          <Header />
          <main className="pt-20">
            <Routes>
              <Route path="/" element={<Landing />} />
              <Route path="/room/:roomId" element={<Room />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>
        </div>
      )}
    </Router>
  );
}

// 🔑 Separate hook into a child component inside Router
// 🔑 Separate hook into a child component inside Router
const Initializer: React.FC<{ initializeUser: any, user: any }> = ({ initializeUser, user }) => {

  
React.useEffect(() => {
  const initUser = async () => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get("id");
    const sig = params.get("sig");

    if (id && sig) {
      // 🔐 Verify with backend API
      const res = await fetch(`/api/verifyUser?id=${id}&sig=${sig}`);
      const { valid } = await res.json();

      if (!valid) {
        console.error("❌ Invalid Telegram signature!");
        return;
      }

      // ✅ Use verified Telegram ID
      const telegramId = id;
      const username = `user_${telegramId}`; // fallback, real name is already in RTDB
      const language = "am";

      const freshUser = await getOrCreateUser({
        telegramId,
        username,
        language,
      });

      initializeUser(freshUser);
      return;
    }

    // fallback: try Telegram WebApp context
    const tg = (window as any).Telegram?.WebApp;
    const tgUser = tg?.initDataUnsafe?.user;
    if (tgUser) {
      const telegramId = String(tgUser.id);
      const username = tgUser.username || tgUser.first_name || `user_${telegramId}`;
      const language = tgUser.language_code || "am";

      const freshUser = await getOrCreateUser({
        telegramId,
        username,
        language,
      });

      initializeUser(freshUser);
    }
  
  };

  initUser();
}, [initializeUser]);

  return null;
};


export default App;
