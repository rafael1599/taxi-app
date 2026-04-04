import { create } from 'zustand';

interface AuthState {
  token: string | null;
  driverId: string | null;
  setAuth: (token: string, driverId: string) => void;
  clearAuth: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  driverId: null,
  setAuth: (token, driverId) => set({ token, driverId }),
  clearAuth: () => set({ token: null, driverId: null }),
}));
