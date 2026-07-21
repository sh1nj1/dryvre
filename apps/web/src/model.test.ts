import { describe, expect, it } from 'vitest';
import { blockSummary, blockTitle, headingMarkdown } from './model';

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

  it('unescapes CommonMark backslash escapes so the title matches the rendered heading', () => {
    // An escaped `\#` is heading text (a literal `#`), not a closing sequence, so
    // it is retained; the backslash must be dropped to match how ReactMarkdown
    // renders it. The same applies to any escaped ASCII punctuation.
    expect(blockTitle({ title: 'x', bodyMd: '# Issue \\#' })).toBe('Issue #');
    expect(blockTitle({ title: 'x', bodyMd: '# foo \\*bar\\*' })).toBe('foo *bar*');
    expect(blockTitle({ title: 'x', bodyMd: '# see \\[spec\\]' })).toBe('see [spec]');
    // A backslash before a non-punctuation char stays literal.
    expect(blockTitle({ title: 'x', bodyMd: '# path C:\\dir' })).toBe('path C:\\dir');
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

  it('returns the original heading line, preserving its level and inline Markdown', () => {
    // The author's ATX level must survive so read mode does not silently rewrite
    // `# Root` to `## Root`; inline Markdown in the heading is kept verbatim.
    expect(headingMarkdown({ title: 'x', bodyMd: '# Root' })).toBe('# Root');
    expect(headingMarkdown({ title: 'x', bodyMd: '### Details\n\nBody' })).toBe('### Details');
    expect(headingMarkdown({ title: 'x', bodyMd: '# Ship `dryvre` for the [demo](https://x.com)' })).toBe('# Ship `dryvre` for the [demo](https://x.com)');
  });

  it('synthesizes a level-2 heading only when there is no ATX heading', () => {
    expect(headingMarkdown({ title: 'Stored', bodyMd: '' })).toBe('## Stored');
    expect(headingMarkdown({ title: 'Fallback', bodyMd: 'Just text\nmore' })).toBe('## Fallback');
    // An empty heading is not a heading, so it falls back rather than emitting `# `.
    expect(headingMarkdown({ title: 'Stored', bodyMd: '#\nDetails' })).toBe('## Stored');
  });

  it('carries reference-style link definitions into the isolated heading', () => {
    // A reference link in the heading points at a definition elsewhere in the
    // body; the isolated projection would lose it, so the definition rides along
    // (it renders to nothing, so it never adds visible output).
    expect(headingMarkdown({ title: 'x', bodyMd: '# [Spec][spec]\n\n[spec]: https://example.com' })).toBe(
      '# [Spec][spec]\n\n[spec]: https://example.com',
    );
    // No reference definitions: the heading is returned unchanged.
    expect(headingMarkdown({ title: 'x', bodyMd: '# Plain\n\nbody text' })).toBe('# Plain');
    // A 4-space indent makes it code, not a definition, so it is not carried.
    expect(headingMarkdown({ title: 'x', bodyMd: '# Title\n\n    [not]: a-def' })).toBe('# Title');
    // CommonMark allows no whitespace after the colon (`[s]:dest`), so a no-space
    // definition must still be carried, or the heading link renders as raw text.
    expect(headingMarkdown({ title: 'x', bodyMd: '# [Spec][s]\n\n[s]:https://example.com' })).toBe(
      '# [Spec][s]\n\n[s]:https://example.com',
    );
    // A bare `[s]:` with no destination is not a definition and is not carried.
    expect(headingMarkdown({ title: 'x', bodyMd: '# [Spec][s]\n\n[s]:' })).toBe('# [Spec][s]');
  });

  it('does not lift reference definitions out of fenced code blocks', () => {
    // A `[s]: url` line inside a fenced code block is a code sample, not a real
    // definition — carrying it would resolve a heading link the author only wrote
    // as code, diverging from how ReactMarkdown renders the body.
    expect(
      headingMarkdown({ title: 'x', bodyMd: '# [Spec][s]\n\n```\n[s]: https://evil.example.com\n```' }),
    ).toBe('# [Spec][s]');
    // A real definition after the fence is still carried; the fenced one is not.
    expect(
      headingMarkdown({
        title: 'x',
        bodyMd: '# [x][s]\n\n```\n[s]: https://code.example\n```\n\n[s]: https://real.example',
      }),
    ).toBe('# [x][s]\n\n[s]: https://real.example');
  });
});
