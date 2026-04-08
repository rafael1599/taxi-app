import { useEffect, useRef, useCallback } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { API_BASE_URL } from '../api/client';
import { useAuthStore } from '../store/authStore';

interface DriverLocationEvent {
  type: 'driver_location_update';
  lat: number;
  lng: number;
  driverId: string;
}

interface RideStatusEvent {
  type: 'ride_status_change';
  status: string;
  rideId: string;
}

interface DriverAssignedEvent {
  type: 'driver_assigned';
  driverId: string;
  rideId: string;
}

interface SubscribedEvent {
  type: 'subscribed';
  rideId: string;
}

type WsEvent = DriverLocationEvent | RideStatusEvent | DriverAssignedEvent | SubscribedEvent;

interface UseRideWebSocketOptions {
  rideId: string;
  onDriverLocation?: (lat: number, lng: number) => void;
  onStatusChange?: (status: string) => void;
  onDriverAssigned?: (driverId: string) => void;
}

const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 15_000;

/**
 * Connects to the ride WebSocket room for real-time updates.
 * Auto-reconnects with exponential backoff on disconnect.
 * Pauses when app goes to background, resumes on foreground.
 */
export function useRideWebSocket({
  rideId,
  onDriverLocation,
  onStatusChange,
  onDriverAssigned,
}: UseRideWebSocketOptions) {
  const token = useAuthStore((s) => s.token);
  const wsRef = useRef<WebSocket | null>(null);
  const retriesRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmountedRef = useRef(false);

  const connect = useCallback(() => {
    if (unmountedRef.current || !token) return;

    // Close any existing connection
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close();
    }

    const wsUrl = API_BASE_URL.replace(/^http/, 'ws');
    const url = `${wsUrl}/api/v1/ws/ride/${rideId}?token=${token}`;

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      retriesRef.current = 0;
    };

    ws.onmessage = (event) => {
      try {
        const data: WsEvent = JSON.parse(event.data);
        switch (data.type) {
          case 'driver_location_update':
            onDriverLocation?.(data.lat, data.lng);
            break;
          case 'ride_status_change':
            onStatusChange?.(data.status);
            break;
          case 'driver_assigned':
            onDriverAssigned?.(data.driverId);
            break;
        }
      } catch {
        // ignore malformed messages
      }
    };

    ws.onclose = () => {
      if (unmountedRef.current) return;
      scheduleReconnect();
    };

    ws.onerror = () => {
      // onclose will fire after onerror — reconnect handled there
    };
  }, [rideId, token, onDriverLocation, onStatusChange, onDriverAssigned]);

  const scheduleReconnect = useCallback(() => {
    if (unmountedRef.current) return;
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** retriesRef.current, RECONNECT_MAX_MS);
    retriesRef.current += 1;
    reconnectTimerRef.current = setTimeout(connect, delay);
  }, [connect]);

  const disconnect = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  useEffect(() => {
    unmountedRef.current = false;
    connect();

    // Pause/resume on app state changes
    const handleAppState = (state: AppStateStatus) => {
      if (state === 'active') {
        connect();
      } else {
        disconnect();
      }
    };

    const subscription = AppState.addEventListener('change', handleAppState);

    return () => {
      unmountedRef.current = true;
      subscription.remove();
      disconnect();
    };
  }, [connect, disconnect]);
}
