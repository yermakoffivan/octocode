import { describe, it, expect, vi, beforeEach } from 'vitest';

import { extractMatchingLines } from '../../../octocode-tools-core/src/tools/local_fetch_content/contentExtractor.js';

describe('contentExtractor - empty matches branch', () => {
  it('should return empty result when no matches found (line 61)', () => {
    const lines = ['line1', 'line2', 'line3'];
    const result = extractMatchingLines(
      lines,
      'nonexistent_string_xyz',
      5,
      false,
      false
    );
    expect(result.matchCount).toBe(0);
    expect(result.lines).toEqual([]);
    expect(result.matchRanges).toEqual([]);
  });
});

import { fetchDirectoryContentsRecursivelyAPI } from '../../../octocode-tools-core/src/github/repoStructureRecursive.js';

vi.mock('../../../octocode-tools-core/src/github/client.js', () => ({
  getOctokit: vi.fn(),
}));

import { getOctokit } from '../../../octocode-tools-core/src/github/client.js';

describe('repoStructureRecursive - error branches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return empty array when octokit getContent fails (line 22/73)', async () => {
    vi.mocked(getOctokit).mockResolvedValue({
      rest: {
        repos: {
          getContent: vi.fn().mockRejectedValue(new Error('API error')),
        },
      },
    } as any);

    const mockOctokit = await getOctokit();
    const result = await fetchDirectoryContentsRecursivelyAPI(
      mockOctokit!,
      'owner',
      'repo',
      'main',
      'src',
      1,
      1,
      new Set()
    );
    expect(result).toEqual([]);
  });
});
