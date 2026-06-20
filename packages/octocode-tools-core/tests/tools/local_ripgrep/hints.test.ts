import { describe, expect, it } from 'vitest';
import { hints } from '../../../src/tools/local_ripgrep/hints.js';
import type { HintContext } from '../../../src/types/metadata.js';

describe('local_ripgrep hints.empty', () => {
  it('emits generic retry guidance for empty text searches', () => {
    const result = hints.empty({
      keywords: 'foobar',
      searchEngine: 'rg',
    } as HintContext);
    expect(result.join('\n')).toContain('fixedString=true');
  });

  it('does not emit stale grep fallback guidance', () => {
    const result = hints.empty({ keywords: 'foobar', searchEngine: 'rg' } as HintContext);
    expect(result.some(h => h.includes('grep fallback'))).toBe(false);
  });

  it('returns empty when no context provided', () => {
    const result = hints.empty({} as HintContext);
    expect(result).toEqual([]);
  });
});
