import { describe, expect, it } from 'vitest';

import {
  bundleEvidence,
  rankEvidence,
  type EvidenceItem,
  type RankEvidenceOptions,
} from '../../../src/utils/ranking/evidenceRanker.js';

let counter = 0;
function item(over: Partial<EvidenceItem>): EvidenceItem {
  counter += 1;
  return {
    id: over.id ?? `i${counter}`,
    source: 'codeSearch',
    sourceRank: 1,
    status: 'ok',
    confidence: 'medium',
    intent: 'unknown',
    path: '/repo/src/a.ts',
    reasons: [],
    ...over,
  };
}

const opts = (
  over: Partial<RankEvidenceOptions> = {}
): RankEvidenceOptions => ({
  task: 'generic',
  ...over,
});

describe('bundleEvidence', () => {
  it('merges hits on the same symbol/path into one bundle with all contributors', () => {
    const items = [
      item({ source: 'lsp', symbol: 'createSession', intent: 'definition' }),
      item({
        source: 'structural',
        symbol: 'createSession',
        intent: 'declaration',
      }),
      item({
        source: 'codeSearch',
        symbol: 'createSession',
        intent: 'reference',
      }),
    ];
    const bundles = bundleEvidence(items);
    expect(bundles).toHaveLength(1);
    expect(bundles[0]?.contributors).toHaveLength(3);
  });

  it('keeps distinct targets separate', () => {
    const bundles = bundleEvidence([
      item({ path: '/repo/a.ts', symbol: 'foo' }),
      item({ path: '/repo/b.ts', symbol: 'bar' }),
    ]);
    expect(bundles).toHaveLength(2);
  });
});

describe('rankEvidence — consensus and authority', () => {
  it('a bundle confirmed by 3 sources outranks a single code-search hit', () => {
    const consensus = [
      item({
        source: 'lsp',
        symbol: 'X',
        intent: 'definition',
        confidence: 'high',
        quality: 'exact',
      }),
      item({
        source: 'structural',
        symbol: 'X',
        intent: 'declaration',
        quality: 'exact',
      }),
      item({ source: 'codeSearch', symbol: 'X', intent: 'reference' }),
    ];
    const lone = [
      item({
        source: 'codeSearch',
        path: '/repo/src/z.ts',
        symbol: 'Y',
        intent: 'reference',
      }),
    ];
    const res = rankEvidence(
      [...consensus, ...lone],
      opts({ task: 'definition' })
    );
    expect(res.allBundles[0]?.target.symbol).toBe('X');
    expect(res.allBundles[0]?.reasons.join(' ')).toMatch(
      /LSP \+ structural \+ code search/
    );
  });

  it('definition task ranks an LSP definition above a comment-only code hit', () => {
    const def = item({
      source: 'lsp',
      symbol: 'createSession',
      intent: 'definition',
      confidence: 'high',
      quality: 'exact',
      path: '/repo/src/session.ts',
    });
    const comment = item({
      source: 'codeSearch',
      symbol: 'createSession',
      intent: 'reference',
      quality: 'comment',
      confidence: 'low',
      path: '/repo/docs/notes.md',
    });
    const res = rankEvidence([comment, def], opts({ task: 'definition' }));
    expect(res.allBundles[0]?.target.path).toBe('/repo/src/session.ts');
  });
});

describe('rankEvidence — uncertainty stays visible but penalized', () => {
  it('routes stale/unsupported evidence to weakOrSkipped, not silently dropped', () => {
    const res = rankEvidence(
      [
        item({
          source: 'lsp',
          symbol: 'A',
          intent: 'definition',
          confidence: 'high',
          quality: 'exact',
        }),
        item({
          source: 'lsp',
          path: '/repo/x.ts',
          symbol: 'B',
          status: 'stale',
          confidence: 'low',
        }),
      ],
      opts({ task: 'definition' })
    );
    const weakSymbols = res.groups.weakOrSkipped.map(b => b.target.symbol);
    expect(weakSymbols).toContain('B');
    // Still present in allBundles — never dropped.
    expect(res.allBundles.map(b => b.target.symbol)).toContain('B');
  });

  it('honors includeWeak:false by omitting weak bundles from groups', () => {
    const res = rankEvidence(
      [item({ status: 'unsupported', confidence: 'low', symbol: 'U' })],
      opts({ includeWeak: false })
    );
    expect(res.groups.weakOrSkipped).toHaveLength(0);
  });
});

describe('rankEvidence — determinism', () => {
  it('produces identical ordering across runs', () => {
    const items = [
      item({
        source: 'lsp',
        symbol: 'A',
        intent: 'definition',
        confidence: 'high',
        quality: 'exact',
        path: '/repo/b.ts',
      }),
      item({
        source: 'structural',
        symbol: 'A',
        intent: 'declaration',
        quality: 'exact',
        path: '/repo/b.ts',
      }),
      item({ source: 'codeSearch', symbol: 'C', path: '/repo/a.ts' }),
      item({ source: 'codeSearch', symbol: 'D', path: '/repo/c.ts' }),
    ];
    const a = rankEvidence(items, opts({ task: 'references' }));
    const b = rankEvidence(items, opts({ task: 'references' }));
    expect(a.allBundles.map(x => x.id)).toEqual(b.allBundles.map(x => x.id));
  });

  it('breaks ties deterministically by confidence then path', () => {
    const res = rankEvidence(
      [
        item({
          source: 'codeSearch',
          symbol: 'S',
          path: '/repo/zzz.ts',
          confidence: 'medium',
        }),
        item({
          source: 'codeSearch',
          symbol: 'S',
          path: '/repo/aaa.ts',
          confidence: 'medium',
        }),
      ],
      opts()
    );
    // Different symbols? no — same symbol S but different paths => different bundles.
    expect(res.allBundles[0]?.target.path).toBe('/repo/aaa.ts');
  });
});

describe('rankEvidence — diversity & budget', () => {
  it('caps bundles per file, overflow goes to maybe', () => {
    const many = Array.from({ length: 5 }, (_, i) =>
      item({
        source: 'codeSearch',
        path: '/repo/src/big.ts',
        symbol: `sym${i}`,
        range: { startLine: i + 1 },
        confidence: 'medium',
      })
    );
    const res = rankEvidence(many, opts());
    const inBigFile = (g: { target: { path: string } }[]) =>
      g.filter(b => b.target.path === '/repo/src/big.ts').length;
    const promoted =
      inBigFile(res.groups.mustRead) + inBigFile(res.groups.supporting);
    expect(promoted).toBeLessThanOrEqual(2);
    expect(res.groups.maybe.length).toBeGreaterThan(0);
  });

  it('token budget penalizes heavy bundles', () => {
    const cheap = item({
      source: 'lsp',
      symbol: 'cheap',
      intent: 'definition',
      confidence: 'high',
      quality: 'exact',
      tokenCost: 50,
      path: '/repo/a.ts',
    });
    const heavy = item({
      source: 'lsp',
      symbol: 'heavy',
      intent: 'definition',
      confidence: 'high',
      quality: 'exact',
      tokenCost: 9000,
      path: '/repo/b.ts',
    });
    const res = rankEvidence(
      [heavy, cheap],
      opts({ task: 'definition', tokenBudget: 10000 })
    );
    expect(res.allBundles[0]?.target.symbol).toBe('cheap');
  });
});
