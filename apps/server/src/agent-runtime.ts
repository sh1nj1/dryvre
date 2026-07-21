import { randomUUID } from "node:crypto";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import {
  agentBindings,
  agentRuns,
  blocks,
  refs,
  subjects,
  type DryvreDatabase,
} from "@dryvre/db";
import {
  blockOpSchema,
  compileSkills,
  parseAgentDefinition,
  sortBlocksInDocumentOrder,
  type AgentRun,
  type Block,
  type CreateAgentRun,
} from "@dryvre/shared";
import type { AppConfig } from "./config.js";
import {
  applyOperation,
  applyOperationInTransaction,
  getAiContext,
} from "./block-service.js";
import {
  checkCodexReadiness,
  resolveAgentWorkspace,
  runCodex,
  stopCodexProcess,
} from "./codex-runner.js";

function serializeBlock(row: typeof blocks.$inferSelect): Block {
  return {
    id: row.id,
    parentId: row.parentId,
    path: row.path,
    rank: row.rank,
    bodyMd: row.bodyMd,
    status: row.status,
    authorId: row.authorId,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function serializeRun(row: typeof agentRuns.$inferSelect): AgentRun {
  return {
    id: row.id,
    agentBlockId: row.agentBlockId,
    targetBlockId: row.targetBlockId,
    requestedBy: row.requestedBy,
    status: row.status,
    codexSessionId: row.codexSessionId,
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    errorCode: row.errorCode,
  };
}

function errorCode(error: unknown) {
  const value = error as NodeJS.ErrnoException;
  if (value.code === "ENOENT") return "codex_not_found";
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("auth") || message.includes("login"))
    return "auth_required";
  if (message.includes("workspace")) return "invalid_workspace";
  if (message.includes("skill") || message.includes("agent"))
    return "invalid_definition";
  return "runner_failed";
}

export async function createAgentRuntime(
  db: DryvreDatabase,
  config: AppConfig,
  publish: (message: unknown) => void,
) {
  const children = new Map<string, ChildProcessWithoutNullStreams>();
  const cancelled = new Set<string>();
  const activeAgents = new Set<string>();
  await db
    .update(agentRuns)
    .set({
      status: "failed",
      errorCode: "server_restarted",
      finishedAt: new Date(),
      pid: null,
    })
    .where(inArray(agentRuns.status, ["queued", "running"]));

  async function readDefinition(agentBlockId: string) {
    const rows = await db.select().from(blocks);
    const allBlocks = sortBlocksInDocumentOrder(rows.map(serializeBlock));
    const agent = allBlocks.find((block) => block.id === agentBlockId);
    if (!agent) throw new Error("Agent block not found");
    const definition = parseAgentDefinition(agent, allBlocks);
    const links = await db
      .select({ toBlockId: refs.toBlockId })
      .from(refs)
      .where(eq(refs.fromBlockId, agentBlockId));
    const skills = compileSkills(allBlocks, [
      agentBlockId,
      ...links.map((link) => link.toBlockId),
    ]);
    return { agent, definition, skills };
  }

  async function ensureAgentSubject(agentBlockId: string, slug: string) {
    const existing = await db.query.agentBindings.findFirst({
      where: eq(agentBindings.agentBlockId, agentBlockId),
    });
    if (existing) return existing.subjectId;
    return db.transaction(async (tx) => {
      const subjectId = randomUUID();
      await tx
        .insert(subjects)
        .values({
          id: subjectId,
          kind: "agent",
          handle: `agent-${agentBlockId}`,
          displayName: slug,
        });
      await tx.insert(agentBindings).values({ agentBlockId, subjectId });
      return subjectId;
    });
  }

  async function finishFailure(
    runId: string,
    targetBlockId: string,
    authorId: string,
    code: string,
  ) {
    if (cancelled.has(runId)) return;
    const [transitioned] = await db
      .update(agentRuns)
      .set({
        status: "failed",
        errorCode: code,
        finishedAt: new Date(),
        pid: null,
      })
      .where(
        and(
          eq(agentRuns.id, runId),
          inArray(agentRuns.status, ["queued", "running"]),
        ),
      )
      .returning({ id: agentRuns.id });
    if (!transitioned) return;
    const blockId = randomUUID();
    const envelope = {
      clientOpId: randomUUID(),
      op: {
        type: "create" as const,
        id: blockId,
        parentId: targetBlockId,
        bodyMd: `> Agent run failed: ${code}`,
        stream: true,
      },
    };
    try {
      const applied = await applyOperation(db, envelope, authorId);
      publish({ type: "applied", clientOpId: envelope.clientOpId, ...applied });
    } catch { /* the run status remains the durable failure signal */ }
    publish({ type: "agent_run_finished", runId, errorCode: code });
  }

  async function execute(
    runId: string,
    input: CreateAgentRun,
    requestedBy: string,
  ) {
    let agentSubjectId: string | null = null;
    try {
      if (cancelled.has(runId)) return;
      const { definition, skills } = await readDefinition(input.agentBlockId);
      agentSubjectId = await ensureAgentSubject(
        input.agentBlockId,
        definition.slug,
      );
      const workspace = await resolveAgentWorkspace(
        config,
        definition.config.workspace,
      );
      const context = await getAiContext(db, input.targetBlockId);
      const previous = input.resume
        ? await db.query.agentRuns.findFirst({
            where: and(
              eq(agentRuns.agentBlockId, input.agentBlockId),
              eq(agentRuns.workspace, workspace),
              eq(agentRuns.status, "succeeded"),
              isNotNull(agentRuns.codexSessionId),
            ),
            orderBy: [desc(agentRuns.createdAt)],
          })
        : null;
      const skillNames =
        skills.map((skill) => `$${skill.slug}`).join(", ") || "(none)";
      const prompt = [
        "# Agent instructions",
        definition.instructions,
        "# Available Dryvre skills",
        skillNames,
        "# Focused Dryvre context",
        context,
        "# User request",
        input.prompt,
        "# Output contract",
        "Finish with a concise Markdown summary. Dryvre stores the final message as a first-class block.",
      ].join("\n\n");
      if (cancelled.has(runId)) return;
      const [started] = await db
        .update(agentRuns)
        .set({ status: "running", workspace, startedAt: new Date() })
        .where(and(eq(agentRuns.id, runId), eq(agentRuns.status, "queued")))
        .returning({ id: agentRuns.id });
      if (!started || cancelled.has(runId)) return;
      publish({ type: "agent_run_status", runId, status: "running" });
      const result = await runCodex({
        config,
        runId,
        agentBlockId: input.agentBlockId,
        agentConfig: definition.config,
        skills,
        prompt,
        workspace,
        resumeSessionId: previous?.codexSessionId ?? null,
        onSpawn: (child) => {
          if (cancelled.has(runId)) {
            stopCodexProcess(child);
            return;
          }
          children.set(runId, child);
          void db
            .update(agentRuns)
            .set({ pid: child.pid ?? null })
            .where(eq(agentRuns.id, runId))
            .catch(() => undefined);
        },
      });
      children.delete(runId);
      if (cancelled.has(runId)) return;
      if (result.timedOut) {
        await finishFailure(
          runId,
          input.targetBlockId,
          agentSubjectId,
          "timeout",
        );
        return;
      }
      if (result.exitCode !== 0 || result.errorMessage) {
        await finishFailure(
          runId,
          input.targetBlockId,
          agentSubjectId,
          "codex_failed",
        );
        return;
      }
      if (!result.summary) {
        await finishFailure(
          runId,
          input.targetBlockId,
          agentSubjectId,
          "empty_output",
        );
        return;
      }
      const resultBlockId = randomUUID();
      const op = blockOpSchema.safeParse({
        type: "create",
        id: resultBlockId,
        parentId: input.targetBlockId,
        bodyMd: result.summary,
        stream: true,
      });
      if (!op.success) {
        await finishFailure(
          runId,
          input.targetBlockId,
          agentSubjectId,
          "invalid_output",
        );
        return;
      }
      const envelope = {
        clientOpId: randomUUID(),
        op: op.data,
      };
      if (!agentSubjectId) throw new Error("Agent subject is unavailable");
      const resultAuthorId = agentSubjectId;
      const applied = await db.transaction(async (tx) => {
        const [completed] = await tx
          .update(agentRuns)
          .set({
            status: "succeeded",
            codexSessionId: result.sessionId,
            finishedAt: new Date(),
            pid: null,
          })
          .where(and(eq(agentRuns.id, runId), eq(agentRuns.status, "running")))
          .returning({ id: agentRuns.id });
        if (!completed) return null;
        return applyOperationInTransaction(tx, envelope, resultAuthorId);
      });
      if (!applied) return;
      publish({ type: "applied", clientOpId: envelope.clientOpId, ...applied });
      publish({ type: "agent_run_output", runId, text: result.summary });
      publish({ type: "agent_run_finished", runId, resultBlockId });
    } catch (error) {
      children.delete(runId);
      await finishFailure(
        runId,
        input.targetBlockId,
        agentSubjectId ?? requestedBy,
        errorCode(error),
      );
    } finally {
      activeAgents.delete(input.agentBlockId);
    }
  }

  return {
    async readiness() {
      return checkCodexReadiness(config);
    },
    async validate(agentBlockId: string) {
      const { definition, skills } = await readDefinition(agentBlockId);
      await resolveAgentWorkspace(config, definition.config.workspace);
      return {
        valid: true,
        agent: definition,
        skills: skills.map((skill) => ({
          slug: skill.slug,
          files: skill.files.length,
        })),
      };
    },
    async start(input: CreateAgentRun, requestedBy: string) {
      if (activeAgents.has(input.agentBlockId)) throw new Error("agent_busy");
      if (activeAgents.size >= 2) throw new Error("runner_busy");
      activeAgents.add(input.agentBlockId);
      try {
      const activeForAgent = await db.query.agentRuns.findFirst({
        where: and(
          eq(agentRuns.agentBlockId, input.agentBlockId),
          inArray(agentRuns.status, ["queued", "running"]),
        ),
      });
      const active = await db
        .select({ id: agentRuns.id })
        .from(agentRuns)
        .where(inArray(agentRuns.status, ["queued", "running"]));
      if (activeForAgent) throw new Error("agent_busy");
      if (active.length >= 2) throw new Error("runner_busy");
      await readDefinition(input.agentBlockId);
      const [row] = await db
        .insert(agentRuns)
        .values({
          agentBlockId: input.agentBlockId,
          targetBlockId: input.targetBlockId,
          requestedBy,
        })
        .returning();
      if (!row) throw new Error("Could not create Agent run");
      publish({ type: "agent_run_status", runId: row.id, status: "queued" });
      void execute(row.id, input, requestedBy).catch(() => undefined);
      return serializeRun(row);
      } catch (error) {
        activeAgents.delete(input.agentBlockId);
        throw error;
      }
    },
    async get(runId: string) {
      const row = await db.query.agentRuns.findFirst({
        where: eq(agentRuns.id, runId),
      });
      return row ? serializeRun(row) : null;
    },
    async cancel(runId: string) {
      const row = await db.query.agentRuns.findFirst({
        where: eq(agentRuns.id, runId),
      });
      if (!row) return null;
      if (row.status !== "queued" && row.status !== "running")
        return serializeRun(row);
      cancelled.add(runId);
      const child = children.get(runId);
      if (child) stopCodexProcess(child);
      children.delete(runId);
      const [updated] = await db
        .update(agentRuns)
        .set({
          status: "cancelled",
          finishedAt: new Date(),
          pid: null,
          errorCode: "cancelled",
        })
        .where(
          and(
            eq(agentRuns.id, runId),
            inArray(agentRuns.status, ["queued", "running"]),
          ),
        )
        .returning();
      if (!updated) {
        const current = await db.query.agentRuns.findFirst({
          where: eq(agentRuns.id, runId),
        });
        return current ? serializeRun(current) : null;
      }
      publish({ type: "agent_run_finished", runId, errorCode: "cancelled" });
      return serializeRun(updated);
    },
    async close() {
      for (const [runId, child] of children) {
        cancelled.add(runId);
        stopCodexProcess(child);
      }
      children.clear();
    },
  };
}

export type AgentRuntime = Awaited<ReturnType<typeof createAgentRuntime>>;
