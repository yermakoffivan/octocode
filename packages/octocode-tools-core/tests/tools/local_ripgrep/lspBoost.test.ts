import { describe, expect, it } from 'vitest';

import type { LocalSearchCodeFile } from '@octocodeai/octocode-core/types';
import {
  applySemanticBoost,
  lspBoostScore,
  LSP_BOOST,
  type LspResolver,
  type LspSignal,
} from '../../../src/tools/local_ripgrep/lspBoost.js';
import type { FileScore } from '../../../src/tools/local_ripgrep/rankingProfile.js';

const f = (path: string): LocalSearchCodeFile => ({ path, matchCount: 1 });

const baseScore = (score: number): FileScore => ({
  score,
  profile: 'typescript',
  pathRole: 'source',
  reasons: ['base'],
});

describe('lspBoostScore', () => {
  it('is capped and deterministic', () => {
    const all: LspSignal = {
      isDefinition: true,
      isExportedOrPublic: true,
      hasCallers: true,
      isImplementationOrType: true,
    };
    expect(lspBoostScore(all).delta).toBe(LSP_BOOST.cap);
  });

  it('returns no boost for null/unavailable signals', () => {
    expect(lspBoostScore(null).delta).toBe(0);
    expect(lspBoostScore({ unavailable: true }).delta).toBe(0);
  });

  it('a lone callers signal never outweighs a definition', () => {
    expect(lspBoostScore({ hasCallers: true }).delta).toBeLessThan(
      lspBoostScore({ isDefinition: true }).delta
    );
  });
});

describe('applySemanticBoost', () => {
  it('reorders top-N by boost while never adding or removing files', async () => {
    const files = [f('/repo/a.ts'), f('/repo/b.ts'), f('/repo/c.ts')];
    const base = new Map<string, FileScore>([
      ['/repo/a.ts', baseScore(10)],
      ['/repo/b.ts', baseScore(9)],
      ['/repo/c.ts', baseScore(8)],
    ]);
    // b is a definition (+3), so it should jump ahead of a (10 vs 9+3=12).
    const resolve: LspResolver = async file =>
      file.path === '/repo/b.ts' ? { isDefinition: true } : null;

    const res = await applySemanticBoost(files, resolve, {
      topN: 3,
      baseScores: base,
    });
    expect(res.files.map(x => x.path)).toEqual([
      '/repo/b.ts',
      '/repo/a.ts',
      '/repo/c.ts',
    ]);
    expect(res.enriched).toBe(true);
    expect(res.files).toHaveLength(3);
  });

  it('a no-op resolver reproduces the input order exactly (graceful)', async () => {
    const files = [f('/repo/a.ts'), f('/repo/b.ts')];
    const base = new Map([
      ['/repo/a.ts', baseScore(5)],
      ['/repo/b.ts', baseScore(3)],
    ]);
    const res = await applySemanticBoost(files, async () => null, {
      topN: 2,
      baseScores: base,
    });
    expect(res.files.map(x => x.path)).toEqual(['/repo/a.ts', '/repo/b.ts']);
    expect(res.enriched).toBe(false);
  });

  it('a throwing resolver degrades that candidate without throwing', async () => {
    const files = [f('/repo/a.ts'), f('/repo/b.ts')];
    const base = new Map([
      ['/repo/a.ts', baseScore(5)],
      ['/repo/b.ts', baseScore(3)],
    ]);
    const resolve: LspResolver = async file => {
      if (file.path === '/repo/a.ts') throw new Error('LSP down');
      return { isDefinition: true };
    };
    const res = await applySemanticBoost(files, resolve, {
      topN: 2,
      baseScores: base,
    });
    // b boosted to 6, a stays 5 -> b first; no throw.
    expect(res.files.map(x => x.path)).toEqual(['/repo/b.ts', '/repo/a.ts']);
  });

  it('never touches files beyond topN', async () => {
    const files = [f('/repo/a.ts'), f('/repo/b.ts'), f('/repo/c.ts')];
    const base = new Map([
      ['/repo/a.ts', baseScore(5)],
      ['/repo/b.ts', baseScore(4)],
      ['/repo/c.ts', baseScore(3)],
    ]);
    // c would get a huge boost but is outside topN=2, so order of tail is fixed.
    const resolve: LspResolver = async file =>
      file.path === '/repo/c.ts' ? { isDefinition: true } : null;
    const res = await applySemanticBoost(files, resolve, {
      topN: 2,
      baseScores: base,
    });
    expect(res.files[2]?.path).toBe('/repo/c.ts');
    expect(res.enriched).toBe(false);
  });

  it('folds the boost into debug scores when provided', async () => {
    const files = [f('/repo/a.ts')];
    const base = new Map([['/repo/a.ts', baseScore(10)]]);
    const res = await applySemanticBoost(
      files,
      async () => ({ isDefinition: true, isExportedOrPublic: true }),
      { topN: 1, baseScores: base }
    );
    expect(res.debug?.get('/repo/a.ts')?.score).toBe(15);
    expect(res.debug?.get('/repo/a.ts')?.reasons.join(' ')).toMatch(
      /LSP: definition/
    );
  });
});
