import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

const TOKEN_KEY = '@drivly_rider_token';
const RIDER_ID_KEY = '@drivly_rider_id';

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
  riderId: string | null;
  hydrated: boolean;
  setAuth: (token: string, riderId: string) => void;
  clearAuth: () => void;
  hydrate: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  riderId: null,
  hydrated: false,

  setAuth: (token, riderId) => {
    AsyncStorage.multiSet([
      [TOKEN_KEY, token],
      [RIDER_ID_KEY, riderId],
    ]).catch(() => {});
    set({ token, riderId });
  },

  clearAuth: () => {
    AsyncStorage.multiRemove([TOKEN_KEY, RIDER_ID_KEY]).catch(() => {});
    set({ token: null, riderId: null });
  },

  hydrate: async () => {
    try {
      const [[, token], [, riderId]] = await AsyncStorage.multiGet([TOKEN_KEY, RIDER_ID_KEY]);
      if (token && isTokenExpired(token)) {
        await AsyncStorage.multiRemove([TOKEN_KEY, RIDER_ID_KEY]);
        set({ token: null, riderId: null, hydrated: true });
        return;
      }
      set({ token: token ?? null, riderId: riderId ?? null, hydrated: true });
    } catch {
      set({ hydrated: true });
    }
  },
}));
