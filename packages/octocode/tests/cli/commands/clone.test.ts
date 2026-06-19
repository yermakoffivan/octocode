import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const executeDirectTool = vi.fn();

vi.mock('@octocodeai/octocode-tools-core/direct', () => ({
  executeDirectTool: (...args: unknown[]) => executeDirectTool(...args),
}));

vi.mock('../../../src/utils/colors.js', () => ({
  c: (_color: string, s: string) => s,
  dim: (s: string) => s,
}));

import { cloneCommand } from '../../../src/cli/commands/clone.js';
import type { ParsedArgs } from '../../../src/cli/types.js';

function run(args: string[], options: Record<string, string | boolean> = {}) {
  const parsed: ParsedArgs = { command: 'clone', args, options };
  return cloneCommand.handler(parsed);
}

describe('clone command', () => {
  beforeEach(() => {
    executeDirectTool.mockReset();
    process.exitCode = undefined;
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it('delegates to ghCloneRepo and prints the returned local path', async () => {
    executeDirectTool.mockResolvedValue({
      isError: false,
      content: [],
      structuredContent: {
        results: [{ data: { localPath: '/tmp/octocode/repos/react' } }],
      },
    });

    await run(['facebook/react']);

    expect(executeDirectTool).toHaveBeenCalledWith(
      'ghCloneRepo',
      expect.objectContaining({
        queries: [
          expect.objectContaining({ owner: 'facebook', repo: 'react' }),
        ],
      })
    );
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('Local clone: /tmp/octocode/repos/react')
    );
  });
});
