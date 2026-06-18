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
  });

  it('requires keywords', async () => {
    await run([]);
    expect(executeDirectTool).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it('does not accept AST flags (moved to the ast command)', async () => {
    expect(grepCommand.options?.some(o => o.name === 'pattern')).toBe(false);
    expect(grepCommand.options?.some(o => o.name === 'rule')).toBe(false);
  });
});
