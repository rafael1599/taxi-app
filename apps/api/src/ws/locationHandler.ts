import { FastifyInstance } from 'fastify';
import { updateDriverLocation } from '../services/dispatch.js';

interface LocationMessage {
  type: 'location';
  lat: number;
  lng: number;
}

export async function locationWsRoutes(app: FastifyInstance) {
  app.get(
    '/ws/driver/location',
    { websocket: true },
    async (socket, request) => {
      let driverId: string | null = null;

      try {
        // Verify JWT from query param: ?token=<jwt>
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
        try {
          const msg: LocationMessage = JSON.parse(raw.toString());
          if (msg.type === 'location' && driverId) {
            await updateDriverLocation(driverId, msg.lat, msg.lng);
            socket.send(JSON.stringify({ type: 'ack' }));
          }
        } catch {
          // ignore malformed messages
        }
      });

      socket.on('close', () => {
        // Driver went offline — optionally mark unavailable
      });
    },
  );
}
