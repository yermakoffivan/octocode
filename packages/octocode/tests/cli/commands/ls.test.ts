import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

// Real, cwd-independent paths so outline mode's existsSync/statSync checks pass.
const THIS_FILE = fileURLToPath(import.meta.url);
const THIS_DIR = dirname(THIS_FILE);

const executeDirectTool = vi.fn();

vi.mock('@octocodeai/octocode-tools-core/direct', () => ({
  executeDirectTool: (...args: unknown[]) => executeDirectTool(...args),
}));

vi.mock('../../../src/utils/colors.js', () => ({
  c: (_color: string, s: string) => s,
  bold: (s: string) => s,
  dim: (s: string) => s,
}));

import { lsCommand } from '../../../src/cli/commands/ls.js';
import { EXIT } from '../../../src/cli/exit-codes.js';
import type { ParsedArgs } from '../../../src/cli/types.js';

function run(args: string[], options: Record<string, string | boolean> = {}) {
  const parsed: ParsedArgs = { command: 'ls', args, options };
  return lsCommand.handler(parsed);
}

function treeEnvelope() {
  return {
    isError: false,
    content: [],
    structuredContent: {
      results: [{ data: { path: 'src', files: [], folders: [] } }],
    },
  };
}

function findEnvelope() {
  return {
    isError: false,
    content: [],
    structuredContent: {
      results: [{ data: { files: [{ path: 'cli/commands/ls.ts' }] } }],
    },
  };
}

function toolsCalled(): string[] {
  return executeDirectTool.mock.calls.map(c => String(c[0]));
}

describe('ls command', () => {
  beforeEach(() => {
    executeDirectTool.mockReset();
    executeDirectTool.mockImplementation((tool: string) =>
      Promise.resolve(
        tool === 'localFindFiles' ? findEnvelope() : treeEnvelope()
      )
    );
    process.exitCode = undefined;
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it('lists a directory via localViewStructure (tree mode)', async () => {
    await run([THIS_DIR]);
    expect(toolsCalled()).toContain('localViewStructure');
    expect(toolsCalled()).not.toContain('lspGetSemantics');
  });

  it('a local file target auto-routes to a symbol outline (lspGetSemantics)', async () => {
    await run([THIS_FILE]);
    const tools = toolsCalled();
    expect(tools).toContain('lspGetSemantics');
    // single file → no directory discovery
    expect(tools).not.toContain('localFindFiles');
    expect(tools).not.toContain('localViewStructure');
  });

  it('--symbols on a directory discovers source files then outlines them', async () => {
    await run([THIS_DIR], { symbols: true });
    const tools = toolsCalled();
    expect(tools[0]).toBe('localFindFiles');
    expect(tools).toContain('lspGetSemantics');
    expect(tools).not.toContain('localViewStructure');
  });

  it('--symbols on a GitHub ref is rejected (local-only)', async () => {
    await run(['facebook/react'], { symbols: true });
    expect(executeDirectTool).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(EXIT.USAGE);
  });

  it('applies simple file filters to GitHub tree output', async () => {
    executeDirectTool.mockResolvedValueOnce({
      isError: false,
      content: [],
      structuredContent: {
        results: [
          {
            data: {
              structure: [
                {
                  dir: 'src',
                  folders: ['components', 'docs'],
                  files: ['index.ts', 'index.test.ts', 'README.md'],
                },
              ],
            },
          },
        ],
      },
    });

    await run(['facebook/react/src'], {
      ext: 'ts',
      pattern: 'index*',
      'files-only': true,
    });

    expect(process.exitCode).toBeUndefined();
    const output = vi.mocked(console.log).mock.calls.flat().join('\n');
    expect(output).toContain('index.ts');
    expect(output).toContain('index.test.ts');
    expect(output).not.toContain('README.md');
    expect(output).not.toContain('components');
  });

  it('exposes --symbols and --kind options', () => {
    expect(lsCommand.options?.some(o => o.name === 'symbols')).toBe(true);
    expect(lsCommand.options?.some(o => o.name === 'kind')).toBe(true);
  });
});
