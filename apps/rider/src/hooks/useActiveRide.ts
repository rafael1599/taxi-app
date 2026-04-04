import { useEffect, useRef } from 'react';
import { rideApi } from '../api/client';
import { useRideStore } from '../store/rideStore';
import { useAuthStore } from '../store/authStore';

/**
 * Polls the active ride endpoint every 5 seconds while the rider is logged in.
 * Syncs result into rideStore so any screen can react to status changes.
 */
export function useActiveRide() {
  const token = useAuthStore((s) => s.token);
  const setActiveRide = useRideStore((s) => s.setActiveRide);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!token) return;

    const poll = () => {
      rideApi.myActive().then(({ data }) => setActiveRide(data)).catch(() => {});
    };

    poll();
    intervalRef.current = setInterval(poll, 5_000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [token, setActiveRide]);
}
