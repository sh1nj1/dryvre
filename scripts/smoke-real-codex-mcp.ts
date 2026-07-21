import fs from 'node:fs/promises';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { migrateDatabase } from '@dryvre/db/migrate';
import { buildApp } from '../apps/server/src/app.js';
import type { AppConfig } from '../apps/server/src/config.js';
import { assertDockerReady } from './docker-runtime.js';

const ROOT_ID = '00000000-0000-4000-8000-000000000010';
const RESEARCHER_ID = '00000000-0000-4000-8000-000000000050';

async function availablePort() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not reserve a local port');
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

await assertDockerReady();
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'dryvre-real-codex-smoke-'));
const container = await new PostgreSqlContainer('postgres:17-alpine')
  .withDatabase('dryvre_real_codex_smoke')
  .withUsername('dryvre')
  .withPassword('dryvre')
  .start();

let app: Awaited<ReturnType<typeof buildApp>> | undefined;
try {
  const databaseUrl = container.getConnectionUri();
  await migrateDatabase(databaseUrl);
  const port = await availablePort();
  const stdoutLog = path.join(temporary, 'codex.stdout.log');
  const stderrLog = path.join(temporary, 'codex.stderr.log');
  const codexWrapper = path.join(temporary, 'codex-wrapper.mjs');
  await fs.writeFile(codexWrapper, [
    '#!/usr/bin/env node',
    'import fs from "node:fs";',
    'import { spawn } from "node:child_process";',
    `const child = spawn(${JSON.stringify(process.env.CODEX_COMMAND ?? 'codex')}, process.argv.slice(2), { stdio: ["inherit", "pipe", "pipe"] });`,
    `const stdout = fs.createWriteStream(${JSON.stringify(stdoutLog)});`,
    `const stderr = fs.createWriteStream(${JSON.stringify(stderrLog)});`,
    'child.stdout.pipe(stdout); child.stdout.pipe(process.stdout);',
    'child.stderr.pipe(stderr); child.stderr.pipe(process.stderr);',
    'child.once("exit", (code, signal) => { stdout.end(); stderr.end(); if (signal) process.kill(process.pid, signal); else process.exit(code ?? 1); });',
  ].join('\n'), { mode: 0o700 });
  const config: AppConfig = {
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: port,
    DATABASE_URL: databaseUrl,
    SESSION_SECRET: 'real-codex-smoke-secret-at-least-32-characters',
    OPENAI_MODEL: 'gpt-5.6',
    CODEX_COMMAND: codexWrapper,
    DRYVRE_AGENT_WORKSPACES: JSON.stringify({ dryvre: process.cwd() }),
    DRYVRE_AGENT_DATA_DIR: path.join(temporary, 'agent-runtime'),
    DRYVRE_AGENT_TIMEOUT_MS: 180_000,
    DRYVRE_AGENT_FAKE: false,
    DRYVRE_AGENT_MCP_URL: `http://127.0.0.1:${port}`,
    DRYVRE_AGENT_MCP_ENTRY: path.resolve('dist/mcp/index.js'),
  };
  app = await buildApp(config);
  const origin = await app.listen({ host: config.HOST, port: config.PORT });
  const readiness = await fetch(`${origin}/api/agents/readiness`).then((response) => response.json()) as { ready?: boolean; error?: string };
  if (!readiness.ready) throw new Error(`Codex is not ready: ${readiness.error ?? 'unknown'}`);

  const marker = `# Real Codex MCP smoke ${crypto.randomUUID()}`;
  const response = await fetch(`${origin}/api/agent-runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      agentBlockId: RESEARCHER_ID,
      targetBlockId: ROOT_ID,
      prompt: [
        'Do not modify workspace files and do not run shell commands.',
        `First call dryvre_read_tree with rootId ${ROOT_ID}.`,
        `Then call dryvre_create_block with parentId ${ROOT_ID}, stream false, and bodyMd exactly: ${marker}`,
        'Finish with a one-line confirmation after both tool calls succeed.',
      ].join('\n'),
      resume: false,
    }),
  });
  if (response.status !== 202) throw new Error(`Could not start real Codex run: ${await response.text()}`);
  let run = await response.json() as { id: string; status: string; errorCode?: string | null };
  const deadline = Date.now() + config.DRYVRE_AGENT_TIMEOUT_MS + 10_000;
  while (['queued', 'running'].includes(run.status) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    run = await fetch(`${origin}/api/agent-runs/${run.id}`).then((result) => result.json()) as typeof run;
  }
  if (run.status !== 'succeeded') {
    const stdout = await fs.readFile(stdoutLog, 'utf8').catch(() => '');
    const stderr = await fs.readFile(stderrLog, 'utf8').catch(() => '');
    throw new Error(`Real Codex run ended as ${run.status}: ${JSON.stringify({ errorCode: run.errorCode ?? null, stdout: stdout.slice(-10_000), stderr: stderr.slice(-10_000) })}`);
  }

  const tree = await fetch(`${origin}/api/trees/${ROOT_ID}`).then((result) => result.json()) as { blocks: Array<{ parentId: string | null; bodyMd: string; rank: string | null; authorId: string }> };
  const created = tree.blocks.find((block) => block.bodyMd === marker && block.rank !== null);
  if (!created) {
    const rootChildren = tree.blocks
      .filter((block) => block.parentId === ROOT_ID)
      .map((block) => ({ bodyMd: block.bodyMd, rank: block.rank, authorId: block.authorId }));
    const stdout = await fs.readFile(stdoutLog, 'utf8').catch(() => '');
    const stderr = await fs.readFile(stderrLog, 'utf8').catch(() => '');
    throw new Error(`Real Codex did not create the MCP smoke block: ${JSON.stringify({ rootChildren, stdout: stdout.slice(-10_000), stderr: stderr.slice(-10_000) })}`);
  }
  console.log(JSON.stringify({ ok: true, runId: run.id, marker, authorId: created.authorId }));
} finally {
  await app?.close();
  await container.stop();
  await fs.rm(temporary, { recursive: true, force: true });
}
