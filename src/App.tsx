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
      if (!tg) {
        console.warn("Telegram WebApp not found!");
        return;
      }

      try { 
        tg.ready();   // ensure the WebApp is ready
        tg.expand();
      } catch {}

      // Keep checking until Telegram user is available
      let tgUser = tg.initDataUnsafe?.user || null;
      const startTime = Date.now();
      while (!tgUser && Date.now() - startTime < 5000) { // wait up to 5s
        await new Promise(r => setTimeout(r, 50));
        tgUser = tg.initDataUnsafe?.user || null;
      }

      if (!tgUser) {
        console.error("Telegram user not available after 5s!");
        return;
      }

      const telegramId = String(tgUser.id);
      const username = tgUser.username || tgUser.first_name || `user_${telegramId}`;
      const language = tgUser.language_code || 'am';

      // Fetch or create user in RTDB
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
