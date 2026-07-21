import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { FastifyInstance } from 'fastify';
import { WebSocket } from 'ws';
import { migrateDatabase } from '@dryvre/db/migrate';
import { buildApp } from '../../apps/server/src/app.js';
import type { AppConfig } from '../../apps/server/src/config.js';
import { assertDockerReady } from '../../scripts/docker-runtime.js';

const ROOT_ID = '00000000-0000-4000-8000-000000000010';
let container: StartedPostgreSqlContainer;
let app: FastifyInstance;
let origin: string;

async function post(path: string, body: unknown) {
  return fetch(`${origin}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  await assertDockerReady();
  container = await new PostgreSqlContainer('postgres:17-alpine')
    .withDatabase('dryvre_e2e')
    .withUsername('dryvre')
    .withPassword('dryvre')
    .start();
  await migrateDatabase(container.getConnectionUri());
  const config: AppConfig = {
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: 3000,
    DATABASE_URL: container.getConnectionUri(),
    SESSION_SECRET: 'e2e-only-secret-at-least-32-characters',
    OPENAI_MODEL: 'gpt-5.6',
    CODEX_COMMAND: 'codex',
    DRYVRE_AGENT_DATA_DIR: '.dryvre-data/e2e-agent-runtime',
    DRYVRE_AGENT_TIMEOUT_MS: 1_000,
    DRYVRE_AGENT_FAKE: true,
  };
  app = await buildApp(config);
  origin = await app.listen({ host: '127.0.0.1', port: 0 });
});

afterAll(async () => {
  await app?.close();
  await container?.stop();
});

describe('Dryvre API with PostgreSQL', () => {
  it('serves the migrated root tree and WebSocket readiness event', async () => {
    const response = await fetch(`${origin}/api/trees/${ROOT_ID}`);
    expect(response.status).toBe(200);
    const body = await response.json() as { blocks: Array<{ id: string; bodyMd: string }> };
    expect(body.blocks).toContainEqual(expect.objectContaining({ id: ROOT_ID, bodyMd: '# Dryvre' }));

    const ready = await new Promise<{ type: string; actorId: string }>((resolve, reject) => {
      const socket = new WebSocket(origin.replace('http', 'ws') + '/api/live');
      socket.once('message', (data) => {
        resolve(JSON.parse(data.toString()) as { type: string; actorId: string });
        socket.close();
      });
      socket.once('error', reject);
    });
    expect(ready.type).toBe('ready');
  });

  it('persists an operation and rejects a stale optimistic edit', async () => {
    const blockId = randomUUID();
    const createResponse = await post('/api/ops', {
      clientOpId: randomUUID(),
      op: { type: 'create', id: blockId, parentId: ROOT_ID, bodyMd: 'E2E searchable block', stream: false },
    });
    expect(createResponse.status).toBe(200);

    const editResponse = await post('/api/ops', {
      clientOpId: randomUUID(),
      op: { type: 'edit', id: blockId, bodyMd: 'Edited through the full HTTP stack', version: 0 },
    });
    expect(editResponse.status).toBe(200);

    const staleResponse = await post('/api/ops', {
      clientOpId: randomUUID(),
      op: { type: 'edit', id: blockId, bodyMd: 'This must not win', version: 0 },
    });
    expect(staleResponse.status).toBe(500);

    const treeResponse = await fetch(`${origin}/api/trees/${ROOT_ID}`);
    const tree = await treeResponse.json() as { blocks: Array<{ id: string; bodyMd: string; version: number }> };
    expect(tree.blocks).toContainEqual(expect.objectContaining({ id: blockId, bodyMd: 'Edited through the full HTTP stack', version: 1 }));
  });

  it('runs a seeded Agent against a server-backed target block', async () => {
    const response = await post('/api/agent-runs', {
      agentBlockId: '00000000-0000-4000-8000-000000000020',
      targetBlockId: ROOT_ID,
      prompt: 'Verify the server-backed Agent flow.',
      resume: true,
    });
    expect(response.status).toBe(202);
    let run = await response.json() as { id: string; status: string };
    for (let attempt = 0; attempt < 20 && ['queued', 'running'].includes(run.status); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      run = await fetch(`${origin}/api/agent-runs/${run.id}`).then((result) => result.json()) as typeof run;
    }
    expect(run.status).toBe('succeeded');

    const tree = await fetch(`${origin}/api/trees/${ROOT_ID}`).then((result) => result.json()) as { blocks: Array<{ bodyMd: string }> };
    expect(tree.blocks).toContainEqual(expect.objectContaining({ bodyMd: expect.stringContaining('Verify the server-backed Agent flow.') }));
  });
});
