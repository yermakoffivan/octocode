/**
 * Tier 2 — cross-source evidence fusion for code-research results.
 *
 * Raw LSP, structural-search, and code-search scores are not comparable. This
 * layer normalizes hits into `EvidenceItem`s, merges them into `EvidenceBundle`s
 * (one per useful target), fuses incomparable per-source ranks with weighted
 * Reciprocal Rank Fusion, reranks by task intent, diversifies, budgets for
 * tokens, and explains every result. See `.octocode/RANKING-ARCHITECTURE.md`.
 *
 * Determinism: no clock, no randomness. Sort is total via explicit
 * tie-breakers. Weak evidence is penalized but never silently dropped.
 */

export interface Range {
  startLine: number;
  endLine?: number;
}

export type EvidenceSource =
  | 'lsp'
  | 'structural'
  | 'codeSearch'
  | 'fileGraph'
  | 'signature'
  | 'contentView'
  | 'recentEdit'
  | 'testSignal'
  | 'diagnostic';

export type EvidenceStatus =
  | 'ok'
  | 'partial'
  | 'fallback'
  | 'ambiguous'
  | 'unsupported'
  | 'parserFailed'
  | 'truncated'
  | 'stale';

export type EvidenceIntent =
  | 'definition'
  | 'reference'
  | 'callsite'
  | 'declaration'
  | 'implementation'
  | 'test'
  | 'config'
  | 'doc'
  | 'schema'
  | 'route'
  | 'error'
  | 'unknown';

export type EvidenceConfidence = 'high' | 'medium' | 'low';

/** A measurement that can be mapped to a source weight (e.g. LSP fallback kind). */
export type EvidenceQuality =
  | 'exact'
  | 'detailed'
  | 'nearLineFallback'
  | 'wholeFileFallback'
  | 'partialAst'
  | 'fallbackText'
  | 'comment'
  | 'broadRegex';

export interface EvidenceItem {
  id: string;
  source: EvidenceSource;
  /** 1-based rank within this item's own source list (for RRF). */
  sourceRank: number;
  sourceScore?: number;
  status: EvidenceStatus;
  confidence: EvidenceConfidence;
  intent: EvidenceIntent;
  quality?: EvidenceQuality;
  path: string;
  range?: Range;
  symbol?: string;
  languageId?: string;
  textPreview?: string;
  tokenCost?: number;
  reasons: string[];
}

export interface EvidenceBundle {
  id: string;
  target: { path: string; range?: Range; symbol?: string; languageId?: string };
  primaryIntent: EvidenceIntent;
  contributors: EvidenceItem[];
  fusedScore: number;
  finalScore: number;
  confidence: EvidenceConfidence;
  status: EvidenceStatus;
  tokenCost: number;
  reasons: string[];
  warnings: string[];
}

export interface RankedEvidenceGroups {
  mustRead: EvidenceBundle[];
  supporting: EvidenceBundle[];
  maybe: EvidenceBundle[];
  weakOrSkipped: EvidenceBundle[];
}

export type RankTask =
  | 'definition'
  | 'references'
  | 'edit'
  | 'explain'
  | 'security'
  | 'test'
  | 'generic';

export interface RankEvidenceOptions {
  task: RankTask;
  seed?: { path?: string; range?: Range; symbol?: string; query?: string };
  tokenBudget?: number;
  maxBundles?: number;
  includeWeak?: boolean;
}

export interface RankEvidenceResult {
  groups: RankedEvidenceGroups;
  allBundles: EvidenceBundle[];
  scorerVersion: string;
}

export const SCORER_VERSION = 'tier2-rrf-1';

/** RRF constant — high k flattens the contribution of deep ranks. */
const RRF_K = 60;

/**
 * Source weights for RRF. Keyed by source, then by quality where a source has
 * meaningfully different trust levels (LSP semantic vs fallback scans, etc).
 */
const SOURCE_WEIGHTS: Record<
  EvidenceSource,
  Partial<Record<EvidenceQuality, number>> & { default: number }
> = {
  lsp: {
    default: 1.1,
    exact: 1.35,
    detailed: 1.1,
    nearLineFallback: 0.55,
    wholeFileFallback: 0.35,
  },
  structural: {
    default: 1.2,
    exact: 1.2,
    partialAst: 0.8,
    fallbackText: 0.4,
  },
  codeSearch: {
    default: 1.0,
    exact: 1.0,
    comment: 0.7,
    broadRegex: 0.55,
  },
  signature: { default: 0.9 },
  fileGraph: { default: 0.75 },
  recentEdit: { default: 0.85 },
  testSignal: { default: 0.7 },
  contentView: { default: 0.6 },
  diagnostic: { default: 0.75 },
};

const UNCERTAINTY_PENALTY: Record<EvidenceStatus, number> = {
  ok: 0,
  partial: -0.05,
  ambiguous: -0.08,
  fallback: -0.12,
  truncated: -0.12,
  parserFailed: -0.18,
  unsupported: -0.2,
  stale: -0.25,
};

const CONFIDENCE_RANK: Record<EvidenceConfidence, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

/** Per-task intent ordering. Earlier = stronger fit boost. */
const TASK_INTENT_ORDER: Record<RankTask, EvidenceIntent[]> = {
  definition: ['definition', 'declaration', 'implementation', 'reference'],
  references: ['reference', 'callsite', 'implementation', 'definition'],
  edit: ['definition', 'implementation', 'declaration', 'test', 'reference'],
  explain: ['declaration', 'definition', 'route', 'reference', 'test', 'doc'],
  security: ['callsite', 'implementation', 'definition', 'config'],
  test: ['test', 'implementation', 'definition'],
  generic: [],
};

function sourceWeight(item: EvidenceItem): number {
  const table = SOURCE_WEIGHTS[item.source];
  if (item.quality && table[item.quality] !== undefined) {
    return table[item.quality] as number;
  }
  return table.default;
}

// ---------------------------------------------------------------------------
// Bundling: merge items that point at the same useful target.
// ---------------------------------------------------------------------------

/** Deterministic bundle key. Items with the same key merge into one bundle. */
function bundleKeyFor(item: EvidenceItem): string {
  if (item.symbol) return `${item.path}::sym::${item.symbol}`;
  if (item.range) return `${item.path}::line::${item.range.startLine}`;
  return `${item.path}`;
}

function mergeStatus(a: EvidenceStatus, b: EvidenceStatus): EvidenceStatus {
  // Strongest (closest to ok) status wins for the bundle headline.
  return UNCERTAINTY_PENALTY[a] >= UNCERTAINTY_PENALTY[b] ? a : b;
}

function mergeConfidence(
  a: EvidenceConfidence,
  b: EvidenceConfidence
): EvidenceConfidence {
  return CONFIDENCE_RANK[a] >= CONFIDENCE_RANK[b] ? a : b;
}

export function bundleEvidence(items: EvidenceItem[]): EvidenceBundle[] {
  const groups = new Map<string, EvidenceItem[]>();
  // Stable input order preserved within each group.
  for (const item of items) {
    const key = bundleKeyFor(item);
    const existing = groups.get(key);
    if (existing) existing.push(item);
    else groups.set(key, [item]);
  }

  const bundles: EvidenceBundle[] = [];
  for (const [key, contributors] of groups) {
    // Choose the primary contributor: highest single source weight, then
    // strongest confidence, then lowest sourceRank — deterministic.
    const primary = [...contributors].sort((a, b) => {
      const w = sourceWeight(b) - sourceWeight(a);
      if (w !== 0) return w;
      const c = CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence];
      if (c !== 0) return c;
      return a.sourceRank - b.sourceRank;
    })[0]!;

    let status = contributors[0]!.status;
    let confidence = contributors[0]!.confidence;
    let tokenCost = 0;
    const reasons: string[] = [];
    for (const c of contributors) {
      status = mergeStatus(status, c.status);
      confidence = mergeConfidence(confidence, c.confidence);
      tokenCost += c.tokenCost ?? 0;
      for (const r of c.reasons) if (!reasons.includes(r)) reasons.push(r);
    }

    bundles.push({
      id: key,
      target: {
        path: primary.path,
        range: primary.range,
        symbol: primary.symbol,
        languageId: primary.languageId,
      },
      primaryIntent: primary.intent,
      contributors,
      fusedScore: 0,
      finalScore: 0,
      confidence,
      status,
      tokenCost,
      reasons,
      warnings: [],
    });
  }
  return bundles;
}

// ---------------------------------------------------------------------------
// Fusion + rerank.
// ---------------------------------------------------------------------------

function fuse(bundle: EvidenceBundle): number {
  let score = 0;
  for (const c of bundle.contributors) {
    score += sourceWeight(c) / (RRF_K + c.sourceRank);
  }
  return score;
}

function distinctSources(bundle: EvidenceBundle): Set<EvidenceSource> {
  return new Set(bundle.contributors.map(c => c.source));
}

function rerank(bundle: EvidenceBundle, options: RankEvidenceOptions): number {
  let score = bundle.fusedScore;

  // Intent fit: position of the bundle's intent in the task's preferred order.
  const order = TASK_INTENT_ORDER[options.task];
  const idx = order.indexOf(bundle.primaryIntent);
  if (idx >= 0) {
    const fit = (order.length - idx) / order.length; // 1.0 .. ~0
    score += 0.3 * fit;
    bundle.reasons.push(
      `fits ${options.task} intent (${bundle.primaryIntent})`
    );
  }

  // Evidence consensus: independent sources agreeing.
  const sources = distinctSources(bundle);
  if (
    sources.has('lsp') &&
    sources.has('structural') &&
    sources.has('codeSearch')
  ) {
    score += 0.3;
    bundle.reasons.push('confirmed by LSP + structural + code search');
  } else if (sources.has('lsp') && sources.has('structural')) {
    score += 0.25;
    bundle.reasons.push('confirmed by LSP + structural');
  } else if (sources.has('structural') && sources.has('codeSearch')) {
    score += 0.12;
    bundle.reasons.push('confirmed by structural + code search');
  }

  // Proximity to seed.
  if (options.seed) {
    const s = options.seed;
    if (s.symbol && bundle.target.symbol === s.symbol) {
      score += 0.1;
      bundle.reasons.push('same symbol as seed');
    }
    if (s.path && bundle.target.path === s.path) {
      score += 0.08;
      bundle.reasons.push('same file as seed');
    } else if (s.path && sameDir(bundle.target.path, s.path)) {
      score += 0.04;
      bundle.reasons.push('same directory as seed');
    }
  }

  // Token-cost penalty (only when a budget is set).
  if (options.tokenBudget && bundle.tokenCost > 0) {
    const penalty = Math.min(
      0.25,
      (bundle.tokenCost / options.tokenBudget) * 0.5
    );
    score -= penalty;
  }

  // Uncertainty penalty — weak evidence ranks lower but stays visible.
  score += UNCERTAINTY_PENALTY[bundle.status];

  return Math.round(score * 1e6) / 1e6;
}

function sameDir(a: string, b: string): boolean {
  const da = a.slice(0, a.lastIndexOf('/'));
  const db = b.slice(0, b.lastIndexOf('/'));
  return da.length > 0 && da === db;
}

// ---------------------------------------------------------------------------
// Total ordering + grouping.
// ---------------------------------------------------------------------------

function compareBundles(a: EvidenceBundle, b: EvidenceBundle): number {
  if (b.finalScore !== a.finalScore) return b.finalScore - a.finalScore;
  const c = CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence];
  if (c !== 0) return c;
  // fewer uncertainty states (closer to ok) first
  const u = UNCERTAINTY_PENALTY[b.status] - UNCERTAINTY_PENALTY[a.status];
  if (u !== 0) return u;
  if (a.tokenCost !== b.tokenCost) return a.tokenCost - b.tokenCost;
  if (a.target.path !== b.target.path) {
    return a.target.path.localeCompare(b.target.path);
  }
  const al = a.target.range?.startLine ?? 0;
  const bl = b.target.range?.startLine ?? 0;
  if (al !== bl) return al - bl;
  return a.id.localeCompare(b.id);
}

interface PackState {
  perFile: Map<string, number>;
  perSymbol: Set<string>;
}

function isWeak(b: EvidenceBundle): boolean {
  return (
    b.status === 'unsupported' ||
    b.status === 'parserFailed' ||
    b.status === 'stale' ||
    (b.confidence === 'low' && distinctSources(b).size === 1)
  );
}

/** Diversity packing: ≤2 bundles per file, ≤1 per symbol cluster. */
function diversify(
  sorted: EvidenceBundle[],
  options: RankEvidenceOptions
): RankedEvidenceGroups {
  const groups: RankedEvidenceGroups = {
    mustRead: [],
    supporting: [],
    maybe: [],
    weakOrSkipped: [],
  };
  const state: PackState = { perFile: new Map(), perSymbol: new Set() };
  const maxBundles = options.maxBundles ?? 25;
  let packed = 0;

  for (const b of sorted) {
    if (isWeak(b)) {
      if (options.includeWeak !== false) groups.weakOrSkipped.push(b);
      continue;
    }
    const fileCount = state.perFile.get(b.target.path) ?? 0;
    const symKey = b.target.symbol
      ? `${b.target.path}::${b.target.symbol}`
      : undefined;
    const symbolSeen = symKey ? state.perSymbol.has(symKey) : false;

    const overFileCap = fileCount >= 2;
    if ((overFileCap || symbolSeen) && packed >= 1) {
      groups.maybe.push(b);
      continue;
    }

    state.perFile.set(b.target.path, fileCount + 1);
    if (symKey) state.perSymbol.add(symKey);
    packed += 1;

    if (packed > maxBundles) {
      groups.maybe.push(b);
      continue;
    }
    // Top tier = high confidence with consensus or strong single semantic source.
    if (
      b.confidence === 'high' &&
      (distinctSources(b).size >= 2 ||
        b.contributors.some(c => c.source === 'lsp'))
    ) {
      groups.mustRead.push(b);
    } else {
      groups.supporting.push(b);
    }
  }
  return groups;
}

/** Rank a flat list of normalized evidence items into explained groups. */
export function rankEvidence(
  items: EvidenceItem[],
  options: RankEvidenceOptions
): RankEvidenceResult {
  const bundles = bundleEvidence(items);
  for (const b of bundles) {
    b.fusedScore = Math.round(fuse(b) * 1e6) / 1e6;
  }
  for (const b of bundles) {
    b.finalScore = rerank(b, options);
  }
  const sorted = [...bundles].sort(compareBundles);
  const groups = diversify(sorted, options);
  return { groups, allBundles: sorted, scorerVersion: SCORER_VERSION };
}
