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
    (set) => ({
      user: null,
      loading: true, // start loading
      initializeUser: (user) => set({ user, loading: false }),
      logout: () => set({ user: null, loading: false }),
    }),
    {
      name: "auth-storage",
      getStorage: () => localStorage,
    }
  ) as any
);

