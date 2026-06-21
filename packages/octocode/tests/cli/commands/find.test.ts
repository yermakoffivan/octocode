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

import { findFilesCommand } from '../../../src/cli/commands/find.js';
import type { ParsedArgs } from '../../../src/cli/types.js';

function run(args: string[], options: Record<string, string | boolean> = {}) {
  const parsed: ParsedArgs = { command: 'find', args, options };
  return findFilesCommand.handler(parsed);
}

function materializedTreeEnvelope(
  localPath = '/tmp/octocode/tmp/tree/facebook/react/main/packages/react'
) {
  return {
    isError: false,
    content: [],
    structuredContent: {
      results: [
        {
          id: 'facebook/react',
          directories: [
            {
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

describe('find command', () => {
  beforeEach(() => {
    executeDirectTool.mockReset();
    executeDirectTool.mockResolvedValue({
      isError: false,
      content: [],
      structuredContent: {
        results: [
          {
            data: {
              files: [{ path: 'src/a.ts' }, { path: 'src/b.ts' }],
            },
          },
        ],
      },
    });
    process.exitCode = undefined;
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it('supports --concise for local path search', async () => {
    await run(['auth', '.'], { concise: true });

    expect(executeDirectTool).toHaveBeenCalledWith(
      'localFindFiles',
      expect.any(Object)
    );
    const output = vi.mocked(console.log).mock.calls.flat().join('\n');
    expect(output).toContain('src/a.ts');
    expect(output).toContain('src/b.ts');
  });

  it('maps local content --concise to discovery mode', async () => {
    await run(['auth', '.'], { concise: true, search: 'content' });

    const query = (
      executeDirectTool.mock.calls[0]?.[1] as {
        queries: Array<Record<string, unknown>>;
      }
    ).queries[0];
    expect(query.mode).toBe('discovery');
  });

  it('--repo materializes remote content and includes structured location metadata for composite output', async () => {
    executeDirectTool.mockResolvedValueOnce(materializedTreeEnvelope());

    await run(['useState'], {
      repo: 'facebook/react',
      path: 'packages/react',
      search: 'both',
      json: true,
    });

    expect(executeDirectTool).toHaveBeenCalledTimes(3);
    expect(executeDirectTool.mock.calls[0]?.[0]).toBe('ghGetFileContent');
    expect(executeDirectTool.mock.calls[0]?.[1]).toMatchObject({
      queries: [
        {
          owner: 'facebook',
          repo: 'react',
          path: 'packages/react',
          type: 'directory',
        },
      ],
    });
    expect(executeDirectTool.mock.calls[1]?.[0]).toBe('localFindFiles');
    expect(executeDirectTool.mock.calls[1]?.[1]).toMatchObject({
      queries: [
        {
          path: '/tmp/octocode/tmp/tree/facebook/react/main/packages/react',
        },
      ],
    });
    expect(executeDirectTool.mock.calls[2]?.[0]).toBe('localSearchCode');
    expect(executeDirectTool.mock.calls[2]?.[1]).toMatchObject({
      queries: [
        {
          path: '/tmp/octocode/tmp/tree/facebook/react/main/packages/react',
          keywords: 'useState',
        },
      ],
    });

    const output = vi.mocked(console.log).mock.calls.flat().join('\n');
    const parsed = JSON.parse(output) as {
      location?: {
        kind?: string;
        localPath?: string;
        repoRoot?: string;
        requestedPath?: string;
        source?: string;
      };
    };
    expect(parsed.location?.kind).toBe('directory');
    expect(parsed.location?.localPath).toBe(
      '/tmp/octocode/tmp/tree/facebook/react/main/packages/react'
    );
    expect(parsed.location?.source).toBe('tree');
    expect(parsed.location?.requestedPath).toBe('packages/react');
  });
});
