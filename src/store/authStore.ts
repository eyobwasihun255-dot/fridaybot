import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface User {
  telegramId: string;
  username: string;
  balance: number;
  lang: string;
  createdAt: string;
  updatedAt: string;
}

interface AuthState {
  user: User | null;
  loading: boolean;
  initializeUser: (user: User) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      loading: true,
      initializeUser: (user) => {
        console.log('Initializing user:', user); // Debug log
        set({ user, loading: false });
      },
      logout: () => set({ user: null, loading: false }),
    }),
    {
      name: 'auth-storage', // default key
      getStorage: () => localStorage,
      // 👇 Store complete user data
      partialize: (state) => ({
        user: state.user,
      }),
    }
  ) as any
);
