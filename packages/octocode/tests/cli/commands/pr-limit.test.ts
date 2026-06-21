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

import { prCommand } from '../../../src/cli/commands/pr.js';
import type { ParsedArgs } from '../../../src/cli/types.js';

function run(args: string[], options: Record<string, string | boolean> = {}) {
  const parsed: ParsedArgs = { command: 'pr', args, options };
  return prCommand.handler(parsed);
}

function okEnvelope() {
  return {
    isError: false,
    content: [],
    structuredContent: {
      results: [{ id: 'q1', data: { pull_requests: [], pagination: {} } }],
    },
  };
}

function prEnvelope(prs: Array<Record<string, unknown>>) {
  return {
    isError: false,
    content: [],
    structuredContent: {
      results: [{ id: 'q1', data: { pull_requests: prs, pagination: {} } }],
    },
  };
}

function lastQuery() {
  const call = executeDirectTool.mock.calls.at(-1);
  return (call?.[1] as { queries: Array<Record<string, unknown>> }).queries[0];
}

describe('pr command limit alignment', () => {
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
    vi.useRealTimers();
    process.exitCode = undefined;
  });

  it('uses --limit as the GitHub PR page size for JSON and rendered output', async () => {
    await run(['vercel/next.js'], { limit: '2', json: true });

    expect(executeDirectTool).toHaveBeenCalledTimes(1);
    expect(lastQuery()).toMatchObject({
      type: 'prs',
      owner: 'vercel',
      repo: 'next.js',
      limit: 2,
    });
  });

  it('lets --page-size override --limit for the underlying PR query', async () => {
    await run(['vercel/next.js'], { limit: '2', 'page-size': '5', json: true });

    expect(lastQuery().limit).toBe(5);
  });

  it('labels closed PR timestamps with the closed date instead of recent update freshness', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-20T12:00:00Z'));
    executeDirectTool.mockResolvedValue(
      prEnvelope([
        {
          number: 123,
          title: 'Old closed PR with fresh comments',
          state: 'closed',
          author: 'alice',
          closedAt: '2025-01-01T00:00:00Z',
          updatedAt: '2026-06-20T11:00:00Z',
          createdAt: '2024-12-01T00:00:00Z',
        },
      ])
    );

    await run(['vercel/next.js#123']);

    const output = vi
      .mocked(console.log)
      .mock.calls.map(call => String(call[0]))
      .join('\n');
    expect(output).toContain('closed 2025-01-01');
    expect(output).not.toContain('updated 1h ago');
  });
});
