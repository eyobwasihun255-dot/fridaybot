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
const Initializer: React.FC<{ initializeUser: any; user: any }> = ({ initializeUser, user }) => {
  const [searchParams] = useSearchParams();

  React.useEffect(() => {
    const initUser = async () => {
      try {
        let telegramId = user?.telegramId || null;
        let username = user?.username || null;
        let lang = user?.lang || "am";

        const userId = searchParams.get("id");
        const sig = searchParams.get("sig");

        // If userId + sig is provided, verify with backend
        if (userId && sig) {
          const res = await fetch(`/api/verifyUser?id=${userId}&sig=${sig}`);
          const data = await res.json();

          if (data.valid) {
            telegramId = userId;
            username = data.username || `user_${telegramId}`;
            lang = data.lang || lang;
          }
        }

        // If still no telegramId, fallback
        if (!telegramId) {
          telegramId = "demo123";
          username = "demo_user";
        }

        // Always fetch the latest user from RTDB
        const freshUser = await getOrCreateUser({
          telegramId,
          username: username!,
          lang,
        });

        initializeUser(freshUser);
      } catch (err) {
        console.error("Failed to init user:", err);
      }
    };

    initUser();
  }, [initializeUser, searchParams]);

  return null;
};


export default App;
