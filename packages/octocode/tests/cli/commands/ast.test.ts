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

import { astCommand } from '../../../src/cli/commands/ast.js';
import type { ParsedArgs } from '../../../src/cli/types.js';

function run(args: string[], options: Record<string, unknown> = {}) {
  const parsed: ParsedArgs = { command: 'ast', args, options };
  return astCommand.handler(parsed);
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

function lastQuery() {
  const call = executeDirectTool.mock.calls.at(-1);
  return (call?.[1] as { queries: Array<Record<string, unknown>> }).queries[0];
}

describe('ast command', () => {
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

  it('positional pattern runs structural search; arg[1] is the path', async () => {
    await run(['eval($X)', 'src']);
    expect(executeDirectTool).toHaveBeenCalledTimes(1);
    const [tool] = executeDirectTool.mock.calls[0];
    expect(tool).toBe('localSearchCode');
    const q = lastQuery();
    expect(q.mode).toBe('structural');
    expect(q.pattern).toBe('eval($X)');
    expect(q.rule).toBeUndefined();
    expect(String(q.path)).toContain('src');
  });

  it('--pattern flag makes arg[0] the path', async () => {
    await run(['src'], { pattern: 'console.log($$$)' });
    const q = lastQuery();
    expect(q.mode).toBe('structural');
    expect(q.pattern).toBe('console.log($$$)');
    expect(String(q.path)).toContain('src');
  });

  it('--rule runs structural search with the rule blob', async () => {
    await run(['.'], { rule: 'rule:\n  pattern: foo($X)' });
    const q = lastQuery();
    expect(q.mode).toBe('structural');
    expect(q.rule).toBe('rule:\n  pattern: foo($X)');
    expect(q.pattern).toBeUndefined();
  });

  it('rejects --pattern and --rule together', async () => {
    await run(['.'], { pattern: 'foo($X)', rule: 'rule: bar' });
    expect(executeDirectTool).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it('rejects a GitHub ref (local-only)', async () => {
    await run(['facebook/react'], { pattern: 'useState($X)' });
    expect(executeDirectTool).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it('requires a pattern or rule', async () => {
    await run([]);
    expect(executeDirectTool).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });
});
