import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { rtdb } from '../firebase/config';
import { ref, get as dbGet, set as dbSet, update as dbUpdate, onValue } from 'firebase/database';

export interface User {
  telegramId: string;
  username: string;
  balance: number;
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
  logout: () => void;
}

// Use the persist middleware properly with the correct typing.
export const useAuthStore = create<AuthState>(
  persist(
    (set) => ({ 
      user : null, 
      loading: false,
      initializeUser: (user) =>
        set({
          user,
          loading: false,
        }),
      logout: () => set({ user: null, loading: false }),
    }),
    {
      name: 'auth-storage', // The key for localStorage
      getStorage: () => localStorage, // Persist state to localStorage
    }
  ) as any // Cast to 'any' to resolve the typing error
);
