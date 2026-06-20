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

  it('numbers each context line accurately so the gutter is not offset to the match line', () => {
    // Regression: the match line gutter (L3:) was printed on the row that
    // actually showed the *before-context* line, with the real match dumped on
    // the next unlabeled row — looked line-offset though `line` was accurate.
    const sc = {
      results: [
        {
          data: {
            files: [
              {
                path: 'ctx.txt',
                matchCount: 1,
                matches: [
                  {
                    line: 3,
                    value:
                      'LINE TWO before\nthe NEEDLE is here\nLINE four after',
                  },
                ],
              },
            ],
          },
        },
      ],
    };
    const rows = renderLocalResults(sc, 10, 1).split('\n');
    const matchRow = rows.find(r => r.includes('the NEEDLE is here')) ?? '';
    const beforeRow = rows.find(r => r.includes('LINE TWO before')) ?? '';
    const afterRow = rows.find(r => r.includes('LINE four after')) ?? '';
    expect(matchRow).toContain('L3');
    // before-context is line 2 — must NOT be mislabeled with the match's L3.
    expect(beforeRow).toContain('L2');
    expect(beforeRow).not.toContain('L3');
    expect(afterRow).toContain('L4');
    // each source line on its own row — match not concatenated with context.
    expect(matchRow).not.toContain('LINE TWO before');
  });

  it('clamps the start line when the match is near the top of the file', () => {
    const sc = {
      results: [
        {
          data: {
            files: [
              {
                path: 'top.txt',
                matchCount: 1,
                matches: [{ line: 1, value: 'first MATCH line\nsecond line' }],
              },
            ],
          },
        },
      ],
    };
    const rows = renderLocalResults(sc, 10, 2).split('\n');
    const matchRow = rows.find(r => r.includes('first MATCH line')) ?? '';
    const afterRow = rows.find(r => r.includes('second line')) ?? '';
    expect(matchRow).toContain('L1');
    expect(afterRow).toContain('L2');
  });

  it('keeps single-line snippets on one labeled row when no context is requested', () => {
    const sc = {
      results: [
        {
          data: {
            files: [
              {
                path: 'a.ts',
                matchCount: 1,
                matches: [{ line: 5, value: 'const x = 1;' }],
              },
            ],
          },
        },
      ],
    };
    const out = renderLocalResults(sc, 10);
    expect(out).toContain('L5:');
    expect(out).toContain('const x = 1;');
  });

  it('renders structural metavariable captures when present', () => {
    const sc = {
      results: [
        {
          data: {
            files: [
              {
                path: 'a.tsx',
                matches: [
                  {
                    line: 7,
                    value: 'useEffect(() => {',
                    metavars: { ARGS: ['() => { body(); }', '[dep]'] },
                  },
                ],
              },
            ],
          },
        },
      ],
    };

    expect(renderLocalResults(sc, 10)).toContain(
      '$ARGS=() => { body(); }, [dep]'
    );
  });
});
