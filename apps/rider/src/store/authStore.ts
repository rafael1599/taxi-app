import { create } from 'zustand';

interface AuthState {
  token: string | null;
  riderId: string | null;
  setAuth: (token: string, riderId: string) => void;
  clearAuth: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  riderId: null,
  setAuth: (token, riderId) => set({ token, riderId }),
  clearAuth: () => set({ token: null, riderId: null }),
}));
