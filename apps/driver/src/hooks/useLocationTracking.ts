import { useEffect, useRef } from 'react';
import * as Location from 'expo-location';
import { driverApi } from '../api/client';
import { useAuthStore } from '../store/authStore';
import { startBackgroundLocation, stopBackgroundLocation } from '../services/backgroundLocation';

const FOREGROUND_INTERVAL_MS = 10_000;

/**
 * Manages driver location tracking:
 * - Attempts background location (survives app minimize) via TaskManager.
 * - Falls back to foreground polling every 10s if background permission is denied.
 * - Stops all tracking when disabled or on unmount.
 */
export function useLocationTracking(enabled: boolean) {
  const token = useAuthStore((s) => s.token);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const bgActiveRef = useRef(false);

  useEffect(() => {
    if (!enabled || !token) return;

    let running = true;

    const start = async () => {
      // Try background first
      const bgStarted = await startBackgroundLocation();
      bgActiveRef.current = bgStarted;

      if (bgStarted) {
        // Background task handles everything — no need for foreground polling
        return;
      }

      // Fallback: foreground polling (pauses when app backgrounded)
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
      timerRef.current = setInterval(tick, FOREGROUND_INTERVAL_MS);
    };

    start();

    return () => {
      running = false;
      if (timerRef.current) clearInterval(timerRef.current);
      if (bgActiveRef.current) {
        stopBackgroundLocation();
        bgActiveRef.current = false;
      }
    };
  }, [enabled, token]);
}
