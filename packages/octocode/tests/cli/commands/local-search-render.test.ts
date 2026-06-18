import { describe, it, expect } from 'vitest';
import { renderLocalResults } from '../../../src/cli/commands/local-search-render.js';

describe('renderLocalResults match counts', () => {
  it('uses the per-file matchCount when present', () => {
    const sc = {
      results: [
        {
          data: {
            files: [
              {
                path: 'a.ts',
                matchCount: 4,
                matches: [{ line: 1, value: 'x' }],
              },
            ],
          },
        },
      ],
    };
    expect(renderLocalResults(sc, 10)).toContain('(4 matches)');
  });

  it('falls back to data.shared.matchCount when the count is hoisted (identical across files)', () => {
    // Regression: structural/AST results hoist a common matchCount into
    // `data.shared`, leaving per-file matchCount absent → CLI printed "(0 matches)".
    const sc = {
      results: [
        {
          data: {
            shared: { matchCount: 1 },
            files: [
              { path: 'a.ts', matches: [{ line: 38, value: 'splitLines(x)' }] },
              { path: 'b.ts', matches: [{ line: 23, value: 'splitLines(y)' }] },
            ],
          },
        },
      ],
    };
    const out = renderLocalResults(sc, 10);
    expect(out).toContain('a.ts');
    expect(out).not.toContain('(0 matches)');
    expect(out).toContain('(1 matches)');
  });

  it('falls back to matches.length when no count is available anywhere', () => {
    const sc = {
      results: [
        {
          data: {
            files: [
              {
                path: 'a.ts',
                matches: [
                  { line: 1, value: 'x' },
                  { line: 2, value: 'y' },
                ],
              },
            ],
          },
        },
      ],
    };
    expect(renderLocalResults(sc, 10)).toContain('(2 matches)');
  });
});
