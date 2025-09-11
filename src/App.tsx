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
const Initializer: React.FC<{ initializeUser: any, user: any }> = ({ initializeUser, user }) => {
 
  React.useEffect(() => {
  const initUser = async () => {
    const tg = (window as any).Telegram?.WebApp;
    try { tg?.ready(); tg?.expand(); } catch {}

    // ✅ Secure initData string
    const initData = tg?.initData;
    const tgUser = tg?.initDataUnsafe?.user;

    if (!tgUser && !initData) {
      console.error("❌ No Telegram user info available");
      return;
    }

    // Prefer Telegram-provided identity
    if (!tgUser && !user) {
  console.warn("No Telegram user detected, skipping init.");
  return;
}
const telegramId = tgUser?.id ? String(tgUser.id) : user.telegramId;

    const username = tgUser?.username || tgUser?.first_name || user?.username || `user_${telegramId}`;
    const language = tgUser?.language_code || user?.language || "am";

    // ✅ Always fetch from RTDB
    const freshUser = await getOrCreateUser({
      telegramId,
      username,
      language,
    });

    initializeUser(freshUser);
  };

  initUser();
}, [initializeUser]);

  return null;
};


export default App;
