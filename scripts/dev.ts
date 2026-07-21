import 'dotenv/config';
import { spawn } from 'node:child_process';
import { connect } from 'node:net';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { migrateDatabase } from '@dryvre/db/migrate';
import { assertDockerReady } from './docker-runtime.js';

const LOCAL_DATABASE_URL = 'postgres://dryvre:dryvre@localhost:5432/dryvre';
const mode = process.env.DRYVRE_DB_MODE ?? 'auto';

function isPortOpen(host: string, port: number) {
  return new Promise<boolean>((resolve) => {
    const socket = connect({ host, port });
    const finish = (open: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(500);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

async function resolveDatabase() {
  if (mode !== 'auto' && mode !== 'local' && mode !== 'container') {
    throw new Error('DRYVRE_DB_MODE must be auto, local, or container');
  }

  const databaseUrl = process.env.DATABASE_URL ?? LOCAL_DATABASE_URL;
  const configuredDatabase = new URL(databaseUrl);
  const databaseHost = configuredDatabase.hostname;
  const databasePort = configuredDatabase.port ? Number(configuredDatabase.port) : 5432;
  const useLocal = mode === 'local' || (mode === 'auto' && await isPortOpen(databaseHost, databasePort));
  if (useLocal) {
    console.log(`[dev] PostgreSQL detected on ${databaseHost}:${databasePort}; using ${databaseUrl.replace(/:[^:@/]+@/, ':***@')}`);
    return { databaseUrl };
  }

  await assertDockerReady();
  console.log(`[dev] PostgreSQL not found on ${databaseHost}:${databasePort}; starting postgres:17-alpine with Testcontainers…`);
  const container = await new PostgreSqlContainer('postgres:17-alpine')
    .withDatabase('dryvre')
    .withUsername('dryvre')
    .withPassword('dryvre')
    .start();
  return { databaseUrl: container.getConnectionUri(), container };
}

async function buildManagedMcp() {
  const child = spawn('npm', ['run', 'build', '-w', '@dryvre/mcp'], {
    env: process.env,
    stdio: 'inherit',
  });
  const code = await new Promise<number | null>((resolve) => child.once('exit', resolve));
  if (code !== 0) throw new Error('Could not build the Dryvre MCP entrypoint');
}

let container: StartedPostgreSqlContainer | undefined;
try {
  const resolved = await resolveDatabase();
  container = resolved.container;
  try {
    await migrateDatabase(resolved.databaseUrl);
  } catch (error) {
    if (!container) {
      console.error('[dev] Local PostgreSQL is reachable, but Dryvre could not initialize it.');
      console.error('[dev] Run: psql -U postgres -d postgres -f scripts/init-local-postgres.sql');
    }
    throw error;
  }
  console.log(`[dev] Database migrations applied (${container ? 'Testcontainers' : 'local'} mode).`);
  await buildManagedMcp();
  console.log('[dev] Dryvre MCP entrypoint built for Local Agents.');

  const child = spawn('npm', ['run', 'dev:apps'], {
    env: { ...process.env, DATABASE_URL: resolved.databaseUrl },
    stdio: 'inherit',
  });
  process.once('SIGINT', () => child.kill('SIGINT'));
  process.once('SIGTERM', () => child.kill('SIGTERM'));
  const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  process.exitCode = result.code ?? (result.signal === 'SIGINT' ? 130 : 1);
} finally {
  if (container) {
    console.log('[dev] Stopping Testcontainers PostgreSQL…');
    await container.stop();
  }
}
