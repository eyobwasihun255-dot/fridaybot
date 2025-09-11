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
const waitForTelegramUser = (): Promise<any> => {
  return new Promise((resolve) => {
    if ((window as any).Telegram?.WebApp?.initDataUnsafe?.user) {
      resolve((window as any).Telegram.WebApp.initDataUnsafe.user);
      return;
    }
    const interval = setInterval(() => {
      const user = (window as any).Telegram?.WebApp?.initDataUnsafe?.user;
      if (user) {
        clearInterval(interval);
        resolve(user);
      }
    }, 50);
    setTimeout(() => {
      clearInterval(interval);
      resolve(null); // fallback if WebApp fails
    }, 3000);
  });
};



// 🔑 Separate hook into a child component inside Router
// 🔑 Separate hook into a child component inside Router
const Initializer: React.FC<{ initializeUser: any, user: any }> = ({ initializeUser, user }) => {
 
  React.useEffect(() => {
    const initUser = async () => {
      const tg = (window as any).Telegram?.WebApp;
      try { tg?.ready(); tg?.expand(); } catch {}
  
      const tgUser = await waitForTelegramUser();
  
      // If Telegram user exists, use their id
      let telegramId = tgUser?.id ? String(tgUser.id) : null;
      let username = tgUser?.username || tgUser?.first_name || null;
      let language = tgUser?.language_code || 'am';
  
      // Only fallback to demo if no Telegram user
      if (!telegramId) {
        telegramId = user?.telegramId ?? "demo123";
        username = user?.username ?? `user_${telegramId}`;
      }
  
      // Fetch or create in RTDB
      const freshUser = await getOrCreateUser({
        telegramId,
        username,
        language,
      });
  
      initializeUser(freshUser);
    };
  
    initUser();
  }, [initializeUser, user]);
  
  
  return null;
};


export default App;
