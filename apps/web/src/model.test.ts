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

  it('does not treat an empty heading as a projected title, keeping the body intact', () => {
    // `#` with no text is an empty heading; horizontal-only whitespace after the
    // hashes stops `\s+` from consuming the newline and swallowing the summary.
    expect(blockTitle({ title: 'Existing label', bodyMd: '#\nDetails' })).toBe('Existing label');
    expect(blockSummary({ bodyMd: '#\nDetails' })).toBe('#\nDetails');
    expect(blockSummary({ bodyMd: '###\n\nDetails' })).toBe('###\n\nDetails');
  });

  it('does not derive a title from an indented code line', () => {
    // 4+ leading spaces make this a CommonMark code block, not a heading, so the
    // projection must not strip it or fall out of sync with the rendered body.
    const block = { title: 'Existing label', bodyMd: '    # Not a heading\nmore' };

    expect(blockTitle(block)).toBe('Existing label');
    expect(blockSummary(block)).toBe('    # Not a heading\nmore');
  });

  it('accepts up to three leading spaces before a heading', () => {
    expect(blockTitle({ title: 'x', bodyMd: '   # Three space heading' })).toBe('Three space heading');
  });

  it('preserves indentation of an indented code block after the heading', () => {
    expect(blockSummary({ bodyMd: '# Example\n\n    const x = 1' })).toBe('    const x = 1');
    expect(blockSummary({ bodyMd: '# T\n\n    a\n    b' })).toBe('    a\n    b');
  });
});
