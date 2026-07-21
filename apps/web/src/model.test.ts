import { describe, expect, it } from 'vitest';
import { blockSummary, blockTitle } from './model';

describe('Markdown block projections', () => {
  it('derives the display title from a Markdown heading', () => {
    const block = { title: 'stale title', bodyMd: '# Current title\n\nDetails' };

    expect(blockTitle(block)).toBe('Current title');
  });

  it('keeps the transitional title for a description-only mock block', () => {
    const block = { title: 'Existing label', bodyMd: 'Description only.' };

    expect(blockTitle(block)).toBe('Existing label');
    expect(blockSummary(block)).toBe('Description only.');
  });

  it('removes a projected heading from summary content', () => {
    const block = { bodyMd: '## Current title\n\nDetails' };

    expect(blockSummary(block)).toBe('Details');
  });
});
