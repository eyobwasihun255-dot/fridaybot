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
// Wait for WebApp initialization before reading the user
const waitForTelegramUser = async (): Promise<any> => {
  return new Promise((resolve) => {
    const check = () => {
      const user = window.Telegram?.WebApp?.initDataUnsafe?.user;
      if (user) {
        console.log("Telegram user found:", user);
        resolve(user);
      } else {
        console.log("Waiting for Telegram user...");
        setTimeout(check, 100); // retry every 100ms
      }
    };
    check();
    setTimeout(() => resolve(null), 5000); // give up after 5s
  });
};

// 🔑 Separate hook into a child component inside Router
// 🔑 Separate hook into a child component inside Router
const Initializer: React.FC<InitializerProps> = ({ initializeUser, user }) => {
  const [searchParams] = useSearchParams();

  React.useEffect(() => {
    const initUser = async () => {
      try {
        let telegramId = user?.telegramId;
        let username = user?.username;
        let language = user?.language || "en";

        // TODO: add URL param + Telegram WebApp logic here
        // (same as I showed you earlier)

      if (!telegramId && window.Telegram?.WebApp) {
  window.Telegram.WebApp.ready();
  const tgUser = await waitForTelegramUser();
  if (tgUser) {
    telegramId = tgUser.id?.toString();
    username = tgUser.username || `user_${telegramId}`;
    language = tgUser.language_code || "en";
  }
}

// ✅ Only fallback if still nothing
if (!telegramId) {
  console.warn("Falling back to demo user!");
  telegramId = "demo123";
  username = "demo_user";
  language = "en";
}


        const freshUser = await getOrCreateUser({
          telegramId,
          username,
          language,
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
