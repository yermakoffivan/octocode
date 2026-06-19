import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Keep color helpers as identity passthroughs so assertions match plain text.
vi.mock('../../src/utils/colors.js', () => ({
  c: (_color: string, s: string) => s,
  bold: (s: string) => s,
  dim: (s: string) => s,
}));

import {
  findUnknownOptions,
  getAllowedOptionNames,
  findInvalidNumericOptions,
  printUnknownOptionError,
} from '../../src/cli/command-validation.js';
import { lsCommand } from '../../src/cli/commands/ls.js';
import { skillsCommand } from '../../src/cli/commands/skills.js';
import type { ParsedArgs } from '../../src/cli/types.js';

function args(options: ParsedArgs['options']): ParsedArgs {
  return { command: null, args: [], options };
}

describe('command option validation', () => {
  it('accepts a command-declared flag', () => {
    expect(findUnknownOptions(lsCommand, args({ depth: '2' }))).toEqual([]);
  });

  it('accepts global flags on any command', () => {
    expect(
      findUnknownOptions(lsCommand, args({ json: true, 'no-color': true }))
    ).toEqual([]);
  });

  it('flags an unknown option', () => {
    expect(findUnknownOptions(lsCommand, args({ dpeth: '2' }))).toEqual([
      'dpeth',
    ]);
  });

  it('accepts spec-only flags that the command object omits', () => {
    // `--query` is read by skills but only declared in the static spec.
    expect(findUnknownOptions(skillsCommand, args({ query: 'x' }))).toEqual([]);
  });

  it('always allows the global flag set', () => {
    const allowed = getAllowedOptionNames(lsCommand);
    for (const g of ['json', 'compact', 'no-color', 'help', 'version']) {
      expect(allowed.has(g)).toBe(true);
    }
  });
});

describe('findInvalidNumericOptions', () => {
  it('flags a non-integer numeric value', () => {
    expect(findInvalidNumericOptions(args({ limit: 'abc' }))).toEqual([
      '--limit=abc',
    ]);
  });

  it('validates the grep --context alias as numeric', () => {
    expect(findInvalidNumericOptions(args({ context: 'abc' }))).toEqual([
      '--context=abc',
    ]);
  });

  it('flags a negative numeric value', () => {
    expect(findInvalidNumericOptions(args({ page: '-1' }))).toEqual([
      '--page=-1',
    ]);
  });

  it('flags a value with trailing junk', () => {
    expect(findInvalidNumericOptions(args({ depth: '3x' }))).toEqual([
      '--depth=3x',
    ]);
  });

  it('validates grep --match-length as numeric', () => {
    expect(findInvalidNumericOptions(args({ 'match-length': 'abc' }))).toEqual([
      '--match-length=abc',
    ]);
  });

  it('accepts valid non-negative integers', () => {
    expect(findInvalidNumericOptions(args({ limit: '10', page: '0' }))).toEqual(
      []
    );
  });

  it('ignores non-numeric flags and boolean values', () => {
    expect(
      findInvalidNumericOptions(args({ mode: 'abc', json: true }))
    ).toEqual([]);
  });
});

describe('printUnknownOptionError', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  function output(): string {
    return logSpy.mock.calls
      .map((call: unknown[]) => call.join(' '))
      .join('\n');
  }

  it('names the offending flag and lists valid flags', () => {
    printUnknownOptionError(lsCommand, ['bogus']);
    const out = output();
    expect(out).toContain(`Unknown flag --bogus for '${lsCommand.name}'`);
    expect(out).toContain(`Valid flags for ${lsCommand.name}`);
  });

  it('suggests a near-miss flag for a typo', () => {
    printUnknownOptionError(lsCommand, ['dpeth']);
    expect(output()).toContain('did you mean --depth?');
  });

  it('does not suggest anything for an unrelated flag', () => {
    printUnknownOptionError(lsCommand, ['xxxxxxxxxx']);
    expect(output()).not.toContain('did you mean');
  });
});
