import { describe, it, expect, vi, beforeEach } from 'vitest';

// Ripgrep now runs in-process inside the native engine — the executor calls
// `contextUtils.searchRipgrep` instead of spawning an `rg` binary. We override
// only that method and keep the rest of contextUtils real (the pattern
// preflight uses `contextUtils.validateRipgrepPattern`).
const mocks = vi.hoisted(() => ({
  searchRipgrep: vi.fn(),
}));

vi.mock(
  '../../../octocode-tools-core/src/utils/contextUtils.js',
  async importOriginal => {
    const actual =
      await importOriginal<
        typeof import('../../../octocode-tools-core/src/utils/contextUtils.js')
      >();
    return {
      ...actual,
      contextUtils: {
        ...actual.contextUtils,
        searchRipgrep: mocks.searchRipgrep,
      },
    };
  }
);

vi.mock('@octocodeai/octocode-engine/pathValidator', () => ({
  pathValidator: {
    validate: vi.fn().mockReturnValue({
      isValid: true,
      sanitizedPath: '/test/path',
    }),
  },
}));

vi.mock('../../../octocode-tools-core/src/hints/index.js', () => ({
  getHints: vi.fn().mockReturnValue(['hint1']),
}));

vi.mock('../../../octocode-tools-core/src/hints/dynamic.js', () => ({
  getLargeFileWorkflowHints: vi.fn().mockReturnValue(['narrow your search']),
}));

import { executeRipgrepSearchInternal } from '../../../octocode-tools-core/src/tools/local_ripgrep/ripgrepExecutor.js';
import { RESOURCE_LIMITS } from '../../../octocode-tools-core/src/utils/core/constants.js';

const baseQuery = {
  id: 'exec_test',
  researchGoal: 'Test',
  reasoning: 'branch coverage',
  keywords: 'myPattern',
  path: '/test/path',
  fixedString: false,
  perlRegex: false,
};

const emptyResult = { files: [], stats: {} };

function makeResult(files: unknown[], stats: Record<string, unknown> = {}) {
  return { files, stats };
}

describe('executeRipgrepSearchInternal - branch coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.searchRipgrep.mockResolvedValue(emptyResult);
  });

  it('returns error when local schema validation fails', async () => {
    const result = await executeRipgrepSearchInternal({
      ...baseQuery,
      keywords: undefined,
    } as any);
    expect(result.status).toBe('error');
    expect(result.error).toContain('keywords');
  });

  it('returns error when path is not provided', async () => {
    const queryWithoutPath = { ...baseQuery, path: undefined };
    const result = await executeRipgrepSearchInternal(queryWithoutPath as any);
    expect(result.status).toBe('error');
    expect(result.error).toContain('Query validation failed');
  });

  it('returns error when pattern preflight validation fails', async () => {
    const queryWithBadPattern = {
      ...baseQuery,
      keywords: '[invalid-regex-missing-bracket',
    };
    const result = await executeRipgrepSearchInternal(
      queryWithBadPattern as any
    );
    expect(result.status).toBe('error');
    expect(result.error).toContain('Pattern validation failed');
  });

  it('returns error when the native search rejects', async () => {
    mocks.searchRipgrep.mockRejectedValue(new Error('engine failure'));
    const result = await executeRipgrepSearchInternal(baseQuery as any);
    expect(result.status).toBe('error');
    expect(result.error).toBeDefined();
  });

  it('returns empty when the native search yields no files', async () => {
    mocks.searchRipgrep.mockResolvedValue(
      makeResult([], {
        matchCount: 0,
        filesSearched: 7,
        bytesSearched: 2048,
        searchTime: '0.002000s',
      })
    );
    const result = await executeRipgrepSearchInternal(baseQuery as any);
    expect(result.status).toBe('empty');
    expect(result).toMatchObject({
      stats: {
        matchCount: 0,
        filesSearched: 7,
        bytesSearched: 2048,
        searchTime: '0.002000s',
      },
    });
  });

  it('returns empty without runtime validation warnings', async () => {
    mocks.searchRipgrep.mockResolvedValue(emptyResult);
    const result = await executeRipgrepSearchInternal(baseQuery as any);
    expect(result.status).toBe('empty');
    expect(result.warnings).toEqual([]);
  });

  it('returns results when the native search yields files', async () => {
    mocks.searchRipgrep.mockResolvedValue(
      makeResult(
        [
          {
            path: '/test/path/a.ts',
            matchCount: 1,
            matches: [{ line: 1, column: 0, value: 'myPattern here' }],
          },
        ],
        { matchCount: 1, filesMatched: 1, filesSearched: 3 }
      )
    );
    const result = await executeRipgrepSearchInternal(baseQuery as any);
    expect(result.status).toBeUndefined();
    expect(JSON.stringify(result)).toContain('a.ts');
  });

  it('adds chunking warnings when result payload is large', async () => {
    const bigValue = 'a'.repeat(
      (RESOURCE_LIMITS.LARGE_RESULT_BYTES_HINT ?? 500_000) + 1
    );
    mocks.searchRipgrep.mockResolvedValue(
      makeResult(
        [
          {
            path: '/test/path/big.ts',
            matchCount: 1,
            matches: [{ line: 1, column: 0, value: bigValue }],
          },
        ],
        { matchCount: 1 }
      )
    );

    const result = await executeRipgrepSearchInternal({
      ...baseQuery,
      filesOnly: false,
    } as any);

    expect([undefined, 'empty', 'error']).toContain(result.status);
    expect(JSON.stringify(result)).toMatch(/large|narrow|KB/i);
  });
});
