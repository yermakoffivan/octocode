import { describe, it, expect } from 'vitest';

import { REGISTERED_COMMAND_NAMES } from '../../src/cli/commands/index.js';
import { findStaticCommandHelp } from '../../src/cli/command-help-specs.js';

// Single source of truth: every CLI command's human-facing spec
// (description / usage / scheme / whenToUse / examples) lives in octocode-core
// and is resolved by name via findStaticCommandHelp. Command files carry only
// behavior (name + options + handler). These tests enforce that the content
// genuinely comes from core — so it can never silently drift back into a
// hardcoded string in the CLI package.
describe('CLI command content is sourced from octocode-core', () => {
  it('every registered command resolves a spec from core', () => {
    const missing = REGISTERED_COMMAND_NAMES.filter(
      name => !findStaticCommandHelp(name)
    );
    expect(missing).toEqual([]);
  });

  it('each resolved core spec carries the required help content', () => {
    for (const name of REGISTERED_COMMAND_NAMES) {
      const spec = findStaticCommandHelp(name);
      expect(spec, `no core spec for "${name}"`).toBeDefined();
      expect(spec!.description.trim().length).toBeGreaterThan(0);
      expect(spec!.usage?.startsWith(spec!.name)).toBe(true);
    }
  });

  it('command files no longer hardcode description/usage (only core has them)', async () => {
    // Spot-check a representative command object: it should expose name +
    // options + handler, but NOT a description/usage of its own.
    const { grepCommand } = await import('../../src/cli/commands/grep.js');
    const obj = grepCommand as unknown as Record<string, unknown>;
    expect(obj.name).toBe('grep');
    expect(typeof obj.handler).toBe('function');
    expect(obj.description).toBeUndefined();
    expect(obj.usage).toBeUndefined();
  });
});
