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
  const useLocal = mode === 'local' || (mode === 'auto' && await isPortOpen('127.0.0.1', 5432));
  if (useLocal) {
    const databaseUrl = process.env.DATABASE_URL ?? LOCAL_DATABASE_URL;
    console.log(`[dev] PostgreSQL detected on localhost:5432; using ${databaseUrl.replace(/:[^:@/]+@/, ':***@')}`);
    return { databaseUrl };
  }
  if (mode !== 'auto' && mode !== 'container') throw new Error('DRYVRE_DB_MODE must be auto, local, or container');

  await assertDockerReady();
  console.log('[dev] PostgreSQL not found on localhost:5432; starting postgres:17-alpine with Testcontainers…');
  const container = await new PostgreSqlContainer('postgres:17-alpine')
    .withDatabase('dryvre')
    .withUsername('dryvre')
    .withPassword('dryvre')
    .start();
  return { databaseUrl: container.getConnectionUri(), container };
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
