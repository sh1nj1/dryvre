import { z } from 'zod';

export const blockStatusSchema = z.enum(['todo', 'in_progress', 'blocked', 'done']);
export type BlockStatus = z.infer<typeof blockStatusSchema>;

export const blockSchema = z.object({
  id: z.string().uuid(),
  parentId: z.string().uuid().nullable(),
  path: z.string(),
  rank: z.string().nullable(),
  bodyMd: z.string(),
  status: blockStatusSchema.nullable(),
  authorId: z.string().uuid(),
  version: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Block = z.infer<typeof blockSchema>;

const id = z.string().uuid();
const version = z.number().int().nonnegative().optional();

export const blockOpSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('create'), id: id.optional(), parentId: id.nullable(), afterId: id.optional(), bodyMd: z.string().max(100_000), stream: z.boolean().default(false) }),
  z.object({ type: z.literal('move'), id, parentId: id.nullable(), rank: z.string().nullable(), version }),
  z.object({ type: z.literal('edit'), id, bodyMd: z.string().max(100_000), version }),
  z.object({ type: z.literal('setStatus'), id, status: blockStatusSchema.nullable(), version }),
  z.object({ type: z.literal('ref'), fromId: id, toId: id }),
  z.object({ type: z.literal('unref'), fromId: id, toId: id }),
  z.object({ type: z.literal('delete'), id, version }),
]);
export type BlockOp = z.infer<typeof blockOpSchema>;

export const opEnvelopeSchema = z.object({
  clientOpId: z.string().uuid(),
  op: blockOpSchema,
});
export type OpEnvelope = z.infer<typeof opEnvelopeSchema>;

export const agentRunStatusSchema = z.enum([
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
]);
export type AgentRunStatus = z.infer<typeof agentRunStatusSchema>;

export const wsServerMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready'), actorId: id }),
  z.object({ type: z.literal('applied'), clientOpId: id, sequence: z.number().int(), op: blockOpSchema }),
  z.object({ type: z.literal('rejected'), clientOpId: id, reason: z.string() }),
  z.object({ type: z.literal('agent_run_status'), runId: id, status: agentRunStatusSchema }),
  z.object({ type: z.literal('agent_run_output'), runId: id, text: z.string() }),
  z.object({ type: z.literal('agent_run_finished'), runId: id, resultBlockId: id.optional(), errorCode: z.string().optional() }),
]);
export type WsServerMessage = z.infer<typeof wsServerMessageSchema>;

export type TreeNode = Block & { children: TreeNode[] };

export function deriveBlockKind(bodyMd: string) {
  if (/^```/.test(bodyMd)) return 'code';
  if (/^#{1,6}\s/.test(bodyMd)) return 'heading';
  if (/^(?:[-*+] |\d+\. )/.test(bodyMd)) return 'list';
  return 'paragraph';
}

export const agentConfigSchema = z
  .object({
    workspace: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    model: z.string().min(1).max(100).optional(),
    reasoningEffort: z
      .enum(["minimal", "low", "medium", "high", "xhigh"])
      .optional(),
  })
  .strict();
export type AgentConfig = z.infer<typeof agentConfigSchema>;

export const createAgentRunSchema = z.object({
  agentBlockId: id,
  targetBlockId: id,
  prompt: z.string().trim().min(1).max(20_000),
  resume: z.boolean().default(true),
});
export type CreateAgentRun = z.infer<typeof createAgentRunSchema>;

export const agentRunSchema = z.object({
  id,
  agentBlockId: id,
  targetBlockId: id,
  requestedBy: id,
  status: agentRunStatusSchema,
  codexSessionId: z.string().nullable(),
  startedAt: z.string().datetime().nullable(),
  finishedAt: z.string().datetime().nullable(),
  errorCode: z.string().nullable(),
});
export type AgentRun = z.infer<typeof agentRunSchema>;

export type BlockDirective = { kind: "agent" | "skill"; slug: string };

const directivePattern =
  /^#\s+@(agent|skill)\s+([a-z0-9][a-z0-9-]*)\s*(?:\r?\n|$)/;
const agentConfigPattern = /^```agent-config\s*\r?\n([\s\S]*?)\r?\n```\s*$/;
const skillFilePattern = /^```file:([^\r\n]+)\s*\r?\n([\s\S]*?)\r?\n```\s*$/;

export function parseBlockDirective(bodyMd: string): BlockDirective | null {
  const match = bodyMd.match(directivePattern);
  if (!match?.[1] || !match[2]) return null;
  return { kind: match[1] as BlockDirective["kind"], slug: match[2] };
}

function bodyAfterDirective(bodyMd: string) {
  return bodyMd.replace(directivePattern, "").trim();
}

export function parseAgentDefinition(agent: Block, children: Block[]) {
  const directive = parseBlockDirective(agent.bodyMd);
  if (directive?.kind !== "agent")
    throw new Error("Block is not an Agent definition");
  const directChildren = children.filter(
    (block) => block.parentId === agent.id,
  );
  const configBlocks = directChildren.filter((block) =>
    agentConfigPattern.test(block.bodyMd),
  );
  if (configBlocks.length !== 1)
    throw new Error("Agent requires exactly one direct agent-config block");
  const configMatch = configBlocks[0]!.bodyMd.match(agentConfigPattern);
  let configValue: unknown;
  try {
    configValue = JSON.parse(configMatch?.[1] ?? "");
  } catch {
    throw new Error("Agent config must contain valid JSON");
  }
  const config = agentConfigSchema.parse(configValue);
  const instructions = [
    bodyAfterDirective(agent.bodyMd),
    ...directChildren
      .filter(
        (block) =>
          !agentConfigPattern.test(block.bodyMd) &&
          parseBlockDirective(block.bodyMd)?.kind !== "skill",
      )
      .map((block) => block.bodyMd.trim()),
  ]
    .filter(Boolean)
    .join("\n\n");
  if (!instructions) throw new Error("Agent requires instructions");
  return { slug: directive.slug, instructions, config };
}

export type CompiledSkill = {
  slug: string;
  skillMd: string;
  files: Array<{ path: string; content: string }>;
};

function safeSkillPath(value: string) {
  const candidate = value.trim().replaceAll("\\", "/");
  if (
    !candidate ||
    candidate.startsWith("/") ||
    candidate.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error(`Unsafe Skill file path: ${value}`);
  }
  return candidate;
}

function yamlString(value: string) {
  return JSON.stringify(value.replace(/\s+/g, " ").trim());
}

export function sortBlocksInDocumentOrder(blocks: Block[]) {
  const ids = new Set(blocks.map((block) => block.id));
  const children = new Map<string | null, Block[]>();
  for (const block of blocks) {
    const parentId = block.parentId && ids.has(block.parentId)
      ? block.parentId
      : null;
    const siblings = children.get(parentId) ?? [];
    siblings.push(block);
    children.set(parentId, siblings);
  }
  const compare = (left: Block, right: Block) => {
    if (left.rank === null && right.rank !== null) return 1;
    if (left.rank !== null && right.rank === null) return -1;
    const byRank = (left.rank ?? "").localeCompare(right.rank ?? "");
    if (byRank) return byRank;
    const byCreatedAt = left.createdAt.localeCompare(right.createdAt);
    return byCreatedAt || left.id.localeCompare(right.id);
  };
  for (const siblings of children.values()) siblings.sort(compare);

  const ordered: Block[] = [];
  const visited = new Set<string>();
  const visit = (block: Block) => {
    if (visited.has(block.id)) return;
    visited.add(block.id);
    ordered.push(block);
    for (const child of children.get(block.id) ?? []) visit(child);
  };
  for (const root of children.get(null) ?? []) visit(root);
  for (const block of [...blocks].sort(compare)) visit(block);
  return ordered;
}

export function compileSkills(
  blocks: Block[],
  scopeRootIds: string[],
): CompiledSkill[] {
  const byId = new Map(blocks.map((block) => [block.id, block]));
  const roots = scopeRootIds
    .map((rootId) => byId.get(rootId))
    .filter((block): block is Block => Boolean(block));
  const inScope = (block: Block) =>
    roots.some(
      (root) => block.id === root.id || block.path.startsWith(root.path),
    );
  const skillRoots = blocks.filter(
    (block) =>
      inScope(block) && parseBlockDirective(block.bodyMd)?.kind === "skill",
  );
  const seen = new Set<string>();

  return skillRoots.map((skillRoot) => {
    const directive = parseBlockDirective(skillRoot.bodyMd)!;
    if (seen.has(directive.slug))
      throw new Error(`Duplicate Skill slug: ${directive.slug}`);
    seen.add(directive.slug);
    const descendants = blocks.filter(
      (block) =>
        block.id !== skillRoot.id && block.path.startsWith(skillRoot.path),
    );
    const nestedRoots = skillRoots.filter(
      (nested) =>
        nested.id !== skillRoot.id && nested.path.startsWith(skillRoot.path),
    );
    const belongsToSkill = (block: Block) =>
      !nestedRoots.some((nested) => block.path.startsWith(nested.path));
    const ownBlocks = descendants.filter(belongsToSkill);
    const files = ownBlocks.flatMap((block) => {
      const match = block.bodyMd.match(skillFilePattern);
      return match?.[1]
        ? [{ path: safeSkillPath(match[1]), content: match[2] ?? "" }]
        : [];
    });
    const duplicateFile = files.find(
      (file, index) =>
        files.findIndex((candidate) => candidate.path === file.path) !== index,
    );
    if (duplicateFile)
      throw new Error(`Duplicate Skill file path: ${duplicateFile.path}`);
    const prose = [
      bodyAfterDirective(skillRoot.bodyMd),
      ...ownBlocks
        .filter((block) => !skillFilePattern.test(block.bodyMd))
        .map((block) => block.bodyMd.trim()),
    ].filter(Boolean);
    if (!prose.length)
      throw new Error(`Skill ${directive.slug} requires a description`);
    const description = prose[0]!
      .split(/\r?\n\r?\n/)[0]!
      .replace(/^#+\s*/, "")
      .trim();
    return {
      slug: directive.slug,
      skillMd: `---\nname: ${directive.slug}\ndescription: ${yamlString(description)}\n---\n\n${prose.join("\n\n")}\n`,
      files,
    };
  });
}

export type CodexJsonlResult = {
  sessionId: string | null;
  summary: string;
  errorMessage: string | null;
  usage: {
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
  };
};

export function parseCodexJsonl(stdout: string): CodexJsonlResult {
  let sessionId: string | null = null;
  let summary = "";
  let errorMessage: string | null = null;
  const usage = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 };
  for (const rawLine of stdout.split(/\r?\n/)) {
    if (!rawLine.trim()) continue;
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(rawLine) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (event.type === "thread.started" && typeof event.thread_id === "string")
      sessionId = event.thread_id;
    if (event.type === "error" && typeof event.message === "string")
      errorMessage = event.message;
    if (
      event.type === "item.completed" &&
      event.item &&
      typeof event.item === "object"
    ) {
      const item = event.item as Record<string, unknown>;
      if (item.type === "agent_message" && typeof item.text === "string")
        summary = item.text.trim();
    }
    if (
      event.type === "turn.completed" &&
      event.usage &&
      typeof event.usage === "object"
    ) {
      const value = event.usage as Record<string, unknown>;
      if (typeof value.input_tokens === "number")
        usage.inputTokens = value.input_tokens;
      if (typeof value.cached_input_tokens === "number")
        usage.cachedInputTokens = value.cached_input_tokens;
      if (typeof value.output_tokens === "number")
        usage.outputTokens = value.output_tokens;
    }
    if (
      event.type === "turn.failed" &&
      event.error &&
      typeof event.error === "object"
    ) {
      const value = event.error as Record<string, unknown>;
      if (typeof value.message === "string") errorMessage = value.message;
    }
  }
  return { sessionId, summary, errorMessage, usage };
}

export function isUnknownCodexSession(stdout: string, stderr: string) {
  return /unknown (session|thread)|session .* not found|thread .* not found|conversation .* not found|no rollout found for thread id/i.test(
    `${stdout}\n${stderr}`,
  );
}
