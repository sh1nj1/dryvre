import { describe, expect, it } from 'vitest';
import { blockOpSchema, compileSkills, deriveBlockKind, parseAgentDefinition, parseAgentTriggers, parseBlockDirective, parseCodexJsonl, sortBlocksInDocumentOrder, wsServerMessageSchema, type Block } from './index.js';

const baseBlock = (overrides: Partial<Block>): Block => ({
  id: crypto.randomUUID(),
  parentId: null,
  path: '/',
  rank: 'a',
  bodyMd: '',
  status: null,
  authorId: crypto.randomUUID(),
  version: 0,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
});

describe('shared block contract', () => {
  it('derives presentation from markdown instead of storing a kind', () => {
    expect(deriveBlockKind('## Plan')).toBe('heading');
    expect(deriveBlockKind('- ship it')).toBe('list');
  });

  it('rejects unknown operations', () => {
    expect(blockOpSchema.safeParse({ type: 'archive', id: crypto.randomUUID() }).success).toBe(false);
  });

  it('rejects block bodies above the shared protocol limit', () => {
    expect(blockOpSchema.safeParse({ type: 'create', parentId: null, bodyMd: 'x'.repeat(100_001), stream: true }).success).toBe(false);
  });

  it('accepts every defined task status, including blocked', () => {
    const id = crypto.randomUUID();
    for (const status of ['todo', 'in_progress', 'blocked', 'done']) {
      expect(blockOpSchema.safeParse({ type: 'setStatus', id, status }).success).toBe(true);
    }
  });
});

describe('Agent live events', () => {
  it('accepts status and completion events with a focused result block', () => {
    const runId = '00000000-0000-4000-8000-000000000070';
    const resultBlockId = '00000000-0000-4000-8000-000000000071';
    expect(wsServerMessageSchema.parse({ type: 'agent_run_status', runId, status: 'running' })).toEqual({ type: 'agent_run_status', runId, status: 'running' });
    expect(wsServerMessageSchema.parse({ type: 'agent_run_finished', runId, resultBlockId })).toEqual({ type: 'agent_run_finished', runId, resultBlockId });
  });
});

describe("agent and skill contracts", () => {
  it("parses an Agent with a strict config child", () => {
    const agent = baseBlock({
      bodyMd: "# @agent engineer\nImplement focused changes.",
      path: "/agent/",
    });
    const config = baseBlock({
      parentId: agent.id,
      path: "/agent/config/",
      bodyMd:
        '```agent-config\n{"workspace":"dryvre","reasoningEffort":"medium"}\n```',
    });
    expect(parseBlockDirective(agent.bodyMd)).toEqual({
      kind: "agent",
      slug: "engineer",
    });
    expect(parseAgentDefinition(agent, [config])).toMatchObject({
      slug: "engineer",
      config: { workspace: "dryvre" },
    });
  });

  it("parses declarative Agent event triggers without adding them to instructions", () => {
    const agent = baseBlock({
      bodyMd: "# @agent developer-agent\nValidate before executing.",
      path: "/agent/",
    });
    const config = baseBlock({
      parentId: agent.id,
      path: "/agent/config/",
      bodyMd: '```agent-config\n{"workspace":"dryvre"}\n```',
    });
    const trigger = baseBlock({
      parentId: agent.id,
      path: "/agent/trigger/",
      bodyMd: '```agent-trigger\n{"event":"status_changed","toStatus":"todo","mention":"Developer Agent","workflow":"task_loop","actorKind":"human"}\n```',
    });
    expect(parseAgentTriggers(agent, [config, trigger])).toEqual([{
      blockId: trigger.id,
      trigger: {
        event: "status_changed",
        toStatus: "todo",
        mention: "Developer Agent",
        workflow: "task_loop",
        actorKind: "human",
      },
    }]);
    expect(parseAgentDefinition(agent, [config, trigger]).instructions).toBe("Validate before executing.");
  });

  it("compiles nested Skill blocks without folding child Skill prose into the parent", () => {
    const collection = baseBlock({ path: "/skills/" });
    const parent = baseBlock({
      parentId: collection.id,
      path: "/skills/release/",
      bodyMd: "# @skill release\nRun release checks.",
    });
    const script = baseBlock({
      parentId: parent.id,
      path: "/skills/release/script/",
      bodyMd: "```file:scripts/check.sh\nnpm test\n```",
    });
    const nested = baseBlock({
      parentId: parent.id,
      path: "/skills/release/docs/",
      bodyMd: "# @skill docs\nReview documentation.",
    });
    const compiled = compileSkills(
      [collection, parent, script, nested],
      [collection.id],
    );
    expect(compiled.map((skill) => skill.slug)).toEqual(["release", "docs"]);
    expect(compiled[0]?.skillMd).not.toContain("Review documentation");
    expect(compiled[0]?.files).toEqual([
      { path: "scripts/check.sh", content: "npm test" },
    ]);
  });

  it("sorts shuffled blocks in tree and sibling rank order", () => {
    const root = baseBlock({ id: "00000000-0000-4000-8000-000000000001", path: "/root/", rank: "a" });
    const later = baseBlock({ id: "00000000-0000-4000-8000-000000000002", parentId: root.id, path: "/root/later/", rank: "b" });
    const earlier = baseBlock({ id: "00000000-0000-4000-8000-000000000003", parentId: root.id, path: "/root/earlier/", rank: "a" });
    const nested = baseBlock({ id: "00000000-0000-4000-8000-000000000004", parentId: earlier.id, path: "/root/earlier/nested/", rank: "a" });
    const olderMessage = baseBlock({ id: "ffffffff-ffff-4fff-8fff-ffffffffffff", parentId: root.id, path: "/root/older-message/", rank: null, createdAt: "2026-07-22T01:00:00.000Z" });
    const newerMessage = baseBlock({ id: "00000000-0000-4000-8000-000000000005", parentId: root.id, path: "/root/newer-message/", rank: null, createdAt: "2026-07-22T02:00:00.000Z" });
    expect(sortBlocksInDocumentOrder([newerMessage, later, nested, olderMessage, root, earlier]).map((block) => block.id)).toEqual([
      root.id,
      earlier.id,
      nested.id,
      later.id,
      olderMessage.id,
      newerMessage.id,
    ]);
  });

  it("rejects path traversal in Skill files", () => {
    const skill = baseBlock({
      path: "/skill/",
      bodyMd: "# @skill unsafe\nUnsafe fixture.",
    });
    const file = baseBlock({
      parentId: skill.id,
      path: "/skill/file/",
      bodyMd: "```file:../secret\nnope\n```",
    });
    expect(() => compileSkills([skill, file], [skill.id])).toThrow(
      "Unsafe Skill file path",
    );
  });

  it("parses Codex JSONL session, final output, usage and failures", () => {
    const parsed = parseCodexJsonl(
      [
        '{"type":"thread.started","thread_id":"thread-1"}',
        '{"type":"item.completed","item":{"type":"agent_message","text":"Done"}}',
        '{"type":"turn.completed","usage":{"input_tokens":12,"cached_input_tokens":3,"output_tokens":5}}',
      ].join("\n"),
    );
    expect(parsed).toEqual({
      sessionId: "thread-1",
      summary: "Done",
      errorMessage: null,
      usage: { inputTokens: 12, cachedInputTokens: 3, outputTokens: 5 },
    });
  });
});
