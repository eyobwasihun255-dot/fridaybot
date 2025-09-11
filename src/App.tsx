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
const Initializer: React.FC<{ initializeUser: any, user: any }> = ({ initializeUser, user }) => {

  React.useEffect(() => {
    const initUser = async () => {
      const tg = (window as any).Telegram?.WebApp;

      try {
        tg?.ready();   // initialize the WebApp
        tg?.expand();  // expand UI
      } catch {}

      // Wait for Telegram user data
      const waitForTelegramUser = (): Promise<any> => {
        return new Promise((resolve) => {
          if (tg?.initDataUnsafe?.user) {
            resolve(tg.initDataUnsafe.user);
            return;
          }
          const interval = setInterval(() => {
            if (tg?.initDataUnsafe?.user) {
              clearInterval(interval);
              resolve(tg.initDataUnsafe.user);
            }
          }, 50);

          // fallback if not available after 3s
          setTimeout(() => {
            clearInterval(interval);
            resolve(null);
          }, 3000);
        });
      };

      const tgUser = await waitForTelegramUser();

      // Use Telegram user if available
      const telegramId = tgUser?.id ? String(tgUser.id) : null;
      const username = tgUser?.username || tgUser?.first_name || null;
      const language = tgUser?.language_code || 'am';

      // Only fallback to stored user or demo if Telegram user is missing
      const finalTelegramId = telegramId ?? user?.telegramId ?? "demo123";
      const finalUsername = username ?? user?.username ?? `user_${finalTelegramId}`;

      // Fetch or create user in RTDB
      const freshUser = await getOrCreateUser({
        telegramId: finalTelegramId,
        username: finalUsername,
        language,
      });

      initializeUser(freshUser);
    };

    initUser();
  }, [initializeUser, user]);

  return null;
};



export default App;
