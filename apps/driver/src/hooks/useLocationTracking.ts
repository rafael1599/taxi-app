import { useEffect, useRef } from 'react';
import * as Location from 'expo-location';
import { driverApi } from '../api/client';
import { useAuthStore } from '../store/authStore';

const INTERVAL_MS = 5_000;

/**
 * Starts a GPS polling loop that PATCHes the driver's location every 5 s.
 * Stops automatically when the driver logs out (token cleared) or the
 * component unmounts.
 */
export function useLocationTracking(enabled: boolean) {
  const token = useAuthStore((s) => s.token);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!enabled || !token) return;

    let running = true;

    const startTracking = async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;

      const tick = async () => {
        if (!running) return;
        try {
          const pos = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.High,
          });
          await driverApi.updateLocation(pos.coords.latitude, pos.coords.longitude);
        } catch {
          // silently ignore transient errors
        }
      };

      await tick();
      timerRef.current = setInterval(tick, INTERVAL_MS);
    };

    startTracking();

    return () => {
      running = false;
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [enabled, token]);
}
