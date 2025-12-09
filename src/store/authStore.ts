import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { rtdb } from '../firebase/config';
import { ref, get as dbGet, onValue, off, update } from 'firebase/database';

export interface User {
  telegramId: string;
  username: string;
  balance: number;
  referral :boolean;
  gamesPlayed: number;
  gamesWon: number;
  totalWinnings: number;
  language: string;   // ✅ consistent naming
  createdAt: string;
  updatedAt: string;
}

interface AuthState {
  user: User | null;
  loading: boolean;
  initializeUser: (user: User) => void;
  reloadBalance: () => Promise<void>;
  startBalanceListener: () => void;
  stopBalanceListener: () => void;
  logout: () => void;
}

// ✅ Use persist with zustand and add reloadBalance
export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      loading: false,
      _balanceListenerRef: null ,

      initializeUser: (user) =>
        set({
          user,
          loading: false,
        }),

      // 🔄 Reload balance from Firebase
      reloadBalance: async () => {
        const user = get().user;
        if (!user) return;

        try {
          const balanceRef = ref(rtdb, `users/${user.telegramId}/balance`);
          
          const snapshot = await dbGet(balanceRef);
          const balance = snapshot.val() ?? 0;

          set({
            user: { ...user, balance },
          });
        } catch (err) {
          console.error('❌ Failed to reload balance:', err);
        }
      },

      // 🔁 Live balance subscription
      startBalanceListener: () => {
        const user = get().user;
        if (!user) return;
        const balanceRef = ref(rtdb, `users/${user.telegramId}/balance`);
        // store ref to stop later
        (get() as any)._balanceListenerRef = balanceRef;
        onValue(balanceRef, (snap) => {
          const bal = snap.val() ?? 0;
          set({ user: { ...(get().user as User), balance: bal } });
        });
      },

      stopBalanceListener: () => {
        const refObj = (get() as any)._balanceListenerRef;
        if (refObj) {
          off(refObj);
          (get() as any)._balanceListenerRef = null;
        }
      },

      logout: () => {
        (get() as any).stopBalanceListener();
        set({ user: null, loading: false });
      },
    }),
    {
      name: 'auth-storage', // The key for localStorage
      getStorage: () => localStorage, // Persist state to localStorage
    }
  ) as any // Cast to 'any' to resolve the typing error
);
