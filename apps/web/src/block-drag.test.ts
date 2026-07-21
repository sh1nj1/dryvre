import { describe, expect, it } from 'vitest';
import { dropPositionFromPointer, planBlockMove } from './block-drag';
import type { DryvreBlock } from './model';

const block = (id: string, parentId: string | null): DryvreBlock => ({ id, parentId, title: id, author: 'Test', updatedLabel: '', canonical: true });
const blocks = [block('root', null), block('a', 'root'), block('a-child', 'a'), block('b', 'root'), block('b-child', 'b')];

describe('block drag planning', () => {
  it('maps the upper, middle and lower thirds to structural drops', () => {
    expect(dropPositionFromPointer(100, 90, 110)).toBe('before');
    expect(dropPositionFromPointer(100, 90, 145)).toBe('inside');
    expect(dropPositionFromPointer(100, 90, 180)).toBe('after');
  });

  it('plans sibling and nested moves in document order', () => {
    expect(planBlockMove('b', 'a', 'before', blocks, 'root')).toEqual({ parentId: 'root', afterId: null });
    expect(planBlockMove('a', 'b', 'after', blocks, 'root')).toEqual({ parentId: 'root', afterId: 'b' });
    expect(planBlockMove('b', 'a', 'inside', blocks, 'root')).toEqual({ parentId: 'a', afterId: 'a-child' });
  });

  it('rejects moving the root or moving a block into its own subtree', () => {
    expect(planBlockMove('root', 'a', 'inside', blocks, 'root')).toBeNull();
    expect(planBlockMove('a', 'a-child', 'inside', blocks, 'root')).toBeNull();
  });
});
