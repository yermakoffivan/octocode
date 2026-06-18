import { describe, it, expect } from 'vitest';
import {
  findUnknownOptions,
  getAllowedOptionNames,
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
