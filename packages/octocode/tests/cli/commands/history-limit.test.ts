import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const executeDirectTool = vi.fn();

vi.mock('@octocodeai/octocode-tools-core/direct', () => ({
  executeDirectTool: (...args: unknown[]) => executeDirectTool(...args),
}));

vi.mock('../../../src/utils/colors.js', () => ({
  c: (_color: string, s: string) => s,
  bold: (s: string) => s,
  dim: (s: string) => s,
}));

import { historyCommand } from '../../../src/cli/commands/history.js';
import type { ParsedArgs } from '../../../src/cli/types.js';

function run(args: string[], options: Record<string, string | boolean> = {}) {
  const parsed: ParsedArgs = { command: 'history', args, options };
  return historyCommand.handler(parsed);
}

function okEnvelope() {
  return {
    isError: false,
    content: [],
    structuredContent: {
      results: [{ id: 'q1', data: { commits: [], pagination: {} } }],
    },
  };
}

function lastQuery() {
  const call = executeDirectTool.mock.calls.at(-1);
  return (call?.[1] as { queries: Array<Record<string, unknown>> }).queries[0];
}

describe('history command limit alignment', () => {
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

  it('uses --limit as the GitHub commit page size for JSON and rendered output', async () => {
    await run(['vercel/next.js'], { limit: '2', json: true });

    expect(executeDirectTool).toHaveBeenCalledTimes(1);
    expect(lastQuery()).toMatchObject({
      type: 'commits',
      owner: 'vercel',
      repo: 'next.js',
      perPage: 2,
    });
  });

  it('lets --page-size override --limit for the underlying commit query', async () => {
    await run(['vercel/next.js'], { limit: '2', 'page-size': '5', json: true });

    expect(lastQuery().perPage).toBe(5);
  });
});
