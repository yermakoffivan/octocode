import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/utils/colors.js', () => ({
  c: (_color: string, s: string) => s,
  bold: (s: string) => s,
  dim: (s: string) => s,
}));

import { renderLocalResults } from '../../../src/cli/commands/local-search-render.js';

describe('local search renderer', () => {
  it('renders only-matching histograms as value rows', () => {
    const output = renderLocalResults(
      {
        results: [
          {
            data: {
              files: [
                {
                  path: 'src/example.ts',
                  matchCount: 2,
                  matches: [
                    { line: 1, value: 'TOKEN', count: 3 },
                    { line: 2, value: 'OTHER', count: 1 },
                  ],
                },
              ],
            },
          },
        ],
      },
      10,
      0,
      { valuesOnly: true }
    );

    expect(output).toContain('3x  TOKEN');
    expect(output).toContain('1x  OTHER');
    expect(output).not.toContain('src/example.ts');
    expect(output).not.toContain('L1:');
  });
});
