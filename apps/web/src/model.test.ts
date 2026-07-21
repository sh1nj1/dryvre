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

  it('removes a projected heading from summary content with CRLF line endings', () => {
    const block = { bodyMd: '# Title\r\n\r\nDetails' };

    expect(blockSummary(block)).toBe('Details');
  });

  it('keeps a trailing hash that is part of the heading text', () => {
    expect(blockTitle({ title: 'x', bodyMd: '# Learn C#' })).toBe('Learn C#');
    expect(blockTitle({ title: 'x', bodyMd: '# foo#bar' })).toBe('foo#bar');
  });

  it('strips a spaced closing hash sequence with trailing whitespace', () => {
    expect(blockTitle({ title: 'x', bodyMd: '# Plan ###   ' })).toBe('Plan');
    expect(blockTitle({ title: 'x', bodyMd: '# foo #' })).toBe('foo');
  });
});
