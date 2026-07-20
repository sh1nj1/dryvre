import { execFile } from 'node:child_process';

export function assertDockerReady(timeoutMs = 10_000) {
  return new Promise<void>((resolve, reject) => {
    execFile('docker', ['info', '--format', '{{.ServerVersion}}'], { timeout: timeoutMs }, (error, stdout, stderr) => {
      if (!error && stdout.trim()) {
        resolve();
        return;
      }
      const detail = stderr.trim() || (error?.killed ? `docker info timed out after ${timeoutMs}ms` : error?.message);
      reject(new Error([
        'A responsive Docker engine is required for Testcontainers.',
        detail ? `Docker check failed: ${detail}` : undefined,
        'Start or restart Docker Desktop, wait until the engine reports Running, then verify with `docker info` and rerun the command.',
      ].filter(Boolean).join('\n')));
    });
  });
}
