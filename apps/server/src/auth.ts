import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { and, eq, gt } from 'drizzle-orm';
import { sessions } from '@dryvre/db';
import type { DryvreDatabase } from '@dryvre/db';
import type { AppConfig } from './config.js';

const COOKIE_NAME = 'dryvre_session';
export const DEV_ACTOR_ID = '00000000-0000-4000-8000-000000000001';

declare module 'fastify' {
  interface FastifyRequest { actorId: string }
}

const digest = (token: string, secret: string) => createHash('sha256').update(`${secret}:${token}`).digest('hex');

export function registerAuth(app: FastifyInstance, db: DryvreDatabase, config: AppConfig) {
  app.decorateRequest('actorId', '');
  app.addHook('preHandler', async (request, reply) => {
    if (!request.url.startsWith('/api/') || request.url === '/api/health') return;
    const token = request.cookies[COOKIE_NAME];
    if (token) {
      const session = await db.query.sessions.findFirst({
        where: and(eq(sessions.tokenHash, digest(token, config.SESSION_SECRET)), gt(sessions.expiresAt, new Date())),
      });
      if (session) {
        request.actorId = session.subjectId;
        return;
      }
    }
    if (config.NODE_ENV !== 'production') {
      request.actorId = DEV_ACTOR_ID;
      return;
    }
    return reply.code(401).send({ error: 'Authentication required' });
  });
}

export async function createSessionToken(db: DryvreDatabase, config: AppConfig, subjectId: string, ttlMs = 30 * 24 * 60 * 60 * 1000) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + ttlMs);
  const [session] = await db.insert(sessions).values({ subjectId, tokenHash: digest(token, config.SESSION_SECRET), expiresAt }).returning({ id: sessions.id });
  if (!session) throw new Error('Could not create session');
  return { id: session.id, token, expiresAt };
}

export async function createSession(db: DryvreDatabase, config: AppConfig, reply: FastifyReply, subjectId: string) {
  const { token, expiresAt } = await createSessionToken(db, config, subjectId);
  reply.setCookie(COOKIE_NAME, token, { httpOnly: true, sameSite: 'lax', secure: config.NODE_ENV === 'production', path: '/', expires: expiresAt });
}

export async function requireActor(request: FastifyRequest) {
  if (!request.actorId) throw new Error('Missing authenticated actor');
  return request.actorId;
}
