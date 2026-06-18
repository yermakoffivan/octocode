import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  stat: vi.fn(),
  readFile: vi.fn(),
  validateToolPath: vi.fn(),
  queryFileSystem: vi.fn(),
  structuralSearch: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  stat: mocks.stat,
  readFile: mocks.readFile,
}));

vi.mock('../../../src/utils/file/toolHelpers.js', async importOriginal => {
  const actual = await importOriginal<
    typeof import('../../../src/utils/file/toolHelpers.js')
  >();
  return {
    ...actual,
    validateToolPath: mocks.validateToolPath,
  };
});

vi.mock('../../../src/utils/contextUtils.js', () => ({
  contextUtils: {
    queryFileSystem: mocks.queryFileSystem,
    structuralSearch: mocks.structuralSearch,
  },
}));

const { searchContentStructural } = await import(
  '../../../src/tools/local_ripgrep/structuralSearch.js'
);

function makeQuery(overrides: Record<string, unknown> = {}) {
  return {
    id: 'structural-test',
    researchGoal: 'unit-test',
    reasoning: 'validate structural search behavior',
    path: '/repo',
    mode: 'structural' as const,
    pattern: 'target($X)',
    maxFiles: 10,
    ...overrides,
  };
}

function entries(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    path: `/repo/file-${index}.ts`,
  }));
}

describe('searchContentStructural', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateToolPath.mockReturnValue({
      isValid: true,
      sanitizedPath: '/repo',
    });
    mocks.stat.mockImplementation(async (path: string) => {
      if (path === '/repo') return { isFile: () => false };
      return { size: 100 };
    });
    mocks.queryFileSystem.mockReturnValue({ entries: entries(0) });
    mocks.readFile.mockResolvedValue('target(value)');
    mocks.structuralSearch.mockReturnValue([
      { startLine: 1, startCol: 1, text: 'target(value)' },
    ]);
  });

  it('warns when candidate files cannot be read instead of silently reducing completeness', async () => {
    mocks.queryFileSystem.mockReturnValue({ entries: entries(3) });
    mocks.readFile.mockImplementation(async (path: string) => {
      if (path === '/repo/file-1.ts') throw new Error('EACCES');
      return 'target(value)';
    });

    const result = await searchContentStructural(makeQuery());

    expect(result.searchEngine).toBe('structural');
    expect(result.files).toHaveLength(2);
    expect(result.warnings?.join('\n')).toContain(
      'Skipped 1 unreadable or vanished candidate file(s).'
    );
  });

  it('limits concurrent file reads while processing structural candidates', async () => {
    mocks.queryFileSystem.mockReturnValue({ entries: entries(12) });
    let activeReads = 0;
    let maxActiveReads = 0;
    mocks.readFile.mockImplementation(async () => {
      activeReads++;
      maxActiveReads = Math.max(maxActiveReads, activeReads);
      await new Promise(resolve => setTimeout(resolve, 5));
      activeReads--;
      return 'target(value)';
    });

    const result = await searchContentStructural(makeQuery({ maxFiles: 12 }));

    expect(result.searchEngine).toBe('structural');
    expect(result.files).toHaveLength(12);
    expect(maxActiveReads).toBeGreaterThan(1);
    expect(maxActiveReads).toBeLessThanOrEqual(4);
  });
});
