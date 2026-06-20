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
import { EXIT } from '../../../src/cli/exit-codes.js';
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

  it('rejects extra positionals in structural mode (arg[0] is the path, there are no keywords)', async () => {
    // Foot-gun guard: `grep <keywords> <path> --pattern` silently used the
    // keywords as the path. Structural takes a single PATH positional only.
    await run(['someKeyword', 'src'], { pattern: 'x($Y)' });
    expect(executeDirectTool).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(EXIT.USAGE);
  });

  it('accepts a single path positional in structural mode', async () => {
    await run(['src'], { pattern: 'x($Y)' });
    expect(executeDirectTool).toHaveBeenCalledTimes(1);
    const q = lastQuery();
    expect(q.mode).toBe('structural');
    expect(q.pattern).toBe('x($Y)');
  });

  it('passes --mode through to localSearchCode', async () => {
    await run(['needle', 'src'], { mode: 'discovery' });
    const q = lastQuery();
    expect(q.mode).toBe('discovery');
  });

  it('maps local --type to include globs instead of ripgrep type filters', async () => {
    await run(['needle', 'src'], { type: 'tsx' });

    const q = lastQuery();
    expect(q.langType).toBeUndefined();
    expect(q.include).toEqual(['*.tsx']);
  });

  it('merges local --type with explicit include globs', async () => {
    await run(['needle', 'src'], { type: 'tsx', include: '*.ts,*.md' });

    expect(lastQuery().include).toEqual(['*.ts', '*.md', '*.tsx']);
  });

  it('maps local language names to real extension globs', async () => {
    await run(['needle', 'src'], { type: 'rust' });

    expect(lastQuery().include).toEqual(['*.rs']);
  });

  it('expands broad local language names without losing explicit includes', async () => {
    await run(['needle', 'src'], { type: 'typescript', include: '*.md' });

    expect(lastQuery().include).toEqual([
      '*.md',
      '*.ts',
      '*.tsx',
      '*.mts',
      '*.cts',
    ]);
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
    expect(q.extension).toBeUndefined();
    expect(q.keywordsToSearch).toBeUndefined();
  });

  it('passes GitHub --type as the GitHub extension filter', async () => {
    await run(['useState', 'facebook/react'], { type: 'tsx' });

    expect(lastQuery().extension).toBe('tsx');
  });

  it('uses --limit as the GitHub code page size for JSON and rendered output', async () => {
    await run(['useState', 'facebook/react'], { limit: '2', json: true });

    expect(lastQuery().limit).toBe(2);
  });

  it('lets --page-size override --limit for the underlying GitHub code query', async () => {
    await run(['useState', 'facebook/react'], {
      limit: '2',
      'page-size': '5',
      json: true,
    });

    expect(lastQuery().limit).toBe(5);
  });

  it('requires keywords', async () => {
    await run([]);
    expect(executeDirectTool).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(EXIT.USAGE);
  });

  it('rejects an invalid --mode with a friendly error (no raw Zod leak)', async () => {
    await run(['needle', 'src'], { mode: 'bogus' });
    expect(executeDirectTool).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(EXIT.USAGE);
  });

  it('maps a GitHub auth failure to EXIT.AUTH', async () => {
    executeDirectTool.mockResolvedValue({
      isError: true,
      content: [{ type: 'text', text: 'HTTP 401 Bad credentials' }],
      structuredContent: {},
    });
    await run(['useState', 'facebook/react']);
    expect(process.exitCode).toBe(EXIT.AUTH);
  });

  it('maps a generic search failure to EXIT.TOOL', async () => {
    executeDirectTool.mockResolvedValue({
      isError: true,
      content: [{ type: 'text', text: 'ripgrep crashed' }],
      structuredContent: {},
    });
    await run(['needle', 'src']);
    expect(process.exitCode).toBe(EXIT.TOOL);
  });

  it('accepts valid --mode values', async () => {
    await run(['needle', 'src'], { mode: 'discovery' });
    expect(executeDirectTool).toHaveBeenCalledTimes(1);
    expect(lastQuery().mode).toBe('discovery');
  });

  // Regression: an explicit `filesOnly: false` OVERRIDES discovery mode in
  // localSearchCode, so it returns full snippets instead of paths-only. The CLI
  // must never send a spurious `false` for toggles it didn't receive — absent
  // flags must be `undefined` (same idiom as find.ts).
  it('does not send filesOnly:false in --mode discovery (would defeat paths-only)', async () => {
    await run(['needle', 'src'], { mode: 'discovery' });
    const q = lastQuery();
    expect(q.mode).toBe('discovery');
    expect(q.filesOnly).toBeUndefined();
  });

  it('--concise maps to discovery and does not force filesOnly:false', async () => {
    await run(['needle', 'src'], { concise: true });
    const q = lastQuery();
    expect(q.mode).toBe('discovery');
    expect(q.filesOnly).toBeUndefined();
  });

  it('omits unset boolean toggles entirely (no spurious false sent to the tool)', async () => {
    await run(['needle', 'src']);
    const q = lastQuery();
    for (const k of [
      'filesOnly',
      'filesWithoutMatch',
      'countLinesPerFile',
      'countMatchesPerFile',
      'perlRegex',
      'caseInsensitive',
      'caseSensitive',
      'wholeWord',
      'invertMatch',
      'hidden',
      'noIgnore',
      'multiline',
      'multilineDotall',
      'fixedString',
    ]) {
      expect(
        q[k],
        `${k} should be undefined when its flag is absent`
      ).toBeUndefined();
    }
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

  it('uses --limit as the local maxFiles and page size when --max-files/--page-size are absent', async () => {
    await run(['needle', 'src'], { limit: '2', json: true });

    expect(lastQuery()).toMatchObject({
      maxFiles: 2,
      itemsPerPage: 2,
    });
  });

  it('lets explicit local --max-files and --page-size override --limit', async () => {
    await run(['needle', 'src'], {
      limit: '2',
      'max-files': '4',
      'page-size': '5',
      json: true,
    });

    expect(lastQuery()).toMatchObject({
      maxFiles: 4,
      itemsPerPage: 5,
    });
  });

  it('accepts AST flags (structural search folded into grep)', () => {
    expect(grepCommand.options?.some(o => o.name === 'pattern')).toBe(true);
    expect(grepCommand.options?.some(o => o.name === 'rule')).toBe(true);
  });

  it('maps structural local --type to include globs', async () => {
    await run(['src'], { pattern: 'useEffect($$$ARGS)', type: 'tsx' });

    const q = lastQuery();
    expect(q.langType).toBeUndefined();
    expect(q.include).toEqual(['*.tsx']);
  });

  it('maps structural language names to real extension globs', async () => {
    await run(['src'], { pattern: 'Regex::new($PAT)', type: 'rust' });

    expect(lastQuery().include).toEqual(['*.rs']);
  });

  it('--pattern routes to localSearchCode mode:"structural" (arg[0] is the path)', async () => {
    await run(['src'], { pattern: 'eval($X)' });
    expect(executeDirectTool).toHaveBeenCalledTimes(1);
    const [tool] = executeDirectTool.mock.calls[0];
    expect(tool).toBe('localSearchCode');
    const q = lastQuery();
    expect(q.mode).toBe('structural');
    expect(q.pattern).toBe('eval($X)');
    expect(q.rule).toBeUndefined();
    expect(q.keywords).toBeUndefined();
    expect(String(q.path)).toContain('src');
  });

  it('--rule routes to structural search with the rule blob', async () => {
    await run(['.'], { rule: 'rule:\n  pattern: foo($X)' });
    const q = lastQuery();
    expect(q.mode).toBe('structural');
    expect(q.rule).toBe('rule:\n  pattern: foo($X)');
    expect(q.pattern).toBeUndefined();
  });

  it('rejects --pattern and --rule together', async () => {
    await run(['.'], { pattern: 'foo($X)', rule: 'rule: bar' });
    expect(executeDirectTool).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(EXIT.USAGE);
  });

  it('rejects structural search against a GitHub ref (local-only)', async () => {
    await run(['facebook/react'], { pattern: 'useState($X)' });
    expect(executeDirectTool).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(EXIT.USAGE);
  });
});
