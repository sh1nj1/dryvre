import { describe, expect, it } from 'vitest';
import type { Block } from '@dryvre/shared';
import { collectAgentTriggers, contractNeedsInput, isAffirmativeApproval } from './agent-events.js';

const completeContract = [
  'Deliverable: Ship the demo',
  'Completion criteria: Scenario passes',
  'Constraints: Stay in scope',
  'Verification: Run the e2e suite',
  '@Developer Agent',
  '**Public URL approval:** TBD',
].join('\n');

const block = (overrides: Partial<Block>): Block => ({
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

describe('Agent event safety', () => {
  it('requires affirmative approval and rejects explicit denial', () => {
    expect(isAffirmativeApproval('Approved. Publish the URL publicly.')).toBe(true);
    expect(isAffirmativeApproval('No, do not publish the URL.')).toBe(false);
    expect(isAffirmativeApproval('I have a question first.')).toBe(false);
  });

  it('keeps blocking when an affirmative approval leaves other contract fields missing', () => {
    // Approval satisfied, but the required Verification section is absent.
    const missingVerification = completeContract
      .replace('Verification: Run the e2e suite\n', '')
      .concat('\n## Approval response\n\nApproved. Publish it publicly.');
    expect(isAffirmativeApproval(missingVerification)).toBe(true);
    expect(contractNeedsInput(missingVerification)).toBe(true);
  });

  it('clears input once approval is affirmative and every field is present', () => {
    const answered = `${completeContract}\n## Approval response\n\nApproved. Publish it publicly.`;
    expect(contractNeedsInput(completeContract)).toBe(true);
    expect(contractNeedsInput(answered)).toBe(false);
  });

  it('isolates malformed trigger blocks while keeping valid subscriptions', () => {
    const agent = block({
      bodyMd: '# @agent demo\nRun demo events.',
      path: '/agent/',
    });
    const malformed = block({
      parentId: agent.id,
      path: '/agent/bad/',
      bodyMd: '```agent-trigger\n{"event":"not-real"}\n```',
    });
    const valid = block({
      parentId: agent.id,
      path: '/agent/good/',
      bodyMd: '```agent-trigger\n{"event":"block_created","mention":"Demo Agent","workflow":"reply"}\n```',
    });
    expect(collectAgentTriggers([agent, malformed, valid])).toEqual([
      {
        agentBlockId: agent.id,
        triggerBlockId: valid.id,
        trigger: {
          event: 'block_created',
          mention: 'Demo Agent',
          workflow: 'reply',
        },
      },
    ]);
  });
});
