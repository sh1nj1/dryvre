import {
  execFile,
  spawn,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentConfig, CompiledSkill } from "@dryvre/shared";
import { isUnknownCodexSession, parseCodexJsonl } from "@dryvre/shared";
import type { AppConfig } from "./config.js";

const MAX_CAPTURE_BYTES = 1024 * 1024;
const STATIC_CODEX_FILES = ["config.json", "instructions.md"];
const execFileAsync = promisify(execFile);

function appendWithCap(current: string, chunk: string) {
  const combined = current + chunk;
  if (Buffer.byteLength(combined) <= MAX_CAPTURE_BYTES) return combined;
  return Buffer.from(combined)
    .subarray(-MAX_CAPTURE_BYTES)
    .toString("utf8")
    .replace(/^\uFFFD/, "");
}

async function exists(candidate: string) {
  return fs
    .access(candidate)
    .then(() => true)
    .catch(() => false);
}

async function seedCodexHome(target: string) {
  const source = path.resolve(
    process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex"),
  );
  await fs.mkdir(target, { recursive: true });
  if (source === path.resolve(target)) return;
  const sourceAuth = path.join(source, "auth.json");
  const targetAuth = path.join(target, "auth.json");
  if (
    (await exists(sourceAuth)) &&
    !(await fs.lstat(targetAuth).catch(() => null))
  )
    await fs.symlink(sourceAuth, targetAuth);
  for (const name of STATIC_CODEX_FILES) {
    const from = path.join(source, name);
    const to = path.join(target, name);
    if ((await exists(from)) && !(await exists(to)))
      await fs.copyFile(from, to);
  }
}

async function materializeSkills(codexHome: string, skills: CompiledSkill[]) {
  const root = path.join(codexHome, "skills");
  const temporary = path.join(codexHome, `skills.next-${crypto.randomUUID()}`);
  await fs.mkdir(temporary, { recursive: true });
  for (const skill of skills) {
    const skillRoot = path.join(temporary, skill.slug);
    await fs.mkdir(skillRoot, { recursive: true });
    await fs.writeFile(path.join(skillRoot, "SKILL.md"), skill.skillMd, {
      mode: 0o600,
    });
    for (const file of skill.files) {
      const target = path.join(skillRoot, ...file.path.split("/"));
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, file.content, {
        mode: file.path.startsWith("scripts/") ? 0o700 : 0o600,
      });
    }
  }
  await fs.rm(root, { recursive: true, force: true });
  await fs.rename(temporary, root);
}

export function buildManagedCodexConfig(mcpEntry: string) {
  return [
    "[mcp_servers.dryvre]",
    "enabled = true",
    "required = true",
    `command = ${JSON.stringify(process.execPath)}`,
    `args = [${JSON.stringify(mcpEntry)}]`,
    'env_vars = ["DRYVRE_URL", "DRYVRE_SESSION"]',
    'enabled_tools = ["dryvre_read_tree", "dryvre_create_block", "dryvre_edit_block"]',
    'default_tools_approval_mode = "approve"',
    "startup_timeout_sec = 10.0",
    "tool_timeout_sec = 60.0",
    "",
  ].join("\n");
}

function defaultMcpEntries(runtimeModuleUrl: string) {
  return [
    // Bundled server: dist/server/*.js -> dist/mcp/index.js
    fileURLToPath(new URL("../mcp/index.js", runtimeModuleUrl)),
    // Development source: apps/server/src/*.ts -> dist/mcp/index.js
    fileURLToPath(new URL("../../../dist/mcp/index.js", runtimeModuleUrl)),
  ];
}

export async function resolveMcpEntry(config: AppConfig, runtimeModuleUrl = import.meta.url) {
  const candidates = config.DRYVRE_AGENT_MCP_ENTRY
    ? [path.resolve(config.DRYVRE_AGENT_MCP_ENTRY)]
    : defaultMcpEntries(runtimeModuleUrl);
  for (const candidate of candidates) {
    const resolved = await fs.realpath(candidate).catch(() => undefined);
    if (resolved) return resolved;
  }
  throw new Error("dryvre_mcp_not_built");
}

async function materializeManagedConfig(codexHome: string, mcpEntry: string) {
  await fs.writeFile(
    path.join(codexHome, "config.toml"),
    buildManagedCodexConfig(mcpEntry),
    { mode: 0o600 },
  );
}

function parseWorkspaceMap(config: AppConfig) {
  if (!config.DRYVRE_AGENT_WORKSPACES) return { dryvre: process.cwd() };
  const parsed = JSON.parse(config.DRYVRE_AGENT_WORKSPACES) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("DRYVRE_AGENT_WORKSPACES must be a JSON object");
  const entries = Object.entries(parsed).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );
  if (!entries.length)
    throw new Error(
      "DRYVRE_AGENT_WORKSPACES must contain at least one workspace",
    );
  return Object.fromEntries(entries);
}

export async function resolveAgentWorkspace(config: AppConfig, name: string) {
  const configured = parseWorkspaceMap(config)[name];
  if (!configured) throw new Error(`Unknown Agent workspace: ${name}`);
  const workspace = await fs.realpath(path.resolve(configured));
  const allowedRoots = await Promise.all(
    Object.values(parseWorkspaceMap(config)).map((candidate) =>
      fs.realpath(path.resolve(candidate)),
    ),
  );
  if (
    !allowedRoots.some(
      (root) =>
        workspace === root || workspace.startsWith(`${root}${path.sep}`),
    )
  )
    throw new Error("Agent workspace is outside configured roots");
  return workspace;
}

export type CodexRunResult = ReturnType<typeof parseCodexJsonl> & {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

export function executeProcess(input: {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  prompt: string;
  timeoutMs: number;
  onSpawn: (child: ChildProcessWithoutNullStreams) => void;
}) {
  return new Promise<{
    exitCode: number | null;
    stdout: string;
    stderr: string;
    timedOut: boolean;
  }>((resolve, reject) => {
    const child = spawn(input.command, input.args, {
      cwd: input.cwd,
      env: input.env,
      shell: false,
      detached: process.platform !== "win32",
    });
    input.onSpawn(child);
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    child.stdout.on("data", (chunk: Buffer) => {
      stdout = appendWithCap(stdout, chunk.toString("utf8"));
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = appendWithCap(stderr, chunk.toString("utf8"));
    });
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    };
    child.once("error", fail);
    child.stdin.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EPIPE") return;
      fail(error);
    });
    const timeout = setTimeout(() => {
      timedOut = true;
      stopCodexProcess(child);
    }, input.timeoutMs);
    child.once("close", (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ exitCode, stdout, stderr, timedOut });
    });
    child.stdin.end(input.prompt);
  });
}

export async function runCodex(input: {
  config: AppConfig;
  runId: string;
  agentBlockId: string;
  agentConfig: AgentConfig;
  skills: CompiledSkill[];
  prompt: string;
  workspace: string;
  resumeSessionId: string | null;
  dryvreSession?: string | null;
  onSpawn: (child: ChildProcessWithoutNullStreams) => void;
}): Promise<CodexRunResult> {
  if (input.config.DRYVRE_AGENT_FAKE) {
    const stdout = [
      JSON.stringify({
        type: "thread.started",
        thread_id: `fake-${input.runId}`,
      }),
      JSON.stringify({
        type: "item.completed",
        item: {
          type: "agent_message",
          text: `## Demo Agent Result\n\n${input.prompt.slice(-500)}`,
        },
      }),
      JSON.stringify({
        type: "turn.completed",
        usage: { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0 },
      }),
    ].join("\n");
    return {
      exitCode: 0,
      stdout,
      stderr: "",
      timedOut: false,
      ...parseCodexJsonl(stdout),
    };
  }

  const codexHome = path.resolve(
    input.config.DRYVRE_AGENT_DATA_DIR,
    input.agentBlockId,
    "codex-home",
  );
  const mcpEntry = await resolveMcpEntry(input.config);
  await seedCodexHome(codexHome);
  await materializeSkills(codexHome, input.skills);
  await materializeManagedConfig(codexHome, mcpEntry);
  const baseArgs = [
    "exec",
    "--json",
    "--sandbox",
    "workspace-write",
    "-c",
    'approval_policy="never"',
    "--cd",
    input.workspace,
  ];
  if (input.agentConfig.model)
    baseArgs.push("--model", input.agentConfig.model);
  if (input.agentConfig.reasoningEffort)
    baseArgs.push(
      "-c",
      `model_reasoning_effort=${JSON.stringify(input.agentConfig.reasoningEffort)}`,
    );
  const args = input.resumeSessionId
    ? [...baseArgs, "resume", input.resumeSessionId, "-"]
    : [...baseArgs, "-"];
  const first = await executeProcess({
    command: input.config.CODEX_COMMAND,
    args,
    cwd: input.workspace,
    env: {
      ...process.env,
      CODEX_HOME: codexHome,
      NO_COLOR: "1",
      DRYVRE_URL:
        input.config.DRYVRE_AGENT_MCP_URL ??
        `http://127.0.0.1:${input.config.PORT}`,
      ...(input.dryvreSession
        ? { DRYVRE_SESSION: input.dryvreSession }
        : {}),
    },
    prompt: input.prompt,
    timeoutMs: input.config.DRYVRE_AGENT_TIMEOUT_MS,
    onSpawn: input.onSpawn,
  });
  if (
    input.resumeSessionId &&
    isUnknownCodexSession(first.stdout, first.stderr)
  ) {
    const fresh = await executeProcess({
      command: input.config.CODEX_COMMAND,
      args: [...baseArgs, "-"],
      cwd: input.workspace,
      env: {
        ...process.env,
        CODEX_HOME: codexHome,
        NO_COLOR: "1",
        DRYVRE_URL:
          input.config.DRYVRE_AGENT_MCP_URL ??
          `http://127.0.0.1:${input.config.PORT}`,
        ...(input.dryvreSession
          ? { DRYVRE_SESSION: input.dryvreSession }
          : {}),
      },
      prompt: input.prompt,
      timeoutMs: input.config.DRYVRE_AGENT_TIMEOUT_MS,
      onSpawn: input.onSpawn,
    });
    return { ...fresh, ...parseCodexJsonl(fresh.stdout) };
  }
  return { ...first, ...parseCodexJsonl(first.stdout) };
}

export function stopCodexProcess(child: ChildProcessWithoutNullStreams) {
  if (child.exitCode !== null || child.killed) return;
  try {
    if (process.platform === "win32") child.kill("SIGTERM");
    else if (child.pid) process.kill(-child.pid, "SIGTERM");
  } catch {
    return;
  }
  setTimeout(() => {
    if (child.exitCode !== null) return;
    try {
      if (process.platform === "win32") child.kill("SIGKILL");
      else if (child.pid) process.kill(-child.pid, "SIGKILL");
    } catch {
      /* process already exited */
    }
  }, 3_000).unref();
}

export function killCodexProcessGroup(
  pid: number,
  signal: NodeJS.Signals = "SIGKILL",
  kill: (target: number, signal: NodeJS.Signals) => boolean = process.kill,
) {
  if (!Number.isSafeInteger(pid) || pid <= 1 || pid === process.pid) return false;
  try {
    // Negative PID targets the detached process group on Unix. Windows has no
    // equivalent here, so restart reconciliation terminates only the persisted
    // leader PID and may leave descendants for a platform supervisor to clean up.
    // pid === process.pid prevents a direct self-kill, but cannot prove that a
    // recycled PID is not the server's Unix process-group ID; callers recovering
    // persisted PIDs must validate process identity in production.
    kill(process.platform === "win32" ? pid : -pid, signal);
    return true;
  } catch {
    return false;
  }
}

export async function checkCodexReadiness(config: AppConfig) {
  if (config.DRYVRE_AGENT_FAKE)
    return { ready: true, mode: "fake" as const, version: "fake" };
  try {
    const { stdout } = await execFileAsync(
      config.CODEX_COMMAND,
      ["--version"],
      { timeout: 5_000 },
    );
    const version = stdout.trim();
    try {
      await execFileAsync(config.CODEX_COMMAND, ["login", "status"], {
        timeout: 5_000,
      });
    } catch {
      return {
        ready: false,
        mode: "codex" as const,
        version,
        error: "auth_required",
      };
    }
    try {
      await resolveMcpEntry(config);
    } catch {
      return {
        ready: false,
        mode: "codex" as const,
        version,
        error: "dryvre_mcp_not_built",
      };
    }
    return { ready: true, mode: "codex" as const, version, mcp: "ready" as const };
  } catch {
    return { ready: false, mode: "codex" as const, error: "codex_not_found" };
  }
}
