import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import OpenAI from 'openai';
import { z } from 'zod';
import { blockOpSchema, createAgentRunSchema, opEnvelopeSchema } from '@dryvre/shared';
import type { DryvreDatabase } from '@dryvre/db';
import type { AppConfig } from './config.js';
import { applyOperation, getAiContext, getSubtree } from './block-service.js';
import { requireActor } from './auth.js';
import type { AgentRuntime } from './agent-runtime.js';
import type { LivePublisher } from './live.js';

const treeParams = z.object({ id: z.string().uuid() });
const treeQuery = z.object({ q: z.string().optional() });
const aiBody = z.object({ blockId: z.string().uuid(), prompt: z.string().min(1).max(20_000) });
const blockIdParams = z.object({ blockId: z.string().uuid() });
const runIdParams = z.object({ id: z.string().uuid() });

export function registerRoutes(app: FastifyInstance, db: DryvreDatabase, config: AppConfig, publish: LivePublisher, agentRuntime: AgentRuntime) {
  app.get('/api/health', async () => ({ ok: true }));
  app.get('/api/agents/readiness', async () => agentRuntime.readiness());

  app.post('/api/agents/:blockId/validate', async (request, reply) => {
    try { return await agentRuntime.validate(blockIdParams.parse(request.params).blockId); }
    catch (error) { return reply.code(422).send({ error: error instanceof Error ? error.message : 'Invalid Agent' }); }
  });

  app.get('/api/agents/:blockId/skills', async (request, reply) => {
    try { return await agentRuntime.validate(blockIdParams.parse(request.params).blockId); }
    catch (error) { return reply.code(422).send({ error: error instanceof Error ? error.message : 'Invalid Agent' }); }
  });

  app.post('/api/agent-runs', async (request, reply) => {
    const input = createAgentRunSchema.parse(request.body);
    try { return reply.code(202).send(await agentRuntime.start(input, await requireActor(request))); }
    catch (error) {
      const message = error instanceof Error ? error.message : 'Could not start Agent';
      return reply.code(message === 'agent_busy' || message === 'runner_busy' ? 409 : 422).send({ error: message });
    }
  });

  app.get('/api/agent-runs/:id', async (request, reply) => {
    const run = await agentRuntime.get(runIdParams.parse(request.params).id);
    return run ?? reply.code(404).send({ error: 'Agent run not found' });
  });

  app.post('/api/agent-runs/:id/cancel', async (request, reply) => {
    const run = await agentRuntime.cancel(runIdParams.parse(request.params).id);
    return run ?? reply.code(404).send({ error: 'Agent run not found' });
  });

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
