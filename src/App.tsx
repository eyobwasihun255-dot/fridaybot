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
        let telegramId = user?.telegramId || undefined;
        let username = user?.username || undefined;
        let lang = "am"; // Default language

        const userId = searchParams.get("id");
        const hash = searchParams.get("hash");
        const usernameParam = searchParams.get("username");

        // ✅ If userId + hash are provided, verify with backend
        if (userId && hash) {
          try {
            const res = await fetch(`/api/verifyUser?${searchParams.toString()}`);
            const data = await res.json();

            if (data.valid) {
              telegramId = data.id;
              username = data.username || usernameParam || `user_${telegramId}`;
              lang = "am"; // You can add language parameter if needed
            } else {
              console.warn("Telegram verification failed, using provided parameters");
              // Still try to use provided parameters even if verification fails
              telegramId = userId;
              username = usernameParam || `user_${telegramId}`;
            }
          } catch (verifyError) {
            console.error("Verification request failed:", verifyError);
            // Fallback to provided parameters
            telegramId = userId;
            username = usernameParam || `user_${telegramId}`;
          }
        }

        // ✅ Only fallback to demo if still nothing
        if (!telegramId) {
          telegramId = "demo123";
          username = "demo_user";
        }

        // ✅ Always fetch from RTDB
        const freshUser = await getOrCreateUser({
          telegramId,
          username: username!,
          lang,
        });

        initializeUser(freshUser);
      } catch (err) {
        console.error("Failed to init user:", err);
        // Fallback to demo user on complete failure
        const demoUser = await getOrCreateUser({
          telegramId: "demo123",
          username: "demo_user",
          lang: "am",
        });
        initializeUser(demoUser);
      }
    };

    initUser();
  }, [initializeUser, searchParams]);

  return null;
};



export default App;
