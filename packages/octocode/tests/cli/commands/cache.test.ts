import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const executeDirectTool = vi.fn();

vi.mock('@octocodeai/octocode-tools-core/direct', () => ({
  executeDirectTool: (...args: unknown[]) => executeDirectTool(...args),
}));

vi.mock('../../../src/utils/colors.js', () => ({
  c: (_color: string, s: string) => s,
  dim: (s: string) => s,
}));

import { cacheCommand } from '../../../src/cli/commands/cache.js';
import type { ParsedArgs } from '../../../src/cli/types.js';

function run(args: string[], options: Record<string, string | boolean> = {}) {
  const parsed: ParsedArgs = { command: 'cache', args, options };
  return cacheCommand.handler(parsed);
}

function fetchFileEnvelope(
  localPath = '/tmp/octocode/tmp/tree/facebook/react/main/packages/react/index.js'
) {
  return {
    isError: false,
    content: [],
    structuredContent: {
      results: [
        {
          id: 'facebook/react',
          owner: 'facebook',
          repo: 'react',
          files: [
            {
              path: 'packages/react/index.js',
              content: 'export {};',
              localPath,
              repoRoot: '/tmp/octocode/tmp/tree/facebook/react/main',
              resolvedBranch: 'main',
              cached: true,
            },
          ],
        },
      ],
    },
  };
}

describe('cache command', () => {
  beforeEach(() => {
    executeDirectTool.mockReset();
    executeDirectTool.mockResolvedValue(fetchFileEnvelope());
    process.exitCode = undefined;
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it('cache fetch materializes a remote path and returns structured location data', async () => {
    await run(['fetch', 'facebook/react', 'packages/react/index.js'], {
      depth: 'file',
      json: true,
    });

    expect(executeDirectTool).toHaveBeenCalledWith(
      'ghGetFileContent',
      expect.objectContaining({
        queries: [
          expect.objectContaining({
            owner: 'facebook',
            repo: 'react',
            path: 'packages/react/index.js',
            type: 'file',
            fullContent: true,
            minify: 'none',
          }),
        ],
      })
    );

    const output = vi.mocked(console.log).mock.calls.flat().join('\n');
    const parsed = JSON.parse(output) as {
      success: boolean;
      source: string;
      localPath: string;
      repoRoot: string;
      location: {
        kind: string;
        localPath: string;
        repoRoot?: string;
        requestedPath?: string;
        source?: string;
        cached?: boolean;
        complete?: boolean;
        resolvedBranch?: string;
      };
    };
    expect(parsed.success).toBe(true);
    expect(parsed.source).toBe('tree');
    expect(parsed.repoRoot).toBe('/tmp/octocode/tmp/tree/facebook/react/main');
    expect(parsed.localPath).toBe(
      '/tmp/octocode/tmp/tree/facebook/react/main/packages/react/index.js'
    );
    expect(parsed.location.kind).toBe('file');
    expect(parsed.location.source).toBe('tree');
    expect(parsed.location.localPath).toBe(
      '/tmp/octocode/tmp/tree/facebook/react/main/packages/react/index.js'
    );
    expect(parsed.location.repoRoot).toBe(
      '/tmp/octocode/tmp/tree/facebook/react/main'
    );
    expect(parsed.location.requestedPath).toBe('packages/react/index.js');
    expect(parsed.location.resolvedBranch).toBe('main');
    expect(parsed.location.cached).toBe(true);
    expect(parsed.location.complete).toBe(true);
  });
});
