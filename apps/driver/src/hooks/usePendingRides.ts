import { useEffect, useRef } from 'react';
import { rideApi } from '../api/client';
import { useRideStore } from '../store/rideStore';
import { useAuthStore } from '../store/authStore';

const POLL_MS = 8_000;

/**
 * Polls GET /rides every 8 s when the driver is online.
 * Splits results into pending (status=requested) and history (completed/cancelled).
 */
export function usePendingRides(online: boolean) {
  const token = useAuthStore((s) => s.token);
  const { setPendingRides, setHistory } = useRideStore();
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!online || !token) return;

    const fetch = async () => {
      try {
        const { data } = await rideApi.list();
        setPendingRides(data.filter((r) => r.status === 'requested'));
        setHistory(data.filter((r) => r.status === 'completed' || r.status === 'cancelled'));
      } catch {
        // ignore
      }
    };

    fetch();
    timerRef.current = setInterval(fetch, POLL_MS);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [online, token, setPendingRides, setHistory]);
}
