import { describe, expect, it } from 'vitest';
import { blockOpSchema, deriveBlockKind } from './index.js';

describe('shared block contract', () => {
  it('derives presentation from markdown instead of storing a kind', () => {
    expect(deriveBlockKind('## Plan')).toBe('heading');
    expect(deriveBlockKind('- ship it')).toBe('list');
  });

  it('rejects unknown operations', () => {
    expect(blockOpSchema.safeParse({ type: 'archive', id: crypto.randomUUID() }).success).toBe(false);
  });
});
