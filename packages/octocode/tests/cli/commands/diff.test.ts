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

function githubContentEnvelope(content: string) {
  return {
    isError: false,
    content: [],
    structuredContent: { results: [{ files: [{ content }] }] },
  };
}

function errorEnvelope(text: string) {
  return {
    isError: true,
    content: [{ type: 'text', text }],
    structuredContent: {},
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

  it('reads GitHub content from files[0].content', async () => {
    executeDirectTool
      .mockResolvedValueOnce(githubContentEnvelope('left'))
      .mockResolvedValueOnce(githubContentEnvelope('right'));

    await run(['owner/repo/a.ts', 'owner/repo/b.ts']);

    expect(executeDirectTool.mock.calls[0]?.[0]).toBe('ghGetFileContent');
    const output = vi.mocked(console.log).mock.calls.flat().join('\n');
    expect(output).toContain('-left');
    expect(output).toContain('+right');
  });

  it('prints a usage error when a side is missing', async () => {
    await run(['left.ts']);

    expect(executeDirectTool).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(2);
  });

  it('prints content fetch failures with the classified exit code', async () => {
    executeDirectTool.mockResolvedValueOnce(
      errorEnvelope('HTTP 401 Bad credentials')
    );

    await run(['left.ts', 'right.ts']);

    expect(process.exitCode).toBe(4);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('HTTP 401 Bad credentials')
    );
  });

  it('reports missing content in JSON mode', async () => {
    executeDirectTool
      .mockResolvedValueOnce({
        isError: false,
        content: [],
        structuredContent: {},
      })
      .mockResolvedValueOnce(contentEnvelope('right'));

    await run(['left.ts', 'right.ts'], { json: true });

    expect(
      JSON.parse(vi.mocked(console.log).mock.calls[0]?.[0] as string)
    ).toEqual({
      success: false,
      error: expect.stringContaining('No content returned'),
    });
  });

  it('honors context-lines when rendering larger diffs', async () => {
    executeDirectTool
      .mockResolvedValueOnce(contentEnvelope('a\nb\nc\nd\ne'))
      .mockResolvedValueOnce(contentEnvelope('a\nb\nC\nd\ne'));

    await run(['left.ts', 'right.ts'], { 'context-lines': '0' });

    const output = vi.mocked(console.log).mock.calls.flat().join('\n');
    expect(output).toContain('...');
    expect(output).toContain('-c');
    expect(output).toContain('+C');
  });
});
