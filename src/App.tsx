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
        // Potentially handle this case by showing an error or fallback UI
        return;
      }

      try {
        tg.ready();
        tg.expand();
      } catch (e) {
        console.error("Error calling Telegram WebApp methods:", e);
      }

      let tgUser = tg.initDataUnsafe?.user || null;
      const maxAttempts = 60; // Try for up to 30 seconds (60 * 500ms)
      let attempts = 0;

      while (!tgUser && attempts < maxAttempts) {
        console.log(`Attempt ${attempts + 1}: Waiting for Telegram user data...`);
        await new Promise(r => setTimeout(r, 500)); // Wait for 500ms
        tgUser = tg.initDataUnsafe?.user || null;
        attempts++;
      }

      if (!tgUser) {
        console.error("Telegram user not available after multiple attempts!");
        // Fallback to a generic user or prompt the user for input
        // For now, let's use a clear indicator that data is missing
        const telegramId = 'unknown_id_' + Date.now();
        const username = 'unknown_user';
        const language = 'en'; // Default language

        const freshUser = await getOrCreateUser({
          telegramId,
          username,
          language,
        });
        initializeUser(freshUser);
        return;
      }

      const telegramId = String(tgUser.id);
      const username = tgUser.username || tgUser.first_name || `user_${telegramId}`;
      const language = tgUser.language_code || 'am';

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
