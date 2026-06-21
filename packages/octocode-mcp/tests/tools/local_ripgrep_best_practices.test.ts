import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  preflightValidateRipgrepPattern,
  type RipgrepPatternValidation,
} from '../../../octocode-tools-core/src/tools/local_ripgrep/patternValidation.js';

describe('T1.6 — Ripgrep regex is validated pre-launch (cheap fail-fast)', () => {
  it('accepts a plain literal pattern (smartCase mode)', () => {
    const v: RipgrepPatternValidation = preflightValidateRipgrepPattern({
      pattern: 'foo',
    });
    expect(v.isValid).toBe(true);
  });

  it('flags an unmatched paren as invalid', () => {
    const v = preflightValidateRipgrepPattern({ pattern: '(foo' });
    expect(v.isValid).toBe(false);
    expect(v.errors.join(' ').toLowerCase()).toContain('regex');
  });

  it('flags a dangling escape as invalid', () => {
    const v = preflightValidateRipgrepPattern({ pattern: 'foo\\' });
    expect(v.isValid).toBe(false);
  });

  it('warns when pattern looks literal but fixedString is not set', () => {
    const v = preflightValidateRipgrepPattern({ pattern: 'console.log' });
    expect(v.isValid).toBe(true);
    expect(v.warnings.join(' ')).toMatch(/fixedString/i);
  });

  it('does NOT warn when fixedString is already true', () => {
    const v = preflightValidateRipgrepPattern({
      pattern: 'console.log',
      fixedString: true,
    });
    expect(v.warnings.join(' ')).not.toMatch(/fixedString/i);
  });

  it('warns on lookaround constructs without -P (server cost guidance)', () => {
    const v = preflightValidateRipgrepPattern({ pattern: 'foo(?=bar)' });
    expect(v.warnings.join(' ').toLowerCase()).toMatch(/lookaround|perlregex/);
  });

  it('skips literal-likeness warning for clearly regex patterns', () => {
    const v = preflightValidateRipgrepPattern({ pattern: '^foo$' });
    expect(v.warnings.join(' ')).not.toMatch(/fixedString/i);
  });

  it('accepts empty pattern with explicit error (so caller can short-circuit)', () => {
    const v = preflightValidateRipgrepPattern({ pattern: '' });
    expect(v.isValid).toBe(false);
  });
});

describe('T1.7 — fs.readdir pre-flight is removed from the ripgrep hot path', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('does NOT call fs.readdir or fs.stat during a normal ripgrep search', async () => {
    const readdirSpy = vi.fn(async () => []);
    const statSpy = vi.fn(async () => ({ size: 0 }));

    vi.doMock('fs', async () => {
      const real = await vi.importActual<typeof import('fs')>('fs');
      return {
        ...real,
        promises: {
          ...real.promises,
          readdir: readdirSpy,
          stat: statSpy,
        },
      };
    });

    // Ripgrep runs in-process inside the native engine now; stub it so the
    // search resolves without touching the real filesystem.
    vi.doMock(
      '../../../octocode-tools-core/src/utils/contextUtils.js',
      async () => {
        const real = await vi.importActual<
          typeof import('../../../octocode-tools-core/src/utils/contextUtils.js')
        >('../../../octocode-tools-core/src/utils/contextUtils.js');
        return {
          ...real,
          contextUtils: {
            ...real.contextUtils,
            searchRipgrep: vi.fn(async () => ({ files: [], stats: {} })),
          },
        };
      }
    );

    vi.doMock(
      '../../../octocode-tools-core/src/utils/file/toolHelpers.js',
      async () => {
        const real = await vi.importActual<
          typeof import('../../../octocode-tools-core/src/utils/file/toolHelpers.js')
        >('../../../octocode-tools-core/src/utils/file/toolHelpers.js');
        return {
          ...real,
          validateToolPath: vi.fn(() => ({
            isValid: true,
            sanitizedPath: '/tmp/repo',
          })),
        };
      }
    );

    const { searchContentRipgrep } =
      await import('../../../octocode-tools-core/src/tools/local_ripgrep/searchContentRipgrep.js');

    await searchContentRipgrep({
      id: 'q1',
      researchGoal: 'test',
      reasoning: 'unit',
      keywords: 'foo',
      path: '/tmp/repo',
    } as Parameters<typeof searchContentRipgrep>[0]);

    expect(readdirSpy).not.toHaveBeenCalled();
    expect(statSpy).not.toHaveBeenCalled();
  });
});
