import { useEffect, useRef, useCallback } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { getSSEUrl } from '../api/client';
import { useAuthStore } from '../store/authStore';
import { useRideStore, type TripOffer } from '../store/rideStore';

/**
 * Connects to the SSE stream when the driver is online.
 * Receives real-time trip offers, confirmations, expirations, and status changes.
 * Auto-reconnects on disconnect with exponential backoff.
 */
export function useSSE(online: boolean) {
  const token = useAuthStore((s) => s.token);
  const setCurrentOffer = useRideStore((s) => s.setCurrentOffer);
  const setActiveRide = useRideStore((s) => s.setActiveRide);
  const activeRide = useRideStore((s) => s.activeRide);
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleEvent = useCallback(
    (eventType: string, data: string) => {
      try {
        const parsed = JSON.parse(data);

        switch (eventType) {
          case 'trip_offer': {
            const offer: TripOffer = {
              offerId: parsed.offerId,
              rideId: parsed.rideId,
              pickupLat: parsed.pickupLat,
              pickupLng: parsed.pickupLng,
              pickupAddress: parsed.pickupAddress,
              dropoffLat: parsed.dropoffLat,
              dropoffLng: parsed.dropoffLng,
              dropoffAddress: parsed.dropoffAddress,
              fareEstimate: parsed.fareEstimate,
              distanceKm: parsed.distanceKm,
              expiresAt: parsed.expiresAt,
            };
            setCurrentOffer(offer);
            break;
          }

          case 'trip_confirmed': {
            setCurrentOffer(null);
            // Reload active ride from API
            if (parsed.rideId && activeRide?.id !== parsed.rideId) {
              import('../api/client').then(({ rideApi }) => {
                rideApi.get(parsed.rideId).then(({ data: ride }) => {
                  setActiveRide(ride);
                });
              });
            }
            break;
          }

          case 'offer_expired': {
            setCurrentOffer(null);
            break;
          }

          case 'trip_status_changed': {
            if (parsed.rideId && parsed.status === 'completed') {
              setActiveRide(null);
            } else if (parsed.rideId) {
              import('../api/client').then(({ rideApi }) => {
                rideApi.get(parsed.rideId).then(({ data: ride }) => {
                  setActiveRide(ride);
                });
              });
            }
            break;
          }

          case 'connected':
            retryCountRef.current = 0;
            break;
        }
      } catch {
        // ignore malformed data
      }
    },
    [setCurrentOffer, setActiveRide, activeRide?.id],
  );

  const connect = useCallback(() => {
    if (!token || !online) return;

    // Clean up previous
    controllerRef.current?.abort();

    const controller = new AbortController();
    controllerRef.current = controller;

    const url = getSSEUrl();

    fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok || !response.body) {
          throw new Error(`SSE response error: ${response.status}`);
        }

        retryCountRef.current = 0;
        const reader = response.body.getReader();
        readerRef.current = reader;
        const decoder = new TextDecoder();

        let buffer = '';
        let currentEvent = '';
        let currentData = '';

        const read = (): void => {
          reader
            .read()
            .then(({ done, value }) => {
              if (done) {
                scheduleReconnect();
                return;
              }

              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split('\n');
              buffer = lines.pop() ?? '';

              for (const line of lines) {
                if (line.startsWith('event: ')) {
                  currentEvent = line.slice(7).trim();
                } else if (line.startsWith('data: ')) {
                  currentData = line.slice(6);
                } else if (line === '' && currentEvent && currentData) {
                  handleEvent(currentEvent, currentData);
                  currentEvent = '';
                  currentData = '';
                } else if (line.startsWith(':')) {
                  // keepalive comment, ignore
                }
              }

              read();
            })
            .catch((err) => {
              if (err.name !== 'AbortError') {
                scheduleReconnect();
              }
            });
        };

        read();
      })
      .catch((err) => {
        if (err.name !== 'AbortError') {
          scheduleReconnect();
        }
      });
  }, [token, online, handleEvent]);

  const scheduleReconnect = useCallback(() => {
    const delay = Math.min(1000 * 2 ** retryCountRef.current, 30_000);
    retryCountRef.current++;
    retryTimerRef.current = setTimeout(() => {
      connect();
    }, delay);
  }, [connect]);

  const disconnect = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    readerRef.current = null;
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  // Connect/disconnect based on online status
  useEffect(() => {
    if (online && token) {
      connect();
    } else {
      disconnect();
    }

    return disconnect;
  }, [online, token, connect, disconnect]);

  // Handle app state changes — reconnect when foregrounded
  useEffect(() => {
    const handleAppState = (state: AppStateStatus) => {
      if (state === 'active' && online && token) {
        connect();
      } else if (state === 'background') {
        disconnect();
      }
    };

    const sub = AppState.addEventListener('change', handleAppState);
    return () => sub.remove();
  }, [online, token, connect, disconnect]);
}
