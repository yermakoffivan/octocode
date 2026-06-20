import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const executeDirectTool = vi.fn();

vi.mock('@octocodeai/octocode-tools-core/direct', () => ({
  executeDirectTool: (...args: unknown[]) => executeDirectTool(...args),
}));

vi.mock('../../../src/utils/colors.js', () => ({
  c: (_color: string, s: string) => s,
  dim: (s: string) => s,
}));

import { diffCommand } from '../../../src/cli/commands/diff.js';
import type { ParsedArgs } from '../../../src/cli/types.js';

function run(args: string[], options: Record<string, string | boolean> = {}) {
  const parsed: ParsedArgs = { command: 'diff', args, options };
  return diffCommand.handler(parsed);
}

function contentEnvelope(content: string) {
  return {
    isError: false,
    content: [],
    structuredContent: { results: [{ data: { content } }] },
  };
}

describe('diff command', () => {
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

  it('fetches both refs and renders a line diff', async () => {
    executeDirectTool
      .mockResolvedValueOnce(contentEnvelope('a\nb\nc'))
      .mockResolvedValueOnce(contentEnvelope('a\nB\nc'));

    await run(['left.ts', 'right.ts']);

    expect(executeDirectTool).toHaveBeenCalledTimes(2);
    const output = vi.mocked(console.log).mock.calls.flat().join('\n');
    expect(output).toContain('-b');
    expect(output).toContain('+B');
  });

  it('prints structured JSON when requested', async () => {
    executeDirectTool
      .mockResolvedValueOnce(contentEnvelope('same'))
      .mockResolvedValueOnce(contentEnvelope('same'));

    await run(['left.ts', 'right.ts'], { json: true });

    const output = vi.mocked(console.log).mock.calls.flat().join('\n');
    expect(JSON.parse(output)).toMatchObject({ equal: true });
  });
});
