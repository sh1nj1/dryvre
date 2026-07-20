import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { opEnvelopeSchema } from '@dryvre/shared';
import type { DryvreDatabase } from '@dryvre/db';
import { applyOperation } from './block-service.js';

export function registerLive(app: FastifyInstance, db: DryvreDatabase) {
  const clients = new Set<WebSocket>();
  const publish = (message: unknown) => {
    const data = JSON.stringify(message);
    for (const client of clients) if (client.readyState === client.OPEN) client.send(data);
  };

  app.get('/api/live', { websocket: true }, (socket, request) => {
    clients.add(socket);
    socket.send(JSON.stringify({ type: 'ready', actorId: request.actorId }));
    socket.on('message', async (raw) => {
      let clientOpId = 'unknown';
      try {
        const envelope = opEnvelopeSchema.parse(JSON.parse(raw.toString()));
        clientOpId = envelope.clientOpId;
        const result = await applyOperation(db, envelope, request.actorId);
        publish({ type: 'applied', clientOpId, ...result });
      } catch (error) {
        socket.send(JSON.stringify({ type: 'rejected', clientOpId, reason: error instanceof Error ? error.message : 'Invalid operation' }));
      }
    });
    socket.on('close', () => clients.delete(socket));
  });
  return publish;
}
