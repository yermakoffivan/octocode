import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const executeDirectTool = vi.fn();

vi.mock('@octocodeai/octocode-tools-core/direct', () => ({
  executeDirectTool: (...args: unknown[]) => executeDirectTool(...args),
}));

vi.mock('../../../src/utils/colors.js', () => ({
  c: (_color: string, s: string) => s,
  dim: (s: string) => s,
}));

import { catCommand } from '../../../src/cli/commands/cat.js';
import { EXIT } from '../../../src/cli/exit-codes.js';
import type { ParsedArgs } from '../../../src/cli/types.js';

function run(args: string[], options: Record<string, string | boolean> = {}) {
  const parsed: ParsedArgs = { command: 'cat', args, options };
  return catCommand.handler(parsed);
}

function okLocalContent(content: string) {
  return {
    isError: false,
    content: [],
    structuredContent: {
      results: [{ id: 'q1', data: { content } }],
    },
  };
}

function okGithubContent(content: string) {
  return {
    isError: false,
    content: [],
    structuredContent: {
      results: [{ id: 'q1', files: [{ content }] }],
    },
  };
}

function materializedFileEnvelope(
  localPath = '/tmp/octocode/tmp/tree/facebook/react/main/packages/react/index.js'
) {
  return {
    isError: false,
    content: [],
    structuredContent: {
      results: [
        {
          id: 'facebook/react',
          files: [
            {
              content: 'export const x = 1;',
              localPath,
              repoRoot: '/tmp/octocode/tmp/tree/facebook/react/main',
              resolvedBranch: 'main',
            },
          ],
        },
      ],
    },
  };
}

function lastQuery() {
  const call = executeDirectTool.mock.calls.at(-1);
  return (call?.[1] as { queries: Array<Record<string, unknown>> }).queries[0];
}

describe('cat command', () => {
  const stdoutChunks: string[] = [];

  beforeEach(() => {
    stdoutChunks.length = 0;
    executeDirectTool.mockReset();
    executeDirectTool.mockResolvedValue(okLocalContent('hello'));
    process.exitCode = undefined;
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    vi.spyOn(process.stdout, 'write').mockImplementation(chunk => {
      stdoutChunks.push(String(chunk));
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it('--raw prints only the returned local content and defaults to exact text', async () => {
    await run(['./src/index.ts'], { raw: true });

    expect(executeDirectTool).toHaveBeenCalledTimes(1);
    expect(executeDirectTool.mock.calls[0]?.[0]).toBe('localGetFileContent');
    expect(lastQuery().minify).toBe('none');
    expect(stdoutChunks.join('')).toBe('hello\n');
    expect(console.log).not.toHaveBeenCalled();
    expect(process.stderr.write).not.toHaveBeenCalled();
  });

  it('--raw reads GitHub file content from files[0].content and preserves explicit mode', async () => {
    executeDirectTool.mockResolvedValue(okGithubContent('outline\n'));

    await run(['owner/repo/src/index.ts'], { raw: true, mode: 'symbols' });

    expect(executeDirectTool).toHaveBeenCalledTimes(1);
    expect(executeDirectTool.mock.calls[0]?.[0]).toBe('ghGetFileContent');
    expect(lastQuery().minify).toBe('symbols');
    expect(stdoutChunks.join('')).toBe('outline\n');
  });

  it('rejects --raw with --json because they are competing output formats', async () => {
    await run(['./src/index.ts'], { raw: true, json: true });

    expect(executeDirectTool).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(EXIT.USAGE);
  });

  it('--repo materializes the remote file, then reads the saved absolute local path', async () => {
    executeDirectTool
      .mockResolvedValueOnce(materializedFileEnvelope())
      .mockResolvedValueOnce(okLocalContent('export const x = 1;'));

    await run(['packages/react/index.js'], {
      repo: 'facebook/react',
      branch: 'main',
      'force-refresh': true,
      mode: 'symbols',
      json: true,
    });

    expect(executeDirectTool).toHaveBeenCalledTimes(2);
    expect(executeDirectTool.mock.calls[0]?.[0]).toBe('ghGetFileContent');
    expect(executeDirectTool.mock.calls[0]?.[1]).toMatchObject({
      queries: [
        {
          owner: 'facebook',
          repo: 'react',
          branch: 'main',
          path: 'packages/react/index.js',
          type: 'file',
          forceRefresh: true,
          fullContent: true,
          minify: 'none',
        },
      ],
    });
    expect(executeDirectTool.mock.calls[1]?.[0]).toBe('localGetFileContent');
    expect(lastQuery()).toMatchObject({
      path: '/tmp/octocode/tmp/tree/facebook/react/main/packages/react/index.js',
      minify: 'symbols',
    });
  });

  it('prints a --char-offset pagination hint when more content remains', async () => {
    executeDirectTool.mockResolvedValue({
      isError: false,
      content: [],
      structuredContent: {
        results: [
          {
            id: 'q1',
            data: {
              content: 'first page',
              pagination: {
                charOffset: 0,
                charLength: 8000,
                currentPage: 1,
                hasMore: true,
                totalChars: 24049,
                totalPages: 4,
              },
            },
          },
        ],
      },
    });

    await run(['./src/index.ts']);

    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining(
        'More content — use --char-offset 8000 (page 2/4)'
      )
    );
  });

  it('does not print a pagination hint when hasMore is false', async () => {
    executeDirectTool.mockResolvedValue({
      isError: false,
      content: [],
      structuredContent: {
        results: [
          {
            id: 'q1',
            data: {
              content: 'whole file',
              pagination: { hasMore: false, totalPages: 1 },
            },
          },
        ],
      },
    });

    await run(['./src/index.ts']);

    expect(console.log).not.toHaveBeenCalledWith(
      expect.stringContaining('More content')
    );
  });
});
