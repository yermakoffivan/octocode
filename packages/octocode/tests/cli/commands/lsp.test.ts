import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const executeDirectTool = vi.fn();

vi.mock('@octocodeai/octocode-tools-core/direct', () => ({
  executeDirectTool: (...args: unknown[]) => executeDirectTool(...args),
}));

vi.mock('../../../src/utils/colors.js', () => ({
  c: (_color: string, s: string) => s,
  dim: (s: string) => s,
}));

import { lspCommand } from '../../../src/cli/commands/lsp.js';
import { EXIT } from '../../../src/cli/exit-codes.js';
import type { ParsedArgs } from '../../../src/cli/types.js';

function run(options: Record<string, string | boolean> = {}) {
  const parsed: ParsedArgs = {
    command: 'lsp',
    args: ['src/index.ts'],
    options: {
      type: 'definition',
      symbol: 'runCLI',
      line: '10',
      json: true,
      ...options,
    },
  };
  return lspCommand.handler(parsed);
}

function lspEnvelope(payload: Record<string, unknown>) {
  return {
    isError: false,
    content: [],
    structuredContent: {
      results: [
        {
          id: 'q1',
          data: {
            type: 'definition',
            uri: 'index.ts',
            resolvedSymbol: { name: 'runCLI', foundAtLine: 10 },
            lsp: { serverAvailable: true },
            payload,
          },
        },
      ],
    },
  };
}

describe('lsp command', () => {
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

  it('sets NOT_FOUND for semantic empty payloads', async () => {
    executeDirectTool.mockResolvedValue(
      lspEnvelope({
        kind: 'empty',
        category: 'symbolNotFound',
        reason: 'Could not find symbol',
      })
    );

    await run();

    expect(process.exitCode).toBe(EXIT.NOT_FOUND);
  });

  it('renders definition locations directly for human output', async () => {
    executeDirectTool.mockResolvedValue(
      lspEnvelope({
        kind: 'definition',
        locations: [
          {
            uri: 'src/cli/index.ts',
            displayRange: { startLine: 73, endLine: 73 },
            content:
              'export async function runCLI(argv?: string[]): Promise<boolean> {',
          },
        ],
      })
    );

    await run({ json: false });

    const output = vi.mocked(console.log).mock.calls.flat().join('\n');
    expect(output).toContain('src/cli/index.ts:73-73');
    expect(output).toContain('export async function runCLI');
    expect(process.exitCode).toBeUndefined();
  });
});
