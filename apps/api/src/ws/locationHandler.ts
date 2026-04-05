import { FastifyInstance } from 'fastify';
import { db, schema } from '@excellent-taxi/db';
import { eq, and, or } from 'drizzle-orm';
import { updateDriverLocation } from '../services/dispatch.js';
import { joinRoom, leaveRoom, broadcastToRide } from './rooms.js';

interface LocationMessage {
  type: 'location';
  lat: number;
  lng: number;
}

export async function locationWsRoutes(app: FastifyInstance) {
  // Driver sends GPS location updates; broadcasts to the ride room if active
  app.get('/ws/driver/location', { websocket: true }, async (socket, request) => {
    let driverId: string | null = null;

    try {
      const { token } = request.query as { token?: string };
      if (!token) {
        socket.close(4001, 'Missing token');
        return;
      }
      const payload = app.jwt.verify<{ sub: string; role: string }>(token);
      if (payload.role !== 'driver') {
        socket.close(4003, 'Drivers only');
        return;
      }
      driverId = payload.sub;
    } catch {
      socket.close(4001, 'Invalid token');
      return;
    }

    socket.on('message', async (raw: Buffer) => {
      if (!driverId) return;
      try {
        const msg: LocationMessage = JSON.parse(raw.toString());
        if (msg.type !== 'location') return;

        await updateDriverLocation(driverId, msg.lat, msg.lng);
        socket.send(JSON.stringify({ type: 'ack' }));

        // Broadcast to any rider subscribed to the driver's active ride
        const activeRide = await db.query.rides.findFirst({
          where: and(
            eq(schema.rides.driverId, driverId),
            or(
              eq(schema.rides.status, 'accepted'),
              eq(schema.rides.status, 'arrived'),
              eq(schema.rides.status, 'in_progress'),
            ),
          ),
          columns: { id: true },
        });

        if (activeRide) {
          broadcastToRide(activeRide.id, {
            type: 'driver_location_update',
            driverId,
            lat: msg.lat,
            lng: msg.lng,
          });
        }
      } catch {
        // ignore malformed messages
      }
    });

    socket.on('close', () => {
      // Driver went offline — future: mark unavailable
    });
  });

  // Rider subscribes to real-time events for a specific ride
  app.get('/ws/ride/:rideId', { websocket: true }, async (socket, request) => {
    const { rideId } = request.params as { rideId: string };

    try {
      const { token } = request.query as { token?: string };
      if (!token) {
        socket.close(4001, 'Missing token');
        return;
      }
      const payload = app.jwt.verify<{ sub: string; role: string }>(token);
      // Allow riders and admins to subscribe; drivers may also subscribe
      if (!payload.sub) {
        socket.close(4003, 'Unauthorized');
        return;
      }
    } catch {
      socket.close(4001, 'Invalid token');
      return;
    }

    joinRoom(rideId, socket);
    socket.send(JSON.stringify({ type: 'subscribed', rideId }));

    socket.on('close', () => {
      leaveRoom(rideId, socket);
    });
  });
}
