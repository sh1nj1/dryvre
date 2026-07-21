import { randomUUID } from 'node:crypto';
import { and, eq, inArray, like } from 'drizzle-orm';
import {
  agentLoops,
  agentTriggerDeliveries,
  blocks,
  refs,
  subjectInboxes,
  subjects,
  type DryvreDatabase,
} from '@dryvre/db';
import {
  parseAgentTriggers,
  parseBlockDirective,
  sortBlocksInDocumentOrder,
  type AgentRun,
  type AgentTrigger,
  type Block,
  type BlockOp,
} from '@dryvre/shared';
import type { AgentRuntime } from './agent-runtime.js';
import { applyOperation, applyOperationInTransaction } from './block-service.js';
import type { LivePublisher } from './live.js';

type AppliedOperation = { sequence: number; op: BlockOp };
export type TriggerDefinition = {
  agentBlockId: string;
  triggerBlockId: string;
  trigger: AgentTrigger;
};

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

const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const mentions = (body: string, name: string) => body.toLocaleLowerCase().includes(`@${name}`.toLocaleLowerCase());

export function isAffirmativeApproval(body: string) {
  const negative = /\b(?:no|not|never|deny|denied|reject|rejected|decline|declined|don't|do not|cannot|can't)\b|(?:아니|거절|반대|하지\s*마|승인하지)/i;
  const affirmative = /\b(?:yes|approve|approved|allow|allowed|go ahead|proceed|publish publicly)\b|(?:승인|좋아|진행|공개해)/i;
  return affirmative.test(body) && !negative.test(body);
}

export function contractNeedsInput(context: string, approvalAnswer = '') {
  const required = ['Deliverable:', 'Completion criteria:', 'Constraints:', 'Verification:', '@Developer Agent'];
  const approvalField = context.match(/\*\*Public URL approval:\*\*\s*([^\n]+)/i)?.[1] ?? '';
  // Match approval only against the answer (or a directly-filled field), never the
  // whole context: negative wording in the contract itself (e.g. "Constraints: Do
  // not publish before approval") must not cancel out a genuine affirmative reply.
  const approved = isAffirmativeApproval(approvalAnswer) || isAffirmativeApproval(approvalField);
  const unresolvedApproval = Boolean(approvalField) && !approved;
  return unresolvedApproval || required.some((field) => !context.includes(field));
}

export function collectAgentTriggers(allBlocks: Block[]) {
  const definitions: TriggerDefinition[] = [];
  for (const agent of allBlocks.filter((block) => parseBlockDirective(block.bodyMd)?.kind === 'agent')) {
    for (const child of allBlocks.filter((block) => block.parentId === agent.id)) {
      try {
        for (const { blockId, trigger } of parseAgentTriggers(agent, [child])) {
          definitions.push({ agentBlockId: agent.id, triggerBlockId: blockId, trigger });
        }
      } catch {
        // Editable trigger blocks are isolated so one invalid definition cannot
        // disable unrelated subscriptions or reject the event dispatcher.
      }
    }
  }
  return definitions;
}

async function waitForRun(runtime: AgentRuntime, runId: string, isClosed: () => boolean) {
  while (!isClosed()) {
    const run = await runtime.get(runId);
    if (!run || !['queued', 'running'].includes(run.status)) return run;
    await delay(25);
  }
  return null;
}

export function createAgentEventRuntime(
  db: DryvreDatabase,
  agentRuntime: AgentRuntime,
  publish: LivePublisher,
) {
  const work = new Set<Promise<void>>();
  let closed = false;

  const emit = (result: AppliedOperation) => publish({
    type: 'applied',
    clientOpId: randomUUID(),
    ...result,
  });

  const schedule = (task: Promise<void>) => {
    const contained = task.catch(() => undefined);
    work.add(contained);
    void contained.finally(() => work.delete(contained));
  };

  async function loadTriggers() {
    const rows = await db.select().from(blocks);
    const allBlocks = sortBlocksInDocumentOrder(rows.map(serializeBlock));
    return collectAgentTriggers(allBlocks);
  }

  async function updateDelivery(definition: TriggerDefinition, operation: AppliedOperation, status: 'completed' | 'failed', error?: string) {
    await db.update(agentTriggerDeliveries).set({ status, error, updatedAt: new Date() }).where(and(
      eq(agentTriggerDeliveries.triggerBlockId, definition.triggerBlockId),
      eq(agentTriggerDeliveries.opSequence, operation.sequence),
    ));
  }

  async function runAgent(definition: TriggerDefinition, targetBlockId: string, prompt: string, requestedBy: string) {
    const run = await agentRuntime.start({
      agentBlockId: definition.agentBlockId,
      targetBlockId,
      prompt,
      resume: true,
    }, requestedBy);
    return waitForRun(agentRuntime, run.id, () => closed);
  }

  async function createDraftTask(definition: TriggerDefinition, source: typeof blocks.$inferSelect, requestedBy: string) {
    if (!source.parentId) throw new Error('A task-drafting message needs a parent block');
    const completed = await runAgent(definition, source.parentId, source.bodyMd, requestedBy);
    if (completed?.status !== 'succeeded') throw new Error(completed?.errorCode ?? 'pm_agent_failed');
    const authorId = await agentRuntime.subjectFor(definition.agentBlockId);
    const result = await applyOperation(db, {
      clientOpId: randomUUID(),
      op: {
        type: 'create',
        id: randomUUID(),
        parentId: source.parentId,
        bodyMd: [
          '## Publish and verify the Dryvre launch demo',
          '',
          '**Deliverable:** Publish the current Dryvre demo and record the final public URL.',
          '',
          '**Completion criteria:** The URL opens successfully and the complete Document → Board → Inbox → result flow is visible.',
          '',
          '**Constraints:** Keep the story under three minutes and preserve the same task block across every view.',
          '',
          '**Verification:** Open the public URL, exercise the deterministic scenario, and record the successful checks as child blocks.',
          '',
          '**Executor:** @Developer Agent',
          '',
          '**Public URL approval:** TBD',
        ].join('\n'),
        stream: false,
      },
    }, authorId);
    emit(result);
  }

  async function taskContext(task: typeof blocks.$inferSelect) {
    const descendants = await db.select().from(blocks).where(like(blocks.path, `${task.path}%`));
    const references = await db.select({ toBlockId: refs.toBlockId }).from(refs).where(eq(refs.fromBlockId, task.id));
    const referencedBlocks = references.length
      ? await db.select().from(blocks).where(inArray(blocks.id, references.map((reference) => reference.toBlockId)))
      : [];
    return [...descendants, ...referencedBlocks].map((block) => block.bodyMd).join('\n\n');
  }

  async function beginTaskLoop(definition: TriggerDefinition, task: typeof blocks.$inferSelect, requestedBy: string) {
    const context = await taskContext(task);
    const agentAuthorId = await agentRuntime.subjectFor(definition.agentBlockId);
    if (!contractNeedsInput(context)) {
      const [loop] = await db.insert(agentLoops).values({
        taskBlockId: task.id,
        triggerVersion: task.version,
        requestedBy,
        agentBlockId: definition.agentBlockId,
        state: 'ready',
      }).onConflictDoNothing().returning();
      if (loop) await claimAndRun(loop.id, task.id, task.version, definition, requestedBy, agentAuthorId, 'The task contract is complete. Execute it and verify the result.');
      return;
    }

    const inbox = await db.query.subjectInboxes.findFirst({ where: eq(subjectInboxes.subjectId, requestedBy) });
    const user = await db.query.subjects.findFirst({ where: eq(subjects.id, requestedBy) });
    if (!inbox) throw new Error('The requesting user has no Inbox');
    const requestBlockId = randomUUID();
    const emissions = await db.transaction(async (tx) => {
      const [loop] = await tx.insert(agentLoops).values({
        taskBlockId: task.id,
        triggerVersion: task.version,
        requestedBy,
        agentBlockId: definition.agentBlockId,
        state: 'checking',
      }).onConflictDoNothing().returning();
      if (!loop) return [];
      const createRequest = await applyOperationInTransaction(tx, {
        clientOpId: randomUUID(),
        op: {
          type: 'create',
          id: requestBlockId,
          parentId: inbox.blockId,
          bodyMd: [
            '## Approval required',
            '',
            `@${user?.displayName ?? 'Builder'}, may the final Dryvre demo URL be published publicly?`,
            '',
            'The Developer Agent will not publish or mark the task complete until you answer here.',
            '',
            `Original task: ${task.bodyMd.replace(/^#+\s*/, '').split('\n')[0]}`,
          ].join('\n'),
          stream: true,
        },
      }, agentAuthorId);
      const createReference = await applyOperationInTransaction(tx, {
        clientOpId: randomUUID(),
        op: { type: 'ref', fromId: requestBlockId, toId: task.id },
      }, agentAuthorId);
      await tx.update(agentLoops).set({
        state: 'waiting_input',
        requestBlockId,
        resumeStatus: 'todo',
        updatedAt: new Date(),
      }).where(eq(agentLoops.id, loop.id));
      const blockTask = await applyOperationInTransaction(tx, {
        clientOpId: randomUUID(),
        op: { type: 'setStatus', id: task.id, status: 'blocked', version: task.version },
      }, agentAuthorId);
      return [createRequest, createReference, blockTask];
    });
    emissions.forEach(emit);
  }

  async function claimAndRun(
    loopId: string,
    taskBlockId: string,
    version: number,
    definition: TriggerDefinition,
    requestedBy: string,
    agentAuthorId: string,
    prompt: string,
  ) {
    const claimed = await db.transaction(async (tx) => {
      const status = await applyOperationInTransaction(tx, {
        clientOpId: randomUUID(),
        op: { type: 'setStatus', id: taskBlockId, status: 'in_progress', version },
      }, agentAuthorId);
      await tx.update(agentLoops).set({ state: 'running', updatedAt: new Date() }).where(eq(agentLoops.id, loopId));
      return status;
    });
    emit(claimed);
    let run: AgentRun | null = null;
    let startedRun: AgentRun | null = null;
    try {
      startedRun = await agentRuntime.start({
        agentBlockId: definition.agentBlockId,
        targetBlockId: taskBlockId,
        prompt,
        resume: true,
      }, requestedBy);
      await db.update(agentLoops).set({ agentRunId: startedRun.id, updatedAt: new Date() }).where(eq(agentLoops.id, loopId));
      run = await waitForRun(agentRuntime, startedRun.id, () => closed);
      if (run?.status !== 'succeeded') throw new Error(run?.errorCode ?? 'developer_agent_failed');
      const task = await db.query.blocks.findFirst({ where: eq(blocks.id, taskBlockId) });
      if (!task) throw new Error('Task disappeared before verification');
      const emissions = await db.transaction(async (tx) => {
        await tx.update(agentLoops).set({ state: 'verifying', updatedAt: new Date() }).where(eq(agentLoops.id, loopId));
        const evidence = await applyOperationInTransaction(tx, {
          clientOpId: randomUUID(),
          op: {
            type: 'create',
            id: randomUUID(),
            parentId: taskBlockId,
            bodyMd: [
              '### Verification evidence',
              '',
              '- The deterministic Agent run completed successfully.',
              '- The result was written below the same canonical task block.',
              '- Document, Board, Inbox, and Stream retain the same task identity.',
            ].join('\n'),
            stream: false,
          },
        }, agentAuthorId);
        const done = await applyOperationInTransaction(tx, {
          clientOpId: randomUUID(),
          op: { type: 'setStatus', id: taskBlockId, status: 'done', version: task.version },
        }, agentAuthorId);
        await tx.update(agentLoops).set({ state: 'completed', updatedAt: new Date() }).where(eq(agentLoops.id, loopId));
        return [evidence, done];
      });
      emissions.forEach(emit);
    } catch (error) {
      if (!startedRun) {
        try {
          const restored = await applyOperation(db, {
            clientOpId: randomUUID(),
            op: { type: 'setStatus', id: taskBlockId, status: 'todo', version: version + 1 },
          }, agentAuthorId);
          emit(restored);
        } catch { /* a concurrent task change wins over automatic restoration */ }
      }
      await db.update(agentLoops).set({ state: 'failed', updatedAt: new Date() }).where(eq(agentLoops.id, loopId));
      throw error;
    }
  }

  async function resumeWaitingLoop(source: typeof blocks.$inferSelect, actorId: string) {
    if (!source.parentId || !source.bodyMd.trim()) return;
    const loops = await db.select().from(agentLoops).where(and(
      eq(agentLoops.requestBlockId, source.parentId),
      eq(agentLoops.state, 'waiting_input'),
      eq(agentLoops.requestedBy, actorId),
    ));
    for (const loop of loops) {
      const request = loop.requestBlockId
        ? await db.query.blocks.findFirst({ where: eq(blocks.id, loop.requestBlockId) })
        : null;
      if (/^## Approval required\b/i.test(request?.bodyMd ?? '') && !isAffirmativeApproval(source.bodyMd)) continue;
      const task = await db.query.blocks.findFirst({ where: eq(blocks.id, loop.taskBlockId) });
      if (!task || task.status !== 'blocked') continue;
      // A satisfied approval must not resume a task whose contract is still
      // incomplete: revalidate the ref-aware context and scope the approval to
      // this reply so an under-specified task cannot be claimed and marked done.
      // Leave it blocked instead; collecting each missing field is out of Lite scope.
      if (contractNeedsInput(await taskContext(task), source.bodyMd)) continue;
      const agentAuthorId = await agentRuntime.subjectFor(loop.agentBlockId);
      const emissions = await db.transaction(async (tx) => {
        const approvalEvidence = await applyOperationInTransaction(tx, {
          clientOpId: randomUUID(),
          op: { type: 'create', id: randomUUID(), parentId: task.id, bodyMd: `## Approval response\n\n${source.bodyMd}`, stream: false },
        }, agentAuthorId);
        const resumed = await applyOperationInTransaction(tx, {
          clientOpId: randomUUID(),
          op: { type: 'setStatus', id: task.id, status: loop.resumeStatus ?? 'todo', version: task.version },
        }, agentAuthorId);
        await tx.update(agentLoops).set({ state: 'ready', resumeStatus: null, updatedAt: new Date() }).where(eq(agentLoops.id, loop.id));
        return [approvalEvidence, resumed];
      });
      emissions.forEach(emit);
      const refreshed = await db.query.blocks.findFirst({ where: eq(blocks.id, task.id) });
      if (!refreshed) continue;
      const definition: TriggerDefinition = {
        agentBlockId: loop.agentBlockId,
        triggerBlockId: loop.agentBlockId,
        trigger: { event: 'status_changed', toStatus: 'todo', mention: 'Developer Agent', workflow: 'task_loop' },
      };
      await claimAndRun(
        loop.id,
        task.id,
        refreshed.version,
        definition,
        actorId,
        agentAuthorId,
        `The user answered the approval request: ${source.bodyMd}\n\nResume the same task, execute it, and verify the result.`,
      );
    }
  }

  async function processDelivery(definition: TriggerDefinition, operation: AppliedOperation, source: typeof blocks.$inferSelect, actorId: string) {
    try {
      if (definition.trigger.workflow === 'reply') {
        if (!source.parentId) throw new Error('A reply trigger needs a parent target');
        const run = await runAgent(definition, source.parentId, source.bodyMd, actorId);
        if (run?.status !== 'succeeded') throw new Error(run?.errorCode ?? 'agent_failed');
      } else if (definition.trigger.workflow === 'draft_task') {
        await createDraftTask(definition, source, actorId);
      } else {
        await beginTaskLoop(definition, source, actorId);
      }
      await updateDelivery(definition, operation, 'completed');
    } catch (error) {
      await updateDelivery(definition, operation, 'failed', error instanceof Error ? error.message : 'Agent event failed');
    }
  }

  async function process(operation: AppliedOperation, actorId: string) {
    if (closed || (operation.op.type !== 'create' && operation.op.type !== 'setStatus')) return;
    const sourceId = operation.op.id;
    if (!sourceId) return;
    const source = await db.query.blocks.findFirst({ where: eq(blocks.id, sourceId) });
    if (!source) return;
    if (operation.op.type === 'create') await resumeWaitingLoop(source, actorId);
    const actor = await db.query.subjects.findFirst({ where: eq(subjects.id, actorId) });
    // A status change must match the same ref-aware context the loop later runs on:
    // a `@Developer Agent` mention living in a referenced block (not a path descendant)
    // must still trigger, otherwise the loop is skipped before the ref-aware preflight.
    const context = operation.op.type === 'setStatus'
      ? await taskContext(source)
      : source.bodyMd;
    const triggers = await loadTriggers();
    for (const definition of triggers) {
      const trigger = definition.trigger;
      const eventMatches = operation.op.type === 'create'
        ? trigger.event === 'block_created'
        : trigger.event === 'status_changed' && trigger.toStatus === operation.op.status;
      if (!eventMatches || !mentions(context, trigger.mention)) continue;
      if (trigger.actorKind && trigger.actorKind !== actor?.kind) continue;
      if (trigger.event === 'block_created' && trigger.streamOnly && source.rank !== null) continue;
      const [delivery] = await db.insert(agentTriggerDeliveries).values({
        triggerBlockId: definition.triggerBlockId,
        opSequence: operation.sequence,
      }).onConflictDoNothing().returning();
      if (delivery) await processDelivery(definition, operation, source, actorId);
    }
  }

  return {
    dispatch(operation: AppliedOperation, actorId: string) {
      if (!closed) schedule(process(operation, actorId));
    },
    async close() {
      closed = true;
      await Promise.allSettled([...work]);
    },
  };
}

export type AgentEventRuntime = ReturnType<typeof createAgentEventRuntime>;
