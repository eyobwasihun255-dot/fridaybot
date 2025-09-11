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
        // 🔹 Start loading
        useAuthStore.setState({ loading: true });

        // 1) Wait for persisted user to exist
        if (user?.telegramId) {
          console.log("[Initializer] using persisted user", user);
          const fresh = await getOrCreateUser({
            telegramId: user.telegramId,
            username: user.username,
            lang: user.lang ?? "am",
          });
          initializeUser(fresh);
          return;
        }

        let telegramId: string | undefined;
        let username: string | undefined;
        let lang = "am";

        // 2) Check URL params first (id + sig or hash)
        const paramsObj = Object.fromEntries(searchParams.entries());
        if (Object.keys(paramsObj).length) {
          const res = await fetch(`/api/verifyUser?${searchParams.toString()}`);
          const data = await res.json();
          if (data.valid) {
            telegramId = data.id;
            username = data.username || `user_${telegramId}`;
            lang = user?.lang || "am";
            console.log("[Initializer] verified from URL params", data);
          }
        }

        // 3) Check Telegram WebApp initData / initDataUnsafe
        if (!telegramId && typeof window !== "undefined" && (window as any).Telegram?.WebApp) {
          const t = (window as any).Telegram.WebApp;
          const initData = t.initData || t.initDataUnsafe?.rawInitData;
          if (initData) {
            const parsed = Object.fromEntries(new URLSearchParams(initData));
            const res = await fetch(`/api/verifyUser?${new URLSearchParams(parsed).toString()}`);
            const data = await res.json();
            if (data.valid) {
              telegramId = data.id;
              username = data.username || `user_${telegramId}`;
              lang = user?.lang || "am";
              console.log("[Initializer] verified from WebApp initData", data);
            }
          }
        }

        // 4) Only fallback to demo if nothing found
        if (!telegramId) {
          console.log("[Initializer] No verified user found, using demo");
          telegramId = "demo123";
          username = "demo_user";
        }

        // 5) Always fetch from RTDB
        const freshUser = await getOrCreateUser({ telegramId, username: username!, lang });
        initializeUser(freshUser);
      } catch (err) {
        console.error("[Initializer] initUser error:", err);
      } finally {
        // 🔹 Stop loading even if error
        useAuthStore.setState({ loading: false });
      }
    };

    initUser();
  }, [initializeUser, searchParams, user]); // ✅ include `user` to handle persisted store
  return null;
};




export default App;
