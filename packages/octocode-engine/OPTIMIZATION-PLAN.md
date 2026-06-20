# Octocode Engine Optimization Plan

## Goal

Make `octocode-engine` a stronger native research engine for AI agents: compact
enough to save tokens, faithful enough to cite, explicit enough to expose weak
evidence, and structured enough to reuse work across repeated local searches,
minification, structural matching, sanitization, and LSP anchoring.

This plan is based on:

- `.octocode/research/opportunities.md`
- `.octocode/research/context-aware-scanning-for-parsing-extensible-languages_summary.md`
- `.octocode/research/efficient-and-flexible-incremental-parsing_summary.md`
- `.octocode/research/incremental-analysis-of-real-programming-languages_summary.md`
- `.octocode/research/practical-algorithms-for-incremental-software-development-environments_summary.md`

## Current Baseline

The package already has the right ownership model. `src/lib.rs` only wires
modules, `src/bindings/` is the NAPI boundary, and domain logic lives in Rust
modules:

- `src/minify/` owns full minification, content-view minification, strategy
  dispatch, and the 1 MiB content guard.
- `src/structural/` owns AST search, query validation, file traversal, literal
  prefiltering, and ast-grep integration.
- `src/lsp/` owns native LSP support, command validation, fuzzy position
  resolution, URI/path handling, and workspace detection.
- `src/security/` owns secret detection and sanitization.
- `src/search/` and `src/text/` own ripgrep parsing/search, line extraction,
  UTF-8/UTF-16 conversion, filesystem queries, and small text utilities.
- `src/signatures/` owns symbol/signature extraction and tree-sitter language
  registry behavior.

The strongest optimization path is therefore not a rewrite. The path is to add
shared evidence metadata, source mapping, diagnostics, and snapshot readiness
behind the current owners while preserving existing string-returning APIs.

## Research Takeaways

1. **Context matters more than global token meaning.** Mixed files and ambiguous
   syntax need local language regions and context-aware interpretation, not one
   file-extension-wide assumption.
2. **Uncertainty must be represented.** Empty, unsupported, parser failed,
   fallback, ambiguous, truncated, sanitized, and stale are different states.
3. **Incrementality starts with stable snapshots.** The engine can define
   `FileSnapshot`, line indexes, changed ranges, and reuse metadata before it
   implements full incremental parsing.
4. **Minified output is a view, not source replacement.** Every transformed line
   should either map back to source or explicitly report that it cannot.
5. **Long sequences need bounded structures.** Line maps, result sets, match
   groups, diagnostics, token streams, and context chunks should be pageable and
   cheap to slice.
6. **Real code is partial and mixed.** Invalid syntax, generated files,
   comments, embedded languages, and edit-in-progress files are normal inputs,
   not edge cases.
7. **Measure agent usefulness, not only speed.** Token reduction matters, but so
   do citation fidelity, fallback clarity, anchor accuracy, and structural
   match precision.

## Design Rules

- Keep `src/lib.rs` and `src/bindings/` thin. New `#[napi]` wrappers should call
  Rust domain modules rather than carry logic.
- Add metadata-returning APIs first. Do not break `minifyContentSync`,
  `minifyContentResult`, `applyMinification`, `structuralSearch`,
  `structuralSearchFiles`, or `resolvePosition` in the first phases.
- Keep shared structs in `src/types.rs` only when they are truly cross-domain.
  Domain-specific diagnostics can start inside `src/minify/`,
  `src/structural/`, `src/lsp/`, or `src/security/`.
- Preserve UTF-16 LSP character semantics at the NAPI boundary. Do not mix byte,
  Unicode-scalar, and UTF-16 offsets silently.
- Prefer content hashes plus analyzer versions over path/mtime-only cache keys.
- Treat whole-file parsing, whole-file scanning, and whole-file minification as
  acceptable fallbacks, but make them visible in metadata.
- Keep TypeScript wrappers as orchestration and response-shaping layers. Rust
  remains the source of truth for parsing, matching, minification, redaction,
  and offset mapping.

## Target Concepts

### Analysis Status

Use a compact status vocabulary across new detailed APIs:

```ts
type AnalysisStatus =
  | 'ok'
  | 'partial'
  | 'unsupported'
  | 'ambiguous'
  | 'parserFailed'
  | 'fallback'
  | 'truncated'
  | 'stale'
```

### Analysis Diagnostic

Diagnostics should be machine-readable but still useful to humans:

```ts
interface AnalysisDiagnostic {
  code: string
  severity: 'info' | 'warning' | 'error'
  stage:
    | 'snapshot'
    | 'regionize'
    | 'scan'
    | 'parse'
    | 'match'
    | 'minify'
    | 'sanitize'
    | 'lsp'
    | 'paginate'
  message: string
  range?: Range
  recovery?: string
}
```

### File Snapshot

Snapshots should be lightweight enough to introduce before any daemon cache:

```ts
interface FileSnapshot {
  id: string
  path?: string
  contentHash: string
  byteLength: number
  lineCount: number
  encoding: 'utf8'
  analyzerVersion?: string
  previousId?: string
  changedRanges?: Range[]
}
```

### Analysis Metadata

Every detailed result should be able to explain quality and reuse:

```ts
interface AnalysisMetadata {
  snapshotId?: string
  analyzer: string
  analyzerVersion: string
  languageId?: string
  status: AnalysisStatus
  lineMapGuarantee: 'exact' | 'range-preserving' | 'line-preserving' | 'none'
  diagnostics: AnalysisDiagnostic[]
  fallback?: {
    from: string
    to: string
    reason: string
    lostGuarantees: string[]
  }
  reusedRanges?: Range[]
  recomputedRanges?: Range[]
}
```

## Roadmap

### Phase 1: Metadata and Diagnostics Foundation

**Objective:** make result quality explicit without changing existing default
API behavior.

Primary files:

- `src/types.rs`
- `src/minify/minifier.rs`
- `src/structural/types.rs`
- `src/lsp/types.rs`
- `src/security/types.rs`
- `index.d.ts`

Work:

- Add NAPI-safe metadata structs for shared concepts only.
- Add domain-local diagnostics where global types would be premature.
- Normalize common states: oversized input, invalid JSON, unsupported
  structural extension, invalid structural query, parser failure, prefilter
  skip, LSP grammar miss, fallback line scan, redaction, and truncation.
- Keep existing return shapes stable; expose metadata through new detailed
  variants.

Acceptance gates:

- Existing `yarn verify` behavior remains unchanged.
- Tests prove true empty results are distinguishable from unsupported,
  skipped, parser failed, fallback, and truncated states in new APIs.
- New NAPI objects are reflected in `index.d.ts`.

### Phase 2: Source-Faithful Content Views

**Objective:** make minification and content-view output citation-safe.

Primary files:

- `src/minify/minifier.rs`
- `src/minify/apply.rs`
- `src/minify/strategies/`
- `src/bindings/minify.rs`
- `src/signatures/mod.rs`
- `src/text/utf8_offsets.rs`

Work:

- Add `analyzeContentView` or `minifyContentViewResult` as an additive API.
- Return content, strategy, status, line-map guarantee, omitted regions,
  preserved regions, diagnostics, and optional language regions.
- Start with line-map guarantees before building a full source map for every
  strategy.
- Keep the current 1 MiB guard and existing anti-growth behavior for
  `applyMinification` and symbol skeletons.
- Add a `research` view prototype after metadata is stable: imports, exports,
  public APIs, route declarations, config keys, error strings, selected intent
  comments, and explicit omitted body ranges.

Acceptance gates:

- Oversized input returns unchanged content plus an explicit size diagnostic.
- Invalid JSON preserves current failure behavior and adds structured
  diagnostics.
- Standard/content-view minification never claims exact mapping when it
  collapses or reshapes lines.
- Multibyte input tests prove byte and UTF-16 behavior remain correct.
- Benchmarks report token reduction and citation-map correctness.

### Phase 3: Structural Search as Evidence

**Objective:** make AST search explainable enough for agents to trust.

Primary files:

- `src/structural/types.rs`
- `src/structural/query.rs`
- `src/structural/matcher.rs`
- `src/structural/files.rs`
- `src/structural/mod.rs`
- `tests/ffi.test.ts`
- `benchmark/ast/check-ast.mjs`

Work:

- Add `structuralSearchDetailed` and `structuralSearchFilesDetailed`.
- Return per-file parse status, language ID, diagnostics, skipped reason, and
  fallback metadata.
- Add stable match IDs derived from path, range, query fingerprint, and
  analyzer version.
- Add node metadata where available: node kind, ancestor kinds, and confidence
  such as `exact-ast`, `partial-ast`, or `fallback-text`.
- Add `explainStructuralQuery` to report normalized pattern/rule, literal
  anchor, unsafe prefilter reasons, expected node kinds where available, and
  repair diagnostics.
- Keep literal prefiltering conservative. If `not:` or `any:` makes a single
  anchor unsafe, report the reason rather than guessing.

Acceptance gates:

- Unsupported extension is not reported as true zero matches.
- Invalid pattern/rule returns diagnostics with recovery text.
- Prefilter-skipped files are counted and explainable.
- Match IDs are stable across repeated runs on unchanged content.
- Existing AST benchmark compatibility is preserved.

### Phase 4: Detailed LSP Anchoring

**Objective:** expose why fuzzy `symbolName + lineHint` resolved to a position
and whether the anchor is strong enough for semantic calls.

Primary files:

- `src/lsp/resolver.rs`
- `src/lsp/types.rs`
- `src/bindings/lsp.rs`
- `src/lsp/config.rs`
- `src/lsp/validation.rs`
- `src/lsp/native.ts`
- `src/lsp/resolver.ts`

Work:

- Keep `resolvePosition` and `resolvePositionFromContent` as single-position
  APIs.
- Add `resolvePositionDetailed` and a content-based equivalent.
- Return selected candidate, candidate set, method, ambiguity reason,
  confidence, line offset, line content, and diagnostics.
- Distinguish `tree-sitter`, `near-line-scan`, and `whole-file-scan`.
- Preserve command/path safety checks in LSP validation.
- Attach snapshot IDs once Phase 6 metadata exists.

Acceptance gates:

- Repeated symbol names report ambiguity and explain `orderHint` usage.
- Comment/string hits are not preferred over grammar-backed symbol candidates.
- Non-ASCII prefixes still return correct UTF-16 LSP character offsets.
- Fallback scans are visible in metadata.
- Rejected LSP commands remain rejected.

### Phase 5: Compound Document Regionization

**Objective:** let one file contain multiple analyzable language regions.

Primary files:

- `src/text/file_extension.rs`
- new `src/text/regionizer.rs` or domain-local `regionizer` module
- `src/minify/strategies/web.rs`
- `src/minify/strategies/markdown.rs`
- `src/structural/`
- `src/security/`
- `src/signatures/languages.rs`

Work:

- Add a lightweight `LanguageRegion` detector rather than a full parser
  generator.
- Start with Markdown fences, HTML/Vue/Svelte script/style blocks, TSX/JSX
  angle-bracket-sensitive contexts, YAML shell/script blocks, and tagged
  JS/TS template literals for `sql`, `gql`, `html`, and `css`.
- Include confidence: `exact`, `heuristic`, or `fallback`.
- Let minification consume regions first, then structural search, then
  sanitization metadata.
- Keep regionization optional and metadata-returning until fixtures prove
  correctness.

Acceptance gates:

- Markdown code fences preserve source line mapping.
- Vue/Svelte/HTML embedded scripts and styles report separate regions.
- YAML shell/script regions are detected with conservative confidence.
- Regionizer failures degrade to whole-file analysis with diagnostics.
- Compound-document fixtures are added to AST, minify, and sanitizer evals.

### Phase 6: Snapshot-Aware Reuse

**Objective:** make repeated agent workflows faster and less brittle without
building an IDE-scale incremental parser.

Primary files:

- `src/types.rs`
- `src/text/utf8_offsets.rs`
- `src/minify/`
- `src/structural/`
- `src/security/detector.rs`
- `src/search/ripgrep_parser.rs`
- `src/search/line_extractor.rs`

Work:

- Add optional snapshot inputs/outputs to detailed APIs.
- Cache line indexes, content views, structural ASTs, compiled structural
  matchers, sanitizer spans, and parsed ripgrep result pages by content hash
  plus analyzer version plus options.
- Report reused and recomputed ranges where known.
- Expand invalidation beyond exact edits to safe boundaries: line starts,
  delimiters, enclosing syntax nodes, chunk overlap, or language-specific
  restart points.
- Keep caches lifecycle-neutral at first. The TypeScript/MCP layer can decide
  whether to retain them per session.

Acceptance gates:

- Small edit benchmarks report recomputed bytes/ranges versus reused ranges.
- Cache keys include analyzer version and options that affect output.
- Stale snapshot usage emits a diagnostic rather than silently reusing anchors.
- Chunked sanitizer behavior still catches secrets near chunk boundaries.

### Phase 7: Agent Quality Benchmarks

**Objective:** guard the product value of optimization work.

Primary files:

- `benchmark/`
- `benchmark/README.md`
- `benchmark/SUPPORT.md`
- `tests/ffi.test.ts`
- domain-specific Rust unit tests

Work:

- Add eval fixtures for huge TS/TSX files, repeated symbol names, malformed
  JS/TS/Rust/Python, Markdown fences, Vue/Svelte/HTML, CI YAML shell blocks,
  generated/minified files, and redacted secrets.
- Track token reduction ratio, line-map correctness, structural match
  precision/recall, LSP anchor accuracy, fallback classification accuracy,
  redaction span preservation, malformed-file partial-result rate, and cache
  reuse rate.
- Keep current `ast`, `lsp`, `minify`, and support-matrix checks, then add
  quality metrics beside them.

Acceptance gates:

- Every new detailed API has at least one quality fixture, one fallback fixture,
  and one malformed/partial fixture.
- Existing hot paths stay available while metadata paths prove their overhead.
- Benchmark output can answer: faster, smaller, more citeable, or more honest?

## Recommended First PRs

### PR 1: Structural Search Diagnostics and Match IDs

Start here because structural search already has counters and warnings, but it
does not yet let callers distinguish all skipped and unsupported cases from
true zero matches.

Scope:

- Add structural-local file status and diagnostics.
- Add deterministic match IDs.
- Add language ID to file results where available.
- Add query explanation for literal anchors and unsafe prefilter cases.
- Preserve existing `StructuralSearchFilesResult` fields.

Tests:

- Invalid query diagnostics.
- Unsupported extension diagnostics.
- Stable match IDs.
- Prefilter skip explanation.
- Large/unreadable file statuses.

### PR 2: Minify Content-View Metadata

Add metadata to content views while keeping default string APIs stable.

Scope:

- Add a detailed minify/content-view API.
- Return strategy, status, line-map guarantee, warnings, size/fallback reason,
  and omitted region placeholders.
- Avoid full source-map work until there is a consumer, but never overclaim
  mapping precision.

Tests:

- Oversized content diagnostic.
- Invalid JSON diagnostic.
- Standard/content-view mapping guarantees.
- Anti-growth fallback reporting.
- UTF-8/UTF-16 offset safety.

### PR 3: Detailed LSP Position Resolution

Expose candidate evidence before changing semantic call behavior.

Scope:

- Add detailed resolver output.
- Return selected candidate plus alternatives.
- Report `tree-sitter`, `near-line-scan`, or `whole-file-scan`.
- Report ambiguity and order-hint usage.
- Keep existing resolver calls stable.

Tests:

- Repeated symbol ambiguity.
- Comment/string avoidance.
- Fallback method visibility.
- Non-ASCII offset correctness.
- LSP command validation remains strict.

## Anti-Goals

- Do not build a full LR/GLR parser generator without a concrete engine feature
  that justifies it.
- Do not add duplicate TypeScript parsing, minification, or fuzzy-resolution
  logic beside the Rust owners.
- Do not silently repair malformed source in ways that shift citations.
- Do not make old string APIs carry heavy metadata by default.
- Do not expose parser stack states, cache internals, or other implementation
  artifacts as public contracts.
- Do not treat speed as the only success metric.

## Success Metrics

- **Citation fidelity:** transformed output maps to original lines, or says it
  cannot.
- **Empty-result clarity:** zero matches are separate from skipped,
  unsupported, failed, fallback, stale, or truncated analysis.
- **Anchor accuracy:** detailed LSP resolution selects the intended repeated
  symbol or reports ambiguity.
- **Structural precision:** AST-backed matches remain immune to comments and
  strings, with file-level parse status.
- **Security transparency:** sanitization reports redaction and preserves or
  explains line/offset mapping effects.
- **Token efficiency:** research views reduce context size without causing more
  corrective follow-up reads.
- **Performance guardrail:** existing string-only hot paths remain available
  until metadata paths prove bounded overhead.

## Main Takeaway

The best optimization is architectural before it is algorithmic:
`octocode-engine` should become structure-aware, source-map faithful,
uncertainty-preserving, and snapshot-ready. Once those contracts exist, richer
parsing, compound-document analysis, and incremental reuse can land behind
stable APIs without forcing agents or callers to guess what the engine really
analyzed.
