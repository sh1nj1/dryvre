import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import { createDatabase } from '@dryvre/db';
import { loadConfig } from './config.js';
import { registerAuth } from './auth.js';
import { registerLive } from './live.js';
import { registerRoutes } from './routes.js';

const config = loadConfig();
const database = createDatabase(config.DATABASE_URL);
const app = Fastify({ logger: true });

await app.register(cookie);
await app.register(cors, { origin: config.NODE_ENV === 'development' ? true : false, credentials: true });
await app.register(websocket);
registerAuth(app, database.db, config);
const publish = registerLive(app, database.db);
registerRoutes(app, database.db, config, publish);

if (config.NODE_ENV === 'production') {
  const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../web');
  await app.register(fastifyStatic, { root: webRoot, wildcard: false });
  app.setNotFoundHandler((request, reply) => request.url.startsWith('/api/') ? reply.code(404).send({ error: 'Not found' }) : reply.sendFile('index.html'));
}

app.addHook('onClose', () => database.close());
await app.listen({ host: config.HOST, port: config.PORT });
