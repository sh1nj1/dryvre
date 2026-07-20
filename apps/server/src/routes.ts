import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import OpenAI from 'openai';
import { z } from 'zod';
import { blockOpSchema, opEnvelopeSchema } from '@dryvre/shared';
import type { DryvreDatabase } from '@dryvre/db';
import type { AppConfig } from './config.js';
import { applyOperation, getAiContext, getSubtree } from './block-service.js';
import { requireActor } from './auth.js';

const treeParams = z.object({ id: z.string().uuid() });
const treeQuery = z.object({ q: z.string().optional() });
const aiBody = z.object({ blockId: z.string().uuid(), prompt: z.string().min(1).max(20_000) });

export function registerRoutes(app: FastifyInstance, db: DryvreDatabase, config: AppConfig, publish: (message: unknown) => void) {
  app.get('/api/health', async () => ({ ok: true }));

  app.get('/api/trees/:id', async (request, reply) => {
    const { id } = treeParams.parse(request.params);
    const { q } = treeQuery.parse(request.query);
    const result = await getSubtree(db, id, q);
    if (!result) return reply.code(404).send({ error: 'Block not found' });
    return { blocks: result };
  });

  app.post('/api/ops', async (request) => {
    const envelope = opEnvelopeSchema.parse(request.body);
    const result = await applyOperation(db, envelope, await requireActor(request));
    const message = { type: 'applied', clientOpId: envelope.clientOpId, ...result };
    publish(message);
    return message;
  });

  app.post('/api/ai/respond', async (request, reply) => {
    if (!config.OPENAI_API_KEY) return reply.code(503).send({ error: 'OPENAI_API_KEY is not configured' });
    const input = aiBody.parse(request.body);
    const context = await getAiContext(db, input.blockId);
    const client = new OpenAI({ apiKey: config.OPENAI_API_KEY });
    const response = await client.responses.create({
      model: config.OPENAI_MODEL,
      instructions: 'You are a Dryvre collaborator. Answer in concise Markdown. Your output becomes a first-class block.',
      input: `Current subtree and referenced blocks:\n\n${context}\n\nUser request:\n${input.prompt}`,
    });
    const envelope = { clientOpId: randomUUID(), op: blockOpSchema.parse({ type: 'create', parentId: input.blockId, bodyMd: response.output_text, stream: true }) };
    const result = await applyOperation(db, envelope, await requireActor(request));
    const message = { type: 'applied', clientOpId: envelope.clientOpId, ...result };
    publish(message);
    return message;
  });
}
