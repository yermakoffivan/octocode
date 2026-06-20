/**
 * Tier 1 Phase 3 — optional, bounded LSP semantic boost for relevance ranking.
 *
 * Runs only for `sort:"relevance"` + `semanticRanking:true`, and only over the
 * top-N relevance candidates already produced by the text/AST scorer. LSP
 * enriches; it never gates. Rules (see RANKING-ARCHITECTURE.md):
 *   1. LSP never adds or removes a result — only reorders the top-N.
 *   2. Failure/timeout degrades to the existing text/AST order (graceful).
 *   3. Boosts are capped and deterministic given the resolver's output.
 *   4. An LSP boost never outweighs a strong exact declaration on its own.
 */
import type { LocalSearchCodeFile } from '@octocodeai/octocode-core/types';
import type { FileScore } from './rankingProfile.js';

/** What LSP can tell us about a candidate's anchor symbol. */
export interface LspSignal {
  isDefinition?: boolean;
  isExportedOrPublic?: boolean;
  hasCallers?: boolean;
  isImplementationOrType?: boolean;
  /** Resolver couldn't anchor / server unavailable — treated as no boost. */
  unavailable?: boolean;
}

/** Capped additive boosts. Sum is bounded by LSP_BOOST_CAP. */
export const LSP_BOOST = {
  definition: 3,
  exportedOrPublic: 2,
  hasCallers: 1,
  implementationOrType: 1,
  cap: 5,
} as const;

export function lspBoostScore(signal: LspSignal | null | undefined): {
  delta: number;
  reasons: string[];
} {
  if (!signal || signal.unavailable) return { delta: 0, reasons: [] };
  let delta = 0;
  const reasons: string[] = [];
  if (signal.isDefinition) {
    delta += LSP_BOOST.definition;
    reasons.push('LSP: definition site');
  }
  if (signal.isExportedOrPublic) {
    delta += LSP_BOOST.exportedOrPublic;
    reasons.push('LSP: exported/public symbol');
  }
  if (signal.hasCallers) {
    delta += LSP_BOOST.hasCallers;
    reasons.push('LSP: has callers');
  }
  if (signal.isImplementationOrType) {
    delta += LSP_BOOST.implementationOrType;
    reasons.push('LSP: implementation/type relation');
  }
  return { delta: Math.min(delta, LSP_BOOST.cap), reasons };
}

export type LspResolver = (
  file: LocalSearchCodeFile
) => Promise<LspSignal | null>;

export interface SemanticBoostResult {
  files: LocalSearchCodeFile[];
  /** Updated debug scores (boost folded in) keyed by path, when debug is on. */
  debug?: Map<string, FileScore>;
  /** True if any candidate was enriched; false means full graceful degrade. */
  enriched: boolean;
}

/**
 * Apply a bounded LSP boost to the top-N already-relevance-ranked files.
 *
 * `baseScores` is the Tier 1 score per path (when available). The resolver is
 * injected so this is unit-testable and the live wiring (lspGetSemantics) stays
 * out of the pure scoring path. Any resolver rejection degrades that one
 * candidate to its base order; the call never throws.
 */
export async function applySemanticBoost(
  rankedFiles: LocalSearchCodeFile[],
  resolve: LspResolver,
  opts: { topN?: number; baseScores?: Map<string, FileScore> } = {}
): Promise<SemanticBoostResult> {
  const topN = Math.max(0, opts.topN ?? 10);
  if (topN === 0 || rankedFiles.length === 0) {
    return { files: rankedFiles, enriched: false };
  }

  const head = rankedFiles.slice(0, topN);
  const tail = rankedFiles.slice(topN);

  const signals = await Promise.all(
    head.map(async file => {
      try {
        return await resolve(file);
      } catch {
        return null; // graceful degrade for this candidate
      }
    })
  );

  let enriched = false;
  const debug = opts.baseScores ? new Map(opts.baseScores) : undefined;

  // Compute a boosted score per head file. Files keep their base score when
  // LSP adds nothing, so a no-op resolver reproduces the input order exactly.
  const boosted = head.map((file, i) => {
    const base = opts.baseScores?.get(file.path)?.score ?? 0;
    const { delta, reasons } = lspBoostScore(signals[i]);
    if (delta > 0) {
      enriched = true;
      const existing = debug?.get(file.path);
      if (existing) {
        debug!.set(file.path, {
          ...existing,
          score: Math.round((existing.score + delta) * 100) / 100,
          reasons: [...existing.reasons, ...reasons],
        });
      }
    }
    return { file, score: base + delta, origIndex: i };
  });

  // Stable re-sort: boosted score desc, then original relevance order.
  boosted.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.origIndex - b.origIndex;
  });

  return {
    files: [...boosted.map(b => b.file), ...tail],
    debug,
    enriched,
  };
}
