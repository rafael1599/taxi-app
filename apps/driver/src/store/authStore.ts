import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

const TOKEN_KEY = '@rockland_driver_token';
const DRIVER_ID_KEY = '@rockland_driver_id';

function isTokenExpired(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.exp * 1000 < Date.now();
  } catch {
    return true;
  }
}

interface AuthState {
  token: string | null;
  driverId: string | null;
  hydrated: boolean;
  setAuth: (token: string, driverId: string) => void;
  clearAuth: () => void;
  hydrate: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  driverId: null,
  hydrated: false,

  setAuth: (token, driverId) => {
    AsyncStorage.multiSet([
      [TOKEN_KEY, token],
      [DRIVER_ID_KEY, driverId],
    ]).catch(() => {});
    set({ token, driverId });
  },

  clearAuth: () => {
    AsyncStorage.multiRemove([TOKEN_KEY, DRIVER_ID_KEY]).catch(() => {});
    set({ token: null, driverId: null });
  },

  hydrate: async () => {
    try {
      const [[, token], [, driverId]] = await AsyncStorage.multiGet([TOKEN_KEY, DRIVER_ID_KEY]);
      if (token && isTokenExpired(token)) {
        await AsyncStorage.multiRemove([TOKEN_KEY, DRIVER_ID_KEY]);
        set({ token: null, driverId: null, hydrated: true });
        return;
      }
      set({ token: token ?? null, driverId: driverId ?? null, hydrated: true });
    } catch {
      set({ hydrated: true });
    }
  },
}));
