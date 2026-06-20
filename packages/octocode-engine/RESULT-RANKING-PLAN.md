# Agent Result Ranking Plan

## Goal

Design a deterministic, explainable ranking layer for mixed code-research
results from LSP, structural search, code search, file graph signals,
sanitization metadata, and future context views.

The ranking layer should help agents answer:

- What should I read first?
- What is most likely the edit target?
- Which results are definitions, callsites, tests, configs, docs, or weak
  fallbacks?
- Which results are strong evidence, and which only mean "maybe"?
- Which results should be packed into context without wasting tokens on
  duplicates?

The main principle: rank **evidence bundles**, not raw tool results.

Raw LSP, structural search, and code search scores are not comparable. LSP gives
semantic precision, structural search gives syntax-shape precision, and code
search gives high recall. The ranking layer should normalize, merge, fuse,
rerank, diversify, and explain.

## Prior Art

This design borrows from hybrid retrieval rather than inventing a bespoke score
normalization system.

- Reciprocal Rank Fusion (RRF) combines multiple ranked result lists without
  assuming their raw scores share a scale:
  https://research.google/pubs/reciprocal-rank-fusion-outperforms-condorcet-and-individual-rank-learning-methods/
- Azure AI Search uses RRF to merge multiple ranked result sets in hybrid
  search:
  https://learn.microsoft.com/en-us/azure/search/hybrid-search-ranking
- Elasticsearch documents RRF as a method for combining result sets with
  different relevance indicators:
  https://www.elastic.co/docs/reference/elasticsearch/rest-apis/reciprocal-rank-fusion
- LSP is the right semantic source for IDE-like facts such as definitions,
  references, symbols, and diagnostics:
  https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/
- Sourcegraph's Cody context-retrieval writeups are useful prior art for
  combining codebase search and context retrieval for coding assistants:
  https://sourcegraph.com/blog/how-cody-understands-your-codebase

## Non-Goals

- Do not replace LSP, structural search, or code search.
- Do not make raw scores from different tools directly comparable.
- Do not use an LLM as the first ranking step.
- Do not hide fallback, partial, stale, or unsupported states.
- Do not pack ten near-identical snippets from one file just because they all
  scored well.

## Pipeline

```text
tool results
  -> normalize into EvidenceItem
  -> dedupe and merge into EvidenceBundle
  -> fuse ranks with weighted RRF
  -> rerank by agent usefulness
  -> diversify and budget
  -> return ranked context groups with reasons
```

## Result Shape

### Evidence Item

An evidence item is one normalized hit from one source.

```ts
type EvidenceSource =
  | 'lsp'
  | 'structural'
  | 'codeSearch'
  | 'fileGraph'
  | 'signature'
  | 'contentView'
  | 'recentEdit'
  | 'testSignal'
  | 'diagnostic'

type EvidenceStatus =
  | 'ok'
  | 'partial'
  | 'fallback'
  | 'ambiguous'
  | 'unsupported'
  | 'parserFailed'
  | 'truncated'
  | 'stale'

type EvidenceIntent =
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
  | 'unknown'

interface EvidenceItem {
  id: string
  source: EvidenceSource
  sourceRank: number
  sourceScore?: number
  status: EvidenceStatus
  confidence: 'high' | 'medium' | 'low'
  intent: EvidenceIntent
  path: string
  range?: Range
  symbol?: string
  languageId?: string
  textPreview?: string
  tokenCost?: number
  lineMapGuarantee?: 'exact' | 'range-preserving' | 'line-preserving' | 'none'
  diagnostics?: AnalysisDiagnostic[]
  reasons: string[]
}
```

### Evidence Bundle

An evidence bundle is the unit that agents see and that the ranker sorts.

```ts
interface EvidenceBundle {
  id: string
  target: {
    path: string
    range?: Range
    symbol?: string
    languageId?: string
  }
  primaryIntent: EvidenceIntent
  contributors: EvidenceItem[]
  fusedScore: number
  finalScore: number
  confidence: 'high' | 'medium' | 'low'
  status: EvidenceStatus
  tokenCost: number
  lineMapGuarantee: 'exact' | 'range-preserving' | 'line-preserving' | 'none'
  reasons: string[]
  warnings: string[]
}
```

## Normalization

Each tool keeps its own native output, then maps into `EvidenceItem`.

### LSP

Best at:

- definition
- references
- implementation
- type definition
- call hierarchy
- diagnostics

Default confidence:

- exact LSP definition/reference: high
- candidate returned by detailed resolver with no ambiguity: high
- near-line scan fallback: medium to low
- whole-file scan fallback: low
- stale snapshot: low

Important rule: LSP fallback evidence is not equivalent to LSP semantic
evidence. A line-scan fallback should contribute less than an actual language
server result.

### Structural Search

Best at:

- syntax-shaped patterns
- real callsites not in comments/strings
- declarations and node kinds
- source/sink queries
- config/schema structures

Default confidence:

- parser-backed AST match: high
- parser-backed but file has parse errors: medium
- fallback text match: low
- unsupported extension: no positive evidence, but keep diagnostic evidence

Important rule: structural search should distinguish true zero matches from
unsupported language, invalid query, skipped file, parser failure, and
prefilter skip.

### Code Search

Best at:

- high-recall discovery
- exact string and regex hits
- comments/docs/errors
- names not covered by semantic tools
- fallback when LSP or parser support is missing

Default confidence:

- exact word-boundary hit in code: medium
- exact hit in comments/docs: medium for explain tasks, low for edit targets
- broad regex hit: low to medium
- generated/minified file hit: low unless task explicitly targets generated
  output

Important rule: code search is excellent for recall but should not prove
semantic relationships by itself.

### File Graph and Path Signals

Best at:

- tests near implementation
- package entrypoints
- route/config/schema files
- recently edited files
- central modules

Default confidence:

- same basename test file: medium
- package entrypoint: medium
- config by known filename: medium
- recent edit touched by user: medium to high, depending on task

Important rule: path signals should boost or diversify, not dominate.

## Bundling

Merge evidence items when they likely point at the same useful target.

Bundle keys, in priority order:

1. same path plus overlapping range
2. same path plus same symbol plus nearby range
3. same path plus same top-level declaration
4. same path plus same test/config/doc role

The bundle should keep all contributors. A structural match, exact text hit,
and LSP reference on the same callsite should become one high-confidence bundle
with three reasons, not three separate ranked rows.

## Fusion

Use weighted Reciprocal Rank Fusion as the first score:

```text
fusedScore(bundle) =
  sum over contributors:
    sourceWeight(contributor) / (k + sourceRank(contributor))
```

Suggested defaults:

```text
k = 60

LSP exact semantic result:          1.35
LSP detailed resolver, unambiguous: 1.10
LSP near-line fallback:             0.55
LSP whole-file fallback:            0.35

Structural exact AST match:         1.20
Structural partial AST match:       0.80
Structural fallback text match:     0.40

Code search exact/code hit:         1.00
Code search comment/doc hit:        0.70
Code search broad regex hit:        0.55

Signature/symbol outline:           0.90
File graph/path signal:             0.75
Recent user edit:                   0.85
Test signal:                        0.70
Diagnostic signal:                  0.75
```

Why RRF first:

- It handles incomparable score systems.
- It rewards agreement across tools.
- It is deterministic and cheap.
- It works even when some tools only return ordered lists.

## Agent Rerank

After fusion, apply deterministic task-aware adjustments.

```text
finalScore =
  fusedScore
  + intentFit
  + evidenceConsensus
  + semanticAuthority
  + proximityToSeed
  + editLikelihood
  + testOrRuntimeRelevance
  + recencyBoost
  - redundancyPenalty
  - tokenCostPenalty
  - uncertaintyPenalty
  - generatedFilePenalty
```

### Intent Fit

Rank by what the user is trying to do.

```text
question: "where is X defined?"
  definition > declaration > implementation > reference > code hit

question: "where is X used?"
  reference > callsite > implementation > definition > code hit

question: "fix bug"
  failing/diagnostic area > implementation > tests > callers > docs

question: "explain subsystem"
  entrypoint > public API > central definitions > representative callers >
  tests > docs/config

question: "find security issue"
  structural source/sink > exact risky API > call chain > config > docs
```

### Evidence Consensus

Boost bundles supported by multiple independent evidence types.

```text
LSP + structural + codeSearch: strong boost
LSP + structural: strong boost
structural + codeSearch: medium boost
codeSearch only: small or no boost
fallback only: penalty
```

### Semantic Authority

LSP is authoritative for semantic identity. Structural search is authoritative
for syntax shape. Code search is authoritative only for textual presence.

Examples:

- For "definition of `createSession`", LSP definition beats text hits.
- For "all `eval($X)` calls", structural search beats LSP and text.
- For "error message string", exact code search may beat LSP.

### Proximity To Seed

If the query began from a file, symbol, range, or search hit, boost:

- same file
- same directory
- same package/workspace
- imports/exports connected to seed
- callers/callees of seed
- tests near seed

### Edit Likelihood

For code-editing tasks, boost:

- implementation files over docs
- direct definitions over indirect references
- small focused ranges over huge files
- files already modified by the user
- files with failing diagnostics/tests

For explanation tasks, reduce this boost and favor representative coverage.

### Token Cost

Agents need useful context under budget. Penalize high-cost bundles when they do
not add unique evidence.

```text
tokenCostPenalty = min(0.25, tokenCost / budget * 0.5)
```

Large files can still rank high, but they should be packed as source-faithful
views, signature slices, or line ranges rather than full content.

### Uncertainty

Penalize weak evidence but keep it visible.

```text
ok:             0
partial:       -0.05
ambiguous:     -0.08
fallback:      -0.12
truncated:     -0.12
parserFailed:  -0.18
unsupported:   -0.20
stale:         -0.25
```

Do not drop weak evidence silently. Agents need to know when a source was not
analyzed.

## Diversity and Budgeting

After scoring, build context groups.

```ts
interface RankedEvidenceGroups {
  mustRead: EvidenceBundle[]
  supporting: EvidenceBundle[]
  maybe: EvidenceBundle[]
  weakOrSkipped: EvidenceBundle[]
}
```

Default packing rules:

- Keep at most 2 initial bundles per file unless the file is the confirmed edit
  target.
- Keep at most 1 duplicate symbol cluster unless repeated overloads are
  relevant.
- Prefer one implementation, one test, one config/schema, and one representative
  caller over four nearby text hits.
- Keep weak/skipped diagnostics compact, outside the main context budget.
- Preserve exact line ranges for all displayed snippets.

## Task Profiles

The same bundle can rank differently depending on task.

### Definition Lookup

```text
weights:
  LSP definition high
  structural declaration medium
  signature outline medium
  code search lower

pack:
  definition
  type/interface if different
  direct test or caller only if budget remains
```

### Reference Lookup

```text
weights:
  LSP references high
  structural callsites high
  code search medium

pack:
  representative references by package/file
  avoid many repeated callsites from one file
```

### Edit Planning

```text
weights:
  definition high
  failing diagnostics high
  direct tests high
  callers medium
  docs low

pack:
  likely edit target
  closest tests
  key caller/callee
  config/schema if connected
```

### Architecture Explanation

```text
weights:
  entrypoints high
  public API high
  central definitions high
  representative callers medium
  docs medium
  tests medium

pack:
  breadth over repeated local detail
```

### Security or Bug Pattern Search

```text
weights:
  structural source/sink high
  exact risky API high
  call chain medium
  config medium
  docs low

pack:
  concrete vulnerable-looking callsites
  sanitizer/validator definitions
  tests around risky behavior
```

## Explanation Output

The ranker should return short reasons for every top bundle.

Example:

```text
1. src/auth/session.ts:42-88
   reason: LSP definition, structural function declaration, exact query hit
   intent: likely edit target
   confidence: high

2. tests/auth/session.test.ts:13-64
   reason: same symbol in nearby test path, exact references
   intent: verification target
   confidence: medium

3. src/auth/legacy.ts:9-27
   reason: exact text hit only, generated fallback unavailable
   intent: maybe related
   confidence: low
```

Reasons are not decoration. They are how agents decide whether to trust, ignore,
or follow up.

## API Sketch

```ts
interface RankEvidenceOptions {
  task:
    | 'definition'
    | 'references'
    | 'edit'
    | 'explain'
    | 'security'
    | 'test'
    | 'generic'
  seed?: {
    path?: string
    range?: Range
    symbol?: string
    query?: string
  }
  tokenBudget?: number
  maxBundles?: number
  includeWeak?: boolean
}

interface RankEvidenceResult {
  groups: RankedEvidenceGroups
  allBundles?: EvidenceBundle[]
  diagnostics: AnalysisDiagnostic[]
  scorerVersion: string
}
```

The first implementation can live above individual tools in TypeScript if it
only combines existing outputs, but the normalized evidence types and scoring
logic should eventually move into `octocode-engine` if Rust owns the hot path
and offset/source-map guarantees.

## Implementation Phases

### Phase 1: TypeScript Prototype

Build a deterministic ranker in the caller layer using existing tool results.

Work:

- Normalize LSP, structural search, ripgrep, and file/path signals.
- Bundle by path/range/symbol.
- Add weighted RRF.
- Add simple task profiles.
- Return traceable reasons.

Success:

- No native API changes required.
- Agents receive ranked `mustRead`, `supporting`, `maybe`, and `weakOrSkipped`
  groups.

### Phase 2: Detailed Evidence Inputs

Use the metadata planned in `packages/octocode-engine/OPTIMIZATION-PLAN.md`.

Work:

- Consume structural file statuses and match IDs.
- Consume detailed LSP candidate/ambiguity metadata.
- Consume content-view line-map guarantees.
- Consume sanitizer/redaction diagnostics.

Success:

- Ranking can penalize real fallback and stale states instead of guessing from
  strings.

### Phase 3: Native Evidence Bundle Support

Move stable evidence normalization into Rust where it benefits from exact offset
handling and shared structs.

Work:

- Add NAPI-safe evidence structs.
- Add bundle IDs from path/range/symbol/content hash.
- Reuse UTF-8/UTF-16 and line-map utilities.
- Keep TypeScript responsible for UI/tool response shaping.

Success:

- Ranking has stable IDs and source-map-safe ranges.

### Phase 4: Evaluation and Tuning

Add ranking evals beside existing benchmarks.

Fixtures:

- repeated symbol names
- definition plus many references
- structural sink/source queries
- same symbol in code, docs, comments, and tests
- parser failure with text fallback
- generated files
- large file plus exact small slice

Metrics:

- intended target in top 1, top 3, top 5
- duplicate rate in packed context
- token cost per useful result
- fallback transparency
- citation range correctness
- agent follow-up reads needed

Success:

- Ranking improves target discovery without increasing context noise.

## Failure Modes

- **LSP overtrust:** semantic tools win even when task is syntax-pattern search.
  Fix with task profiles and source weights.
- **Code search flood:** exact string hits dominate because there are many of
  them. Fix with bundling, per-file caps, and diversity.
- **Silent fallback:** weak scans appear as strong evidence. Fix with status and
  uncertainty penalties.
- **Token-heavy winners:** huge files rank high and blow context budget. Fix
  with content views, range slicing, and token cost penalties.
- **Unstable ties:** equivalent bundles reorder run to run. Fix with stable tie
  breakers: final score, confidence, path, start line, ID.
- **Duplicate context:** callsites from one file crowd out tests/config. Fix
  with intent-aware diversity.

## Default Tie Breakers

When scores are equal or nearly equal:

1. higher confidence
2. fewer uncertainty states
3. stronger line-map guarantee
4. lower token cost
5. closer to seed path/range
6. non-generated before generated
7. path lexical order
8. start line
9. stable bundle ID

## Main Takeaway

The best result sort for agents is not "LSP first" or "search score first." It
is a small evidence-fusion system:

```text
semantic precision + syntax precision + lexical recall + task intent +
diversity + token budget + explicit uncertainty
```

Start with deterministic weighted RRF plus task-aware reranking. Add richer
metadata and native bundle support only after the first evals show where the
ranker is wrong.
