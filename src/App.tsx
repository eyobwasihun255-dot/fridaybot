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
// App.tsx — robust Initializer
const Initializer: React.FC<{ initializeUser: any; user: any }> = ({ initializeUser, user }) => {
  const [searchParams] = useSearchParams();

  React.useEffect(() => {
    const initUser = async () => {
      try {
        console.log("[Initializer] start", { user, params: Object.fromEntries(searchParams) });

        // 1) If we already have a hydrated user from the store -> refresh from DB
        if (user?.telegramId) {
          console.log("[Initializer] using existing store user:", user.telegramId);
          const fresh = await getOrCreateUser({
            telegramId: user.telegramId,
            username: user.username,
            lang: user.lang ?? "am",
          });
          initializeUser(fresh);
          return;
        }

        // 2) Try query params (works when Telegram redirects with params)
        const paramsObj = Object.fromEntries(searchParams.entries()); // e.g. { id, hash, username, auth_date ... }
        let candidateId = paramsObj.id ?? undefined;
        let verified = false;
        let verData: any = {};

        if (Object.keys(paramsObj).length) {
          // send all params to verify endpoint (server will choose verification method)
          const resp = await fetch(`/api/verifyUser?${searchParams.toString()}`);
          const data = await resp.json();
          console.log("[Initializer] verifyUser result:", data);
          if (data.valid) {
            verified = true;
            candidateId = data.id ?? candidateId;
            verData = data;
          }
        }

        // 3) If still no candidate from searchParams, check Telegram WebApp initData (in-app browser)
        if (!candidateId && typeof window !== "undefined" && (window as any).Telegram?.WebApp) {
          const t = (window as any).Telegram.WebApp;
          const initData = t.initData || t.initDataUnsafe?.rawInitData || null;
          if (initData) {
            // initData is a query-string style string e.g. "id=...&auth_date=...&hash=..."
            const parsed = Object.fromEntries(new URLSearchParams(initData));
            console.log("[Initializer] Telegram WebApp initData parsed:", parsed);
            if (Object.keys(parsed).length) {
              const resp = await fetch(`/api/verifyUser?${new URLSearchParams(parsed).toString()}`);
              const data = await resp.json();
              console.log("[Initializer] verifyUser via WebApp result:", data);
              if (data.valid) {
                verified = true;
                candidateId = data.id ?? candidateId;
                verData = data;
              }
            }
          }
        }

        // 4) If we have a candidateId (either verified or from params), use it
        if (candidateId) {
          console.log("[Initializer] candidateId found:", candidateId, { verified, verData });
          // If not verified but we have an id (rare), you might still want to call getOrCreateUser,
          // but better to require server verification in production.
          const freshUser = await getOrCreateUser({
            telegramId: String(candidateId),
            username: verData.username || paramsObj.username || `user_${candidateId}`,
            lang: verData.lang || "am",
          });
          initializeUser(freshUser);
          return;
        }

        // 5) NO candidateId and no hydrated user => DO NOT immediately create demo user.
        // Return early, show guest UI. If you want demo behavior, require explicit ?demo=1.
        console.log("[Initializer] no candidateId and no hydrated user — skipping demo fallback.");
        // Optionally: if you want demo fallback only when ?demo=1 present:
        if (searchParams.get("demo") === "1") {
          const demo = await getOrCreateUser({
            telegramId: "demo123",
            username: "demo_user",
            lang: "am",
          });
          initializeUser(demo);
        }
      } catch (err) {
        console.error("[Initializer] initUser error:", err);
      }
    };

    // IMPORTANT: include `user` so effect re-runs when zustand persistence hydrates on mobile.
    initUser();
  }, [initializeUser, searchParams, user]);

  return null;
};



export default App;
