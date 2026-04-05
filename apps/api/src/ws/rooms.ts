import type { WebSocket } from '@fastify/websocket';

export type WsEvent =
  | { type: 'driver_location_update'; lat: number; lng: number; driverId: string }
  | { type: 'ride_status_change'; status: string; rideId: string }
  | { type: 'driver_assigned'; driverId: string; rideId: string };

// In-memory room registry: rideId → set of connected WebSocket clients
const rooms = new Map<string, Set<WebSocket>>();

export function joinRoom(rideId: string, socket: WebSocket): void {
  let room = rooms.get(rideId);
  if (!room) {
    room = new Set();
    rooms.set(rideId, room);
  }
  room.add(socket);
}

export function leaveRoom(rideId: string, socket: WebSocket): void {
  const room = rooms.get(rideId);
  if (!room) return;
  room.delete(socket);
  if (room.size === 0) rooms.delete(rideId);
}

export function broadcastToRide(rideId: string, event: WsEvent): void {
  const room = rooms.get(rideId);
  if (!room) return;
  const payload = JSON.stringify(event);
  for (const socket of room) {
    if (socket.readyState === 1 /* OPEN */) {
      socket.send(payload);
    }
  }
}
