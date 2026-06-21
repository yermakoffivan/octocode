import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const executeDirectTool = vi.fn();

vi.mock('@octocodeai/octocode-tools-core/direct', () => ({
  executeDirectTool: (...args: unknown[]) => executeDirectTool(...args),
}));

// printDirectToolResult writes the result blob to stdout; stub it so we can
// assert only on the truncation warning, which must go to stderr.
vi.mock('../../../src/cli/commands/direct-tool-output.js', () => ({
  printDirectToolResult: vi.fn(),
  markDirectToolFailure: vi.fn(),
}));

vi.mock('../../../src/utils/colors.js', () => ({
  c: (_color: string, s: string) => s,
  dim: (s: string) => s,
}));

import { binaryCommand } from '../../../src/cli/commands/binary.js';
import type { ParsedArgs } from '../../../src/cli/types.js';

function run(args: string[], options: Record<string, string | boolean> = {}) {
  const parsed: ParsedArgs = { command: 'binary', args, options };
  return binaryCommand.handler(parsed);
}

// Mirrors the real bulk envelope: the handler payload is nested under `data`,
// so scanTruncated lives at results[0].data.scanTruncated (NOT on the row).
function envelope(data: Record<string, unknown>) {
  return {
    isError: false,
    content: [],
    structuredContent: { results: [{ id: 'q1', status: 'success', data }] },
  };
}

function lastQuery() {
  const call = executeDirectTool.mock.calls.at(-1);
  return (call?.[1] as { queries: Array<Record<string, unknown>> }).queries[0];
}

describe('binary command scan-window continuation', () => {
  let stderr: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    executeDirectTool.mockReset();
    process.exitCode = undefined;
    stderr = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true) as unknown as ReturnType<typeof vi.spyOn>;
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  function stderrText() {
    return stderr.mock.calls.map((c: unknown[]) => String(c[0])).join('');
  }

  it('surfaces the lossless continuation cursor on stderr (survives stdout | grep)', async () => {
    executeDirectTool.mockResolvedValue(
      envelope({ mode: 'strings', nextScanOffset: 67108864 })
    );
    await run(['big.bin'], { strings: true });
    const out = stderrText();
    expect(out).toMatch(/scan-offset 67108864/);
    expect(out).toMatch(/lossless|remains/i);
  });

  it('does not prompt continuation when the scan reached EOF', async () => {
    executeDirectTool.mockResolvedValue(envelope({ mode: 'strings' }));
    await run(['small.node'], { strings: true });
    expect(stderrText()).not.toMatch(/scan-offset/);
  });

  it('stays silent in --json mode (machine consumer reads nextScanOffset itself)', async () => {
    executeDirectTool.mockResolvedValue(
      envelope({ mode: 'strings', nextScanOffset: 67108864 })
    );
    await run(['big.bin'], { strings: true, json: true });
    expect(stderrText()).not.toMatch(/scan-offset/);
  });

  it('threads --scan-offset into the strings query', async () => {
    executeDirectTool.mockResolvedValue(envelope({ mode: 'strings' }));
    await run(['big.bin'], { strings: true, 'scan-offset': '67108864' });
    const q = lastQuery();
    expect(q.scanOffset).toBe(67108864);
  });

  it('threads --detailed into inspect queries only when requested', async () => {
    executeDirectTool.mockResolvedValue(envelope({ mode: 'inspect' }));
    await run(['addon.node'], { inspect: true, detailed: true });

    expect(lastQuery()).toMatchObject({
      mode: 'inspect',
      detailed: true,
    });
  });

  it('keeps inspect concise by default', async () => {
    executeDirectTool.mockResolvedValue(envelope({ mode: 'inspect' }));
    await run(['addon.node'], { inspect: true });

    expect(lastQuery().detailed).toBeUndefined();
  });

  it('threads an explicit --char-length into the strings query', async () => {
    executeDirectTool.mockResolvedValue(envelope({ mode: 'strings' }));
    await run(['big.bin'], { strings: true, 'char-length': '123' });

    expect(lastQuery().charLength).toBe(123);
  });
});
