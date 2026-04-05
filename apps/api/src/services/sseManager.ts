import { FastifyReply } from 'fastify';

interface SSEEvent {
  type: string;
  data: unknown;
}

class SSEManager {
  // Map of driverId → active SSE response
  private connections = new Map<string, FastifyReply>();

  addConnection(driverId: string, reply: FastifyReply): void {
    // Close existing connection if any
    const existing = this.connections.get(driverId);
    if (existing) {
      try {
        existing.raw.end();
      } catch {
        // connection already closed
      }
    }
    this.connections.set(driverId, reply);
  }

  removeConnection(driverId: string): void {
    this.connections.delete(driverId);
  }

  sendToDriver(driverId: string, event: SSEEvent): void {
    const reply = this.connections.get(driverId);
    if (!reply) return;

    try {
      const data = JSON.stringify(event.data);
      reply.raw.write(`event: ${event.type}\ndata: ${data}\n\n`);
    } catch {
      // Connection broken, clean up
      this.connections.delete(driverId);
    }
  }

  isConnected(driverId: string): boolean {
    return this.connections.has(driverId);
  }

  getConnectionCount(): number {
    return this.connections.size;
  }
}

// Singleton
export const sseManager = new SSEManager();
