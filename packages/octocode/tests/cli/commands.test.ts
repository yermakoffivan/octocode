import { describe, it, expect } from 'vitest';

describe('CLI command registry', () => {
  it('does not expose removed token and skills commands', async () => {
    const { findCommand, loadCommand } =
      await import('../../src/cli/commands/index.js');

    expect(findCommand('token')).toBeUndefined();
    expect(findCommand('skills')).toBeUndefined();
    expect(await loadCommand('token')).toBeUndefined();
    expect(await loadCommand('skills')).toBeUndefined();
  });

  it('keeps status as the read-only token/auth command', async () => {
    const { findCommand } = await import('../../src/cli/commands/index.js');
    const cmd = findCommand('status');

    expect(cmd).toBeDefined();
    expect(cmd!.name).toBe('status');
  });
});
