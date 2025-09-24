import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { rtdb } from '../firebase/config';
import { ref, get as dbGet, onValue, off } from 'firebase/database';

export interface User {
  telegramId: string;
  username: string;
  balance: number;
  gamesPlayed: number;
  gamesWon: number;
  totalWinnings: number;
  language: string;
  createdAt: string;
  updatedAt: string;
}

interface AuthState {
  user: User | null;
  loading: boolean;
  initializeUser: (user: User) => void;
  reloadBalance: () => Promise<void>;
  subscribeToBalance: () => void;
  unsubscribeFromBalance: () => void;
  logout: () => void;
}

let balanceUnsubscribe: (() => void) | null = null;

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      loading: false,

      initializeUser: (user) => {
        set({ user, loading: false });
        get().subscribeToBalance(); // ✅ start listening when user logs in
      },

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

      subscribeToBalance: () => {
        const user = get().user;
        if (!user) return;

        const balanceRef = ref(rtdb, `users/${user.telegramId}/balance`);

        // cleanup old listener first
        get().unsubscribeFromBalance();

        const listener = onValue(balanceRef, (snapshot) => {
          const balance = snapshot.val() ?? 0;
          set((state) => ({
            user: state.user ? { ...state.user, balance } : null,
          }));
        });

        balanceUnsubscribe = () => off(balanceRef, 'value', listener);
      },

      unsubscribeFromBalance: () => {
        if (balanceUnsubscribe) {
          balanceUnsubscribe();
          balanceUnsubscribe = null;
        }
      },

      logout: () => {
        get().unsubscribeFromBalance(); // ✅ cleanup listener
        set({ user: null, loading: false });
      },
    }),
    {
      name: 'auth-storage',
      getStorage: () => localStorage,
    }
  ) as any
);
