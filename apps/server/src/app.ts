import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import { createDatabase } from '@dryvre/db';
import type { AppConfig } from './config.js';
import { registerAuth } from './auth.js';
import { registerLive } from './live.js';
import { registerRoutes } from './routes.js';
import { createAgentRuntime } from './agent-runtime.js';
import { createAgentEventRuntime, type AgentEventRuntime } from './agent-events.js';

export async function buildApp(config: AppConfig) {
  const database = createDatabase(config.DATABASE_URL);
  const app = Fastify({ logger: config.NODE_ENV !== 'test' });

  await app.register(cookie);
  await app.register(cors, { origin: config.NODE_ENV === 'development' ? true : false, credentials: true });
  await app.register(websocket);
  registerAuth(app, database.db, config);
  const runtimes: { events?: AgentEventRuntime } = {};
  const publish = registerLive(app, database.db, (result, actorId) => runtimes.events?.dispatch(result, actorId));
  const agentRuntime = await createAgentRuntime(database.db, config, publish);
  runtimes.events = createAgentEventRuntime(database.db, agentRuntime, publish);
  registerRoutes(app, database.db, config, publish, agentRuntime, runtimes.events);

  if (config.NODE_ENV === 'production') {
    const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../web');
    await app.register(fastifyStatic, { root: webRoot, wildcard: false });
    app.setNotFoundHandler((request, reply) => request.url.startsWith('/api/') ? reply.code(404).send({ error: 'Not found' }) : reply.sendFile('index.html'));
  }

  app.addHook('onClose', async () => {
    await runtimes.events?.close();
    await agentRuntime.close();
    await database.close();
  });
  return app;
}
