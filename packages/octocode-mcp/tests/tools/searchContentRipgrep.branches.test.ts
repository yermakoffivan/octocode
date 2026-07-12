import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RipgrepQuery } from '../../../octocode-tools-core/src/tools/local_ripgrep/scheme.js';
import { LOCAL_TOOL_ERROR_CODES } from '../../../octocode-tools-core/src/errors/localToolErrors.js';

// Ripgrep is now in-process inside the native engine. There is no
// binary-availability check and no grep fallback, so searchContentRipgrep just
// delegates to executeRipgrepSearchInternal (and the structural branch) and
// shapes thrown errors.
const mocks = vi.hoisted(() => ({
  executeRipgrepSearchInternal: vi.fn(),
}));

vi.mock(
  '../../../octocode-tools-core/src/tools/local_ripgrep/ripgrepExecutor.js',
  () => ({
    executeRipgrepSearchInternal: mocks.executeRipgrepSearchInternal,
  })
);

const { searchContentRipgrep } =
  await import('../../../octocode-tools-core/src/tools/local_ripgrep/searchContentRipgrep.js');

function makeRipgrepQuery(overrides: Partial<RipgrepQuery> = {}): RipgrepQuery {
  return {
    id: 'q-test',
    researchGoal: 'unit-test',
    reasoning: 'cover branches',
    keywords: 'foo',
    path: '/tmp',
    matchContentLength: 200,
    itemsPerPage: 10,
    page: 1,
    maxMatchesPerFile: 10,
    sort: 'path',
    ...overrides,
  } as RipgrepQuery;
}

describe('searchContentRipgrep — delegation & error handling', () => {
  beforeEach(() => {
    mocks.executeRipgrepSearchInternal.mockReset();
  });

  it('delegates to the in-process ripgrep executor', async () => {
    mocks.executeRipgrepSearchInternal.mockResolvedValueOnce({
      searchEngine: 'rg',
      files: [
        {
          path: '/tmp/a.ts',
          matchCount: 1,
          matches: [{ line: 2, column: 0, value: 'const foo = true;' }],
        },
      ],
    });

    const result = await searchContentRipgrep(makeRipgrepQuery());

    expect(result.searchEngine).toBe('rg');
    expect(mocks.executeRipgrepSearchInternal).toHaveBeenCalledOnce();
    expect(result.files?.[0]?.matches![0]).toMatchObject({
      line: 2,
      value: 'const foo = true;',
    });
  });

  it('maps "Output size limit exceeded" exceptions to an OUTPUT_TOO_LARGE result with workflow hints', async () => {
    mocks.executeRipgrepSearchInternal.mockRejectedValueOnce(
      new Error('Output size limit exceeded (10485760 bytes)')
    );

    const result = await searchContentRipgrep(makeRipgrepQuery());

    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.errorCode).toBe(LOCAL_TOOL_ERROR_CODES.OUTPUT_TOO_LARGE);
      expect(result.error).toMatch(/Output size limit exceeded/);
      expect(result.hints?.join('\n')).toMatch(/filesOnly|Strategy/);
    }
  });

  it('falls through to the generic error path for unrelated exceptions', async () => {
    mocks.executeRipgrepSearchInternal.mockRejectedValueOnce(
      new Error('something else entirely went wrong')
    );

    const result = await searchContentRipgrep(makeRipgrepQuery());

    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.errorCode).not.toBe(
        LOCAL_TOOL_ERROR_CODES.OUTPUT_TOO_LARGE
      );
      expect(result.error).toMatch(/something else entirely went wrong/);
    }
  });
});
