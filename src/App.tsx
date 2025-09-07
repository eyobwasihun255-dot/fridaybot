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
const Initializer: React.FC<{ initializeUser: any, user: any }> = ({ initializeUser, user }) => {
  const [searchParams] = useSearchParams();

  React.useEffect(() => {
    const initUser = async () => {
      const userId = searchParams.get("id");
      const sig = searchParams.get("sig");

      let telegramId = userId ?? user?.telegramId ?? "demo123";
      let username = user?.username ?? `user_${telegramId}`;
      let language = user?.language ?? "am";

      // ✅ If telegramId + sig is provided, verify
      if (userId && sig) {
        const res = await fetch(`/api/verifyUser?id=${userId}&sig=${sig}`);
        const data = await res.json();
        if (!data.valid) {
          telegramId = "demo123";
          username = "demo_user";
        }
      }

      // ✅ Always fetch from RTDB to get fresh balance
      const freshUser = await getOrCreateUser({
        telegramId,
        username,
        language,
      });

      initializeUser(freshUser);
    };

    initUser();
  }, [initializeUser, searchParams]);

  return null;
};


export default App;
