import { describe, expect, it } from 'vitest';

import {
  LocalRipgrepBulkQuerySchema,
  LocalRipgrepQuerySchema,
} from '../../../src/tools/local_ripgrep/scheme.js';

describe('localSearchCode schema', () => {
  const baseQuery = { keywords: 'token', path: '/repo' };

  it('rejects contradictory case flags', () => {
    const result = LocalRipgrepQuerySchema.safeParse({
      ...baseQuery,
      caseSensitive: true,
      caseInsensitive: true,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.map(issue => issue.message).join('\n')
      ).toMatch(/caseSensitive and caseInsensitive are mutually exclusive/);
    }
  });

  it('rejects multilineDotall without multiline', () => {
    const result = LocalRipgrepQuerySchema.safeParse({
      ...baseQuery,
      multilineDotall: true,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.map(issue => issue.message).join('\n')
      ).toMatch(/multilineDotall requires multiline=true/);
    }
  });

  it('accepts multilineDotall when multiline is enabled', () => {
    const result = LocalRipgrepQuerySchema.safeParse({
      ...baseQuery,
      multiline: true,
      multilineDotall: true,
    });

    expect(result.success).toBe(true);
  });

  it('accepts unique matched values when onlyMatching is enabled', () => {
    const result = LocalRipgrepQuerySchema.safeParse({
      ...baseQuery,
      onlyMatching: true,
      unique: true,
      countUnique: true,
    });

    expect(result.success).toBe(true);
  });

  it('rejects removed semanticRanking input instead of accepting a no-op flag', () => {
    const result = LocalRipgrepQuerySchema.safeParse({
      ...baseQuery,
      semanticRanking: true,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map(issue => issue.message).join('\n')).toMatch(
        /Unrecognized key.*semanticRanking|unrecognized.*semanticRanking/i
      );
    }
  });

  it('rejects unique matched values without onlyMatching', () => {
    const result = LocalRipgrepQuerySchema.safeParse({
      ...baseQuery,
      unique: true,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.map(issue => issue.message).join('\n')
      ).toMatch(/unique requires onlyMatching:true/);
    }
  });

  it('rejects countUnique without onlyMatching', () => {
    const result = LocalRipgrepQuerySchema.safeParse({
      ...baseQuery,
      countUnique: true,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.map(issue => issue.message).join('\n')
      ).toMatch(/countUnique requires onlyMatching:true/);
    }
  });

  it('rejects unique/countUnique in structural mode', () => {
    const result = LocalRipgrepQuerySchema.safeParse({
      path: '/repo',
      mode: 'structural',
      pattern: 'eval($X)',
      unique: true,
      countUnique: true,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.map(issue => issue.message).join('\n')
      ).toMatch(/unique.*not valid with mode:"structural"/);
    }
  });

  it('keeps bulk parsing relaxed so execution can report per-query errors', () => {
    const result = LocalRipgrepBulkQuerySchema.safeParse({
      queries: [
        { ...baseQuery, caseSensitive: true, caseInsensitive: true },
        { ...baseQuery, keywords: 'valid' },
      ],
    });

    expect(result.success).toBe(true);
  });
});
