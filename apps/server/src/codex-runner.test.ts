import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AppConfig } from "./config.js";
import { buildManagedCodexConfig, checkCodexReadiness, executeProcess, killCodexProcessGroup, runCodex } from "./codex-runner.js";

const stockCodexAvailable = (() => {
  try {
    execFileSync("codex", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

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

  it("builds a required base config for the managed Dryvre MCP without embedding a session", () => {
    const managedConfig = buildManagedCodexConfig("/tmp/dryvre mcp/index.js");
    expect(managedConfig).toContain("[mcp_servers.dryvre]");
    expect(managedConfig).toContain("required = true");
    expect(managedConfig).toContain('args = ["/tmp/dryvre mcp/index.js"]');
    expect(managedConfig).toContain('env_vars = ["DRYVRE_URL", "DRYVRE_SESSION"]');
    expect(managedConfig).not.toContain("dryvre_session=");
  });

  it.skipIf(!stockCodexAvailable)("is consumed by the installed stock Codex CLI", async () => {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "dryvre-stock-codex-"));
    try {
      const mcpEntry = path.join(temporary, "dryvre-mcp.js");
      await fs.writeFile(mcpEntry, "// config loading probe\n");
      await fs.writeFile(path.join(temporary, "config.toml"), buildManagedCodexConfig(mcpEntry));
      const stdout = execFileSync(
        "codex",
        ["mcp", "get", "dryvre", "--json"],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            CODEX_HOME: temporary,
            DRYVRE_URL: "http://127.0.0.1:4321",
            DRYVRE_SESSION: "config-probe",
          },
        },
      );
      const loaded = JSON.parse(stdout) as {
        name: string;
        transport: { command: string; args: string[]; env_vars: string[] };
        enabled_tools: string[];
      };
      expect(loaded).toEqual(expect.objectContaining({
        name: "dryvre",
        transport: expect.objectContaining({
          command: process.execPath,
          args: [mcpEntry],
          env_vars: ["DRYVRE_URL", "DRYVRE_SESSION"],
        }),
        enabled_tools: ["dryvre_read_tree", "dryvre_create_block", "dryvre_edit_block"],
      }));
    } finally {
      await fs.rm(temporary, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform === "win32")("launches real mode with managed MCP overrides and run-scoped environment", async () => {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "dryvre-codex-runner-"));
    try {
      const command = path.join(temporary, "fake-codex");
      const mcpEntry = path.join(temporary, "dryvre-mcp.js");
      await fs.writeFile(mcpEntry, "// fixture entry\n");
      await fs.writeFile(command, [
        "#!/bin/sh",
        'test "$1" = "exec" || exit 11',
        'test -f "$CODEX_HOME/config.toml" || exit 12',
        'printf "%s\\n" "$@" | grep -Fx \'approval_policy="never"\' >/dev/null || exit 13',
        'test "$DRYVRE_URL" = "http://127.0.0.1:4321" || exit 14',
        'test "$DRYVRE_SESSION" = "run-session" || exit 15',
        `printf '%s\\n' '${JSON.stringify({ type: "thread.started", thread_id: "managed-thread" })}'`,
        `printf '%s\\n' '${JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "Managed MCP ready" } })}'`,
      ].join("\n"), { mode: 0o700 });
      const result = await runCodex({
        config: {
          ...config,
          DRYVRE_AGENT_FAKE: false,
          CODEX_COMMAND: command,
          DRYVRE_AGENT_DATA_DIR: path.join(temporary, "runtime"),
          DRYVRE_AGENT_MCP_ENTRY: mcpEntry,
          DRYVRE_AGENT_MCP_URL: "http://127.0.0.1:4321",
        },
        runId: crypto.randomUUID(),
        agentBlockId: crypto.randomUUID(),
        agentConfig: { workspace: "dryvre" },
        skills: [],
        prompt: "Use Dryvre tools.",
        workspace: process.cwd(),
        resumeSessionId: null,
        dryvreSession: "run-session",
        onSpawn: () => undefined,
      });
      expect(result).toEqual(expect.objectContaining({
        exitCode: 0,
        sessionId: "managed-thread",
        summary: "Managed MCP ready",
      }));
    } finally {
      await fs.rm(temporary, { recursive: true, force: true });
    }
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
    expect(killCodexProcessGroup(1, "SIGKILL", () => {
      throw new Error("Unsafe low PIDs must be rejected before kill");
    })).toBe(false);
    expect(killCodexProcessGroup(Number.MAX_SAFE_INTEGER + 1, "SIGKILL", () => {
      throw new Error("Unsafe integers must be rejected before kill");
    })).toBe(false);
    expect(killCodexProcessGroup(42_425, "SIGKILL", () => {
      throw new Error("Process no longer exists");
    })).toBe(false);
  });

  it("settles the process promise when the child closes stdin early", async () => {
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
  });
});
