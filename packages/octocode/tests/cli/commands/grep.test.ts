import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const executeDirectTool = vi.fn();

vi.mock('@octocodeai/octocode-tools-core/direct', () => ({
  executeDirectTool: (...args: unknown[]) => executeDirectTool(...args),
}));

// Keep color helpers as identity passthroughs so assertions match plain text.
vi.mock('../../../src/utils/colors.js', () => ({
  c: (_color: string, s: string) => s,
  bold: (s: string) => s,
  dim: (s: string) => s,
}));

import { grepCommand } from '../../../src/cli/commands/grep.js';
import type { ParsedArgs } from '../../../src/cli/types.js';

function run(args: string[], options: Record<string, string | boolean> = {}) {
  const parsed: ParsedArgs = { command: 'grep', args, options };
  return grepCommand.handler(parsed);
}

function okEnvelope() {
  return {
    isError: false,
    content: [],
    structuredContent: {
      results: [{ id: 'q1', data: { files: [], pagination: {} } }],
    },
  };
}

/** Grab the queries payload from the most recent executeDirectTool call. */
function lastQuery() {
  const call = executeDirectTool.mock.calls.at(-1);
  return (call?.[1] as { queries: Array<Record<string, unknown>> }).queries[0];
}

describe('grep command', () => {
  beforeEach(() => {
    executeDirectTool.mockReset();
    executeDirectTool.mockResolvedValue(okEnvelope());
    process.exitCode = undefined;
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it('routes plain keywords to localSearchCode (text, no structural mode)', async () => {
    await run(['searchLocal', '.']);
    expect(executeDirectTool).toHaveBeenCalledTimes(1);
    const [tool] = executeDirectTool.mock.calls[0];
    expect(tool).toBe('localSearchCode');
    const q = lastQuery();
    expect(q.keywords).toBe('searchLocal');
    expect(q.mode).toBeUndefined();
    expect(q.pattern).toBeUndefined();
    expect(q.rule).toBeUndefined();
  });

  it('passes --mode through to localSearchCode', async () => {
    await run(['needle', 'src'], { mode: 'discovery' });
    const q = lastQuery();
    expect(q.mode).toBe('discovery');
  });

  it('routes a GitHub ref to ghSearchCode', async () => {
    executeDirectTool.mockResolvedValue({
      isError: false,
      content: [],
      structuredContent: { results: [{ data: { files: [], pagination: {} } }] },
    });
    await run(['useState', 'facebook/react']);
    const [tool] = executeDirectTool.mock.calls[0];
    expect(tool).toBe('ghSearchCode');
    // ghSearchCode's field is `keywords` (not the removed `keywordsToSearch`,
    // which is silently stripped → keyword-less search → wrong results).
    const q = lastQuery();
    expect(q.keywords).toEqual(['useState']);
    expect(q.keywordsToSearch).toBeUndefined();
  });

  it('requires keywords', async () => {
    await run([]);
    expect(executeDirectTool).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it('rejects an invalid --mode with a friendly error (no raw Zod leak)', async () => {
    await run(['needle', 'src'], { mode: 'bogus' });
    expect(executeDirectTool).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it('accepts valid --mode values', async () => {
    await run(['needle', 'src'], { mode: 'discovery' });
    expect(executeDirectTool).toHaveBeenCalledTimes(1);
    expect(lastQuery().mode).toBe('discovery');
  });

  it('passes familiar grep aliases through to localSearchCode', async () => {
    await run(['needle', 'src'], { context: '2', fixed: true });
    const q = lastQuery();
    expect(q.contextLines).toBe(2);
    expect(q.fixedString).toBe(true);
  });

  it('supports the explicit fixed-string flag', async () => {
    await run(['needle', 'src'], { 'fixed-string': true });
    expect(lastQuery().fixedString).toBe(true);
  });

  it('passes advanced localSearchCode flags through', async () => {
    await run(['needle', 'src'], {
      'perl-regex': true,
      'case-insensitive': true,
      'whole-word': true,
      'files-only': true,
      'count-matches': true,
      multiline: true,
      'multiline-dotall': true,
      'match-length': '200',
      'max-files': '5',
      'match-page': '2',
    });

    expect(lastQuery()).toMatchObject({
      perlRegex: true,
      caseInsensitive: true,
      wholeWord: true,
      filesOnly: true,
      countMatchesPerFile: true,
      multiline: true,
      multilineDotall: true,
      matchContentLength: 200,
      maxFiles: 5,
      matchPage: 2,
    });
  });

  it('does not accept AST flags (moved to the ast command)', async () => {
    expect(grepCommand.options?.some(o => o.name === 'pattern')).toBe(false);
    expect(grepCommand.options?.some(o => o.name === 'rule')).toBe(false);
  });
});
