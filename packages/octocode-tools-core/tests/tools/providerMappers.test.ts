import { describe, expect, it } from 'vitest';

import { DEFAULT_MATCH_SNIPPET_CHARS } from '../../../src/config.js';
import { truncateSnippetChars } from '../../../src/tools/providerMappers.js';

describe('truncateSnippetChars (GitHub code-search fragment bound)', () => {
  it('mirrors the Rust engine: char-boundary cut + "..." suffix', () => {
    const value = 'a'.repeat(600);
    const out = truncateSnippetChars(value, 10);
    expect(out.endsWith('...')).toBe(true);
    // Total char count never exceeds the limit (7 head chars + "..." = 10).
    expect([...out].length).toBeLessThanOrEqual(10);
  });

  it('leaves short fragments untouched', () => {
    const value = 'export function resolveRef() {}';
    expect(truncateSnippetChars(value, 500)).toBe(value);
  });

  it('counts Unicode scalars, not UTF-16 code units or bytes', () => {
    // 4 scalars (emoji is one scalar), limit 4 → fits exactly, no truncation.
    const value = 'a😀b';
    expect(truncateSnippetChars(value, 4)).toBe(value);
  });

  it('truncates multibyte content without splitting a codepoint', () => {
    // 6 scalars, limit 5 → 2 head chars + "..." (3) = 5.
    const out = truncateSnippetChars('a😀b😀c', 5);
    expect([...out].length).toBeLessThanOrEqual(5);
    expect(out.endsWith('...')).toBe(true);
    // The emoji is never split mid-codepoint.
    expect(out.includes('\ud83d')).toBe(false);
  });

  it('defaults to DEFAULT_MATCH_SNIPPET_CHARS (mirrors engine default 500)', () => {
    const value = 'x'.repeat(600);
    const out = truncateSnippetChars(value);
    expect([...out].length).toBeLessThanOrEqual(DEFAULT_MATCH_SNIPPET_CHARS);
    expect(out.endsWith('...')).toBe(true);
  });

  it('returns empty string for maxChars <= 0', () => {
    expect(truncateSnippetChars('hello', 0)).toBe('');
  });
});
