import { describe, expect, it } from "vitest";
import type { AppConfig } from "./config.js";
import { checkCodexReadiness, executeProcess, killCodexProcessGroup, runCodex } from "./codex-runner.js";

const config: AppConfig = {
  NODE_ENV: "test",
  HOST: "127.0.0.1",
  PORT: 3000,
  DATABASE_URL: "postgres://unused",
  SESSION_SECRET: "test-secret-that-is-at-least-32-characters",
  OPENAI_MODEL: "gpt-5.6",
  CODEX_COMMAND: "codex",
  DRYVRE_AGENT_DATA_DIR: ".dryvre-data/test-agent-runtime",
  DRYVRE_AGENT_TIMEOUT_MS: 1_000,
  DRYVRE_AGENT_FAKE: true,
};

describe("Codex runner", () => {
  it("provides a deterministic fake mode for demos and integration tests", async () => {
    const result = await runCodex({
      config,
      runId: crypto.randomUUID(),
      agentBlockId: crypto.randomUUID(),
      agentConfig: { workspace: "dryvre" },
      skills: [],
      prompt: "Ship the focused change.",
      workspace: process.cwd(),
      resumeSessionId: null,
      onSpawn: () => {
        throw new Error("Fake runner must not spawn a process");
      },
    });
    expect(result.exitCode).toBe(0);
    expect(result.sessionId).toMatch(/^fake-/);
    expect(result.summary).toContain("Ship the focused change.");
  });

  it("reports fake readiness without requiring a local binary", async () => {
    await expect(checkCodexReadiness(config)).resolves.toEqual({
      ready: true,
      mode: "fake",
      version: "fake",
    });
  });

  it("kills a persisted detached process group during reconciliation", () => {
    const calls: Array<[number, NodeJS.Signals]> = [];
    expect(killCodexProcessGroup(42_424, "SIGKILL", (target, signal) => {
      calls.push([target, signal]);
      return true;
    })).toBe(true);
    expect(calls).toEqual([[
      process.platform === "win32" ? 42_424 : -42_424,
      "SIGKILL",
    ]]);
    expect(killCodexProcessGroup(process.pid, "SIGKILL", () => {
      throw new Error("The server must never kill itself");
    })).toBe(false);
  });

  it("settles the process promise when the child closes stdin early", async () => {
    try {
      const result = await executeProcess({
        command: process.execPath,
        args: ["-e", "process.stdin.destroy(); process.exit(1)"],
        cwd: process.cwd(),
        env: process.env,
        prompt: "x".repeat(2 * 1024 * 1024),
        timeoutMs: 1_000,
        onSpawn: () => undefined,
      });
      expect(result.exitCode).not.toBe(0);
    } catch (error) {
      expect((error as NodeJS.ErrnoException).code).toBe("EPIPE");
    }
  });
});
