# Octocode Query Language Implementation Plan

**Status:** implementation plan for the north-star OQL contract.

Authoritative contract:
https://github.com/bgauryy/octocode/blob/main/docs/octocode-language/OCTOCODE_QUERY_LANGUAGE.md

This document explains how to implement OQL without turning it into a second
engine or duplicating command semantics across CLI, MCP, and tools.

## Decision Summary

OQL should ship as a typed query language that compiles into existing Octocode
tool runners. The first release should prioritize planner correctness,
capability diagnostics, materialization safety, and continuation data over a
large new command surface.

Recommended package path:

| Option | Rating | Decision |
|---|---:|---|
| `@octocodeai/octocode-core/oql` export first | 9/10 | Best first step. Keeps schemas/descriptions with the current content source of truth and avoids another publish unit while the contract settles. |
| Standalone `@octocodeai/octocode-query-language` later | 8/10 | Good once OQL has more than one serious consumer or the schema/normalizer becomes too large for `octocode-core`. |
| Put OQL schema/planner in `octocode-tools-core` only | 4/10 | Too easy for CLI/MCP guidance to drift from validation. |
| Put OQL behavior in `octocode` or `octocode-mcp` | 1/10 | Violates the thin-interface rule. |

If a standalone package is created, it must be pure: Zod schemas, TypeScript
types, normalization, short-form expansion, public diagnostics, examples, and
capability type definitions only. It must not import GitHub clients, filesystem
adapters, the native engine, or interface code.

## V1 / V2 / V3 Roadmap

The implementation should move in three deliberate releases. The important
rule: each version must make the planner more trustworthy before it makes the
surface area larger.

### V1: Universal Local + GitHub Code Research

Goal: implement the OQL runner for local and GitHub code research, including
remote-as-local proof when the provider cannot evaluate the predicate.

Scope:

- Canonical grammar: `schema`, `target`, `from`, `scope`, discriminated
  `where.kind`, `materialize`, `fetch`, `select`, `view`, `controls`, result
  pagination, and `explain`.
- Input sugar is accepted only at the edge; `--explain` must show canonical
  OQL.
- Unknown fields fail with `unknownField`.
- `octocode search` accepts one OQL query object through `--query`.
- `octocode search --scheme` prints the OQL schema from core.
- `octocode search --explain` returns normalized query, predicate routing,
  backend decisions, materialization decisions, diagnostics, and continuations.
- Targets: `code`, `content`, `structure`, and `files`.
- Sources: local paths, GitHub repo/path/ref sources, and materialized GitHub
  scopes.
- Matching lanes: local text, fixed string, regex, PCRE2, exact match
  enumeration, path/file predicates, and structural AST.
- Structural V1 uses only `where:{kind:"structural", lang, pattern | rule}`.
  Reusable rule refs and rule decoration fields are V2/V3.
- GitHub lanes: code search/content/tree when pushdown is valid.
- Remote-as-local lane: bounded GitHub repo/path/ref materialization for AST,
  PCRE2, exact local proof, repeatable reads, and provider-gap verification.
- Result envelope: `results`, `pagination`, executable `next.*`,
  `diagnostics`, `provenance`, and `evidence`.
- Diagnostics: unsupported, requires materialization, materialization failed,
  partial, truncated, stale cache, sanitized, parser failed, provider
  unindexed, partial parse, and true zero result.

V1 does not include:

- LSP over remote/materialized sources.
- Repository/package/PR/history/binary/diff targets.
- Quick-command lowering.
- Reusable structural rule registry.
- Rule validation command.
- Budget controls beyond hard safety caps.
- Relationship syntax.
- Fixes or dataflow.

V1 success means agents can use one command for local and GitHub code/content/
structure/files research, and can prove provider-limited searches locally when
the query is bounded.

### V2: Universal Research Surface + Reusable Rules

Goal: expand OQL to the rest of Octocode's research tools while keeping the
same planner/explain/diagnostic model.

Scope:

- LSP remote-as-local: GitHub scopes can materialize, root, and run
  `lspGetSemantics` for `symbols` and `relationships`.
- Targets: `repos`, `packages`, `prs`, `commits`, `binary`,
  `materialization`, and `diff`.
- Existing quick commands lower into OQL internally: `grep`, `cat`, `ls`,
  `find`, `lsp`, `repo`, `pkg`, `pr`, `history`, `binary`, `unzip`, `clone`,
  and `diff`.
- Reusable structural rules: `structuralRef`, named rule ids, constraints,
  tests, and resolved rule provenance.
- Rule validation: schema validation, language support checks, parse checks,
  AST relational rule validation, and example fixture tests.
- Budget controls: `controls.budget.maxRepos`, `maxCandidates`, `maxBytes`,
  `maxMaterializedBytes`, and `timeoutMs`.
- More diagnostics: `lspUnavailable`, `unsupportedSemanticOperation`,
  `partialWorkspace`, `capabilityDegraded`, `maxDepthReached`,
  `unsupportedLanguage`, archive/binary continuation diagnostics, and
  provider-specific rate/index diagnostics.

V2 success means every current research command and every current MCP research
tool has an OQL lowering path, an OQL explain path, and parity tests against the
legacy runner.

### V3: Fixes And Dataflow

Goal: add rule-driven edits and flow research only where proof strength is
honest and backend support exists.

Scope:

- Dry-run fixes for structural rules: suggested patch text, file/range,
  metavariable provenance, conflicts, and no implicit mutation.
- Dataflow candidate mode: `relation:"mayFlowTo"`, `flowKind:"value" |
  "taint"`, `sources`, `sinks`, `sanitizers`, `propagators`,
  `proof:"candidate"`, trace candidates, and candidate-only diagnostics.
- Real local dataflow proof after engine support exists, starting with bounded
  local/intraprocedural proof.
- Global taint/dataflow only when backed by an engine that can return traces,
  truncation state, dependency/source availability, and proof provenance.

V3 does not allow:

- Reporting `flowsTo` without engine proof.
- Reporting a vulnerability solely from `proof:"candidate"`.
- Mutating files from a search command without an explicit future edit/apply
  surface.

V3 success means OQL can be used for safe codemod planning and flow-oriented
security research without misleading agents about confidence.

## Layer Ownership

| Layer | OQL Responsibility |
|---|---|
| `@octocodeai/octocode-core` | Public OQL schema, descriptions, command/tool text, examples, and exported types. If split later, re-export `@octocodeai/octocode-query-language`. |
| `packages/octocode-tools-core` | OQL planner, capability registry, legacy-tool adapters, execution routing, materialization lane, result envelope, and provenance. |
| `packages/octocode-engine` | Native primitives only: ripgrep, structural AST, minify/content views, LSP anchoring, binary/archive inspection, secret/path-safe primitives. |
| `packages/octocode` | Thin CLI parsing/rendering. `octocode search` accepts OQL in V1; quick commands lower to OQL in V2. |
| `packages/octocode-mcp` | Thin MCP registration. It exposes OQL schemas loaded from core and delegates execution to tools-core. |
| `packages/octocode-vscode` | Consumer only. It should call the same CLI/MCP surfaces, not own OQL logic. |

Dependency rule:

```text
interfaces -> tools-core -> core/oql contract + engine primitives
```

The contract package can be depended on by `octocode-core` and
`octocode-tools-core`, but it must not depend on either interface package.

## Prerequisites

Before implementing behavior:

1. Keep `OCTOCODE_QUERY_LANGUAGE.md` as the only north-star language contract.
2. Add an OQL schema export in `octocode-core`, or create a pure
   `@octocodeai/octocode-query-language` package and re-export it from core.
3. Add fixture examples for every V1 target first: `code`, `content`,
   `structure`, and `files`; add V2/V3 fixtures before implementing their
   targets.
4. Add a schema-test suite that parses every documented example.
5. Add an eval row in `docs/OCTOCODE_EVALS.md` for OQL schema, planner,
   materialization, and `octocode search`.
6. Keep existing raw tools and quick commands working while OQL is opt-in.

## Implementation Phases

### 0. Contract Freeze

Goal: make docs implementable.

Tasks:

- Keep `OCTOCODE_QUERY_LANGUAGE.md` focused on language semantics.
- Keep this plan focused on sequencing, ownership, risks, and tests.
- Remove deprecated current-behavior docs that duplicate live schemas.
- Ensure all docs use absolute GitHub URLs.

Done when:

- `README.md` points only to the north-star contract and this plan.
- No runtime code points agents at stale docs; live schema guidance points to
  `tools <name> --scheme`.

### 1. OQL Schema And Normalizer

Goal: validate and normalize OQL before planning.

Tasks:

- Define `OctocodeQuery`, `QueryTarget`, `QuerySource`, `QueryPredicate`,
  `FetchInstructions`, `MaterializePolicy`, `QueryView`, diagnostics, and result
  continuation types.
- Make `QueryPredicate` a discriminated union. Every predicate leaf must have
  `kind`.
- Add `QueryScope`; path/language/include/exclude constraints normalize there,
  not into `controls`.
- Add strict parsing: unknown fields fail, ambiguous sugar fails, and V2/V3
  fields fail in the V1 schema unless explicitly behind a version gate.
- Normalize short forms:
  - `repo: "owner/name"` -> GitHub source object.
  - GitHub `path` -> `scope.path`.
  - local-only `path` -> `from:{kind:"local",path}`.
  - `materialize: "auto"` -> full materialization policy.
  - top-level `text`, `regex`, `pattern`, and `rule` -> canonical
    `where.kind` predicates.
- Reject impossible states early:
  - `pattern` with `rule`.
  - local-only predicates with `materialize:"never"` over external sources.
  - V2/V3 targets in the V1 schema.
  - unbounded materialization.
- Preserve bulk support rules: one OQL call can contain one query or a bounded
  batch if/when the public schema adds batch input. Current raw tool batches are
  limited to 1-5 queries per tool call.

Tests:

- Every example in `OCTOCODE_QUERY_LANGUAGE.md` parses.
- Invalid mixed predicates fail with repair diagnostics.
- Normalization snapshots are stable.
- `--explain` snapshots show canonical `scope`, `where.kind`, defaults, and
  materialization policy.

### 2. Capability Registry

Goal: make backend limits explicit and testable.

Tasks:

- Model capability by source kind, target, predicate, fetch mode, and view.
- Encode current backends:
  - local tools and engine primitives
  - GitHub search/content/tree/clone
  - materialized local paths
- Distinguish provider pushdown, local residual filtering, route-to-materialized,
  and unsupported combinations.
- Include known caveats: GitHub indexing gaps, structural locality,
  materialization bounds, and minify/content-view limits.

Tests:

- Capability snapshots for every target/source pair.
- Unsupported source/predicate pairs produce typed diagnostics.

### 3. Planner

Goal: convert normalized OQL into a deterministic plan.

Planner modes:

| Mode | Meaning |
|---|---|
| `PUSHDOWN` | Backend can evaluate directly. |
| `RESIDUAL` | Fetch bounded candidates and filter locally. |
| `ROUTE` | Route to another lane, usually materialization. |
| `UNSUPPORTED` | Fail with diagnostics and repair hints. |

Invariant:

```text
pushed predicates + residual predicates + routed predicates == all predicates
```

Tasks:

- Preserve every predicate in the explanation output.
- Order cheap filters before expensive fetch/materialization.
- Add `explain:true` output that shows normalized query, capability decisions,
  selected backend, materialization, residual filters, and diagnostics.
- Treat diagnostics as first-class output, not prose hints.

Tests:

- Local text -> `localSearchCode`.
- Local AST -> `localSearchCode mode:"structural"`.
- GitHub text -> provider pushdown when enough.
- GitHub AST + `materialize:"auto"` -> `ROUTE`.
- GitHub AST + `materialize:"never"` -> `UNSUPPORTED`.
- Mixed path/text/AST plans preserve all predicates.

### 4. Execution Adapters

Goal: compile OQL plans into current tools without changing engine semantics.

Adapters:

| OQL Target | Primary Adapter | Version |
|---|---|---|
| `code` | `localSearchCode` or `ghSearchCode` | V1 |
| `content` | `localGetFileContent`, `ghGetFileContent` | V1 |
| `structure` | `localViewStructure`, `ghViewRepoStructure` | V1 |
| `files` | `localFindFiles`, path search/tree info | V1 |
| `symbols` | signature outlines or `lspGetSemantics documentSymbols` | V2 |
| `relationships` | `lspGetSemantics`, derived syntax/semantic edges | V2 |
| `binary` | `localBinaryInspect` | V2 |
| `diff` | bounded content fetch plus diff renderer | V2 |
| `repos` | `ghSearchRepos` | V2 |
| `packages` | `npmSearch` | V2 |
| `prs` / `commits` | `ghHistoryResearch` | V2 |
| `materialization` | `ghCloneRepo`, cache fetch, archive unpack | V1 for GitHub code/content/tree, V2 for artifacts/binary/LSP |

Tasks:

- Keep adapter functions in tools-core.
- Do not call CLI commands from the planner.
- Support legacy raw tool inputs beside OQL until parity is proven.
- Return typed provenance for every backend call.

Tests:

- V1 parity: local text, local regex/PCRE2, local structural, local content,
  local tree/files, GitHub code, GitHub content, GitHub tree, and GitHub
  remote-as-local proof.
- V2 parity: npm package lookup, repo search, LSP symbols/relationships, binary
  strings, archive continuation, PR detail slices, commit/history slices, and
  diff output.

### 5. Materialization Lane

Goal: make external-to-local routing safe and reusable.

Tasks:

- Move remote-as-local behavior into tools-core, not CLI.
- Require bounded repo/path/ref scopes.
- Support `mode:"never" | "auto" | "required"`.
- Return `localPath`, `repoRoot`, source, ref, cache status, refresh hints, and
  local follow-up handles.
- V1: route AST, PCRE2, exact match enumeration, content proof, and repeated
  local proof work through this lane.
- V2: add LSP, binary/artifact inspection, package source handoff, PR/history
  file proof, and diff inputs through the same lane.

Gotchas:

- Never clone broad org/user scopes.
- Do not treat provider zero results as proof when materialized search is the
  reliable route.
- Keep cache state visible so agents know when to refresh.

### 6. Result Envelope

Goal: every OQL result tells agents what to do next without prose parsing.

Required fields:

- `results`
- `pagination`
- `next`
- `diagnostics`
- `provenance`
- `evidence`

Diagnostics must distinguish:

- `zeroMatches`
- `unsupportedPredicate`
- `requiresMaterialization`
- `materializationFailed`
- `partialResult`
- `contentTruncated`
- `matchTruncated`
- `parserFailed`
- `lspUnavailable`
- `unsupportedSemanticOperation`
- `rateLimited`
- `staleCache`
- `sanitized`
- `providerUnindexed`
- `partialWorkspace`
- `capabilityDegraded`
- `partialParse`
- `unsupportedLanguage`
- `candidateOnly`
- `dataflowBackendUnavailable`
- `pathTruncated`

Pagination domains must stay separate: result pages, match pages, char offsets,
archive entry pages, binary scan offsets, PR file/comment/commit pages.

### 7. Public Surfaces

Goal: expose OQL without making CLI/MCP own logic.

CLI:

- Add `octocode search --query '<json>'`.
- Add `octocode search --scheme`.
- Add `octocode search --explain`.
- V1 keeps existing quick commands on their current implementation.
- V2 lowers `grep`, `ls`, `cat`, `find`, `lsp`, `repo`, `pkg`, `pr`,
  `history`, `binary`, `unzip`, `clone`, `diff`, and `cache fetch` into OQL
  internally after parity gates pass.

MCP:

- Add an OQL tool only after the schema is in core.
- Keep legacy tools available until the OQL parity gates pass.
- Serve the same schema and descriptions as CLI.

Raw tools:

- Keep `tools <name> --queries` as a compatibility and debugging runner.
- Document that raw tool batches are per-tool and currently capped at five
  queries.

### 8. Package Split Checkpoint

Start with `@octocodeai/octocode-core/oql` unless the implementation hits one of
these thresholds:

- tools-core needs OQL schemas but not the rest of core content;
- VS Code or another external consumer needs OQL validation without CLI/MCP;
- OQL examples, fixtures, normalizer, and diagnostics exceed a comfortable core
  submodule size;
- independent versioning for the language becomes useful.

Then split to:

```text
@octocodeai/octocode-query-language
  schemas/
  normalize/
  diagnostics/
  examples/
  fixtures/
  types/
```

Allowed dependencies: `zod` and tiny pure utilities.

Forbidden dependencies: Octokit, MCP SDK, filesystem execution, native engine,
CLI renderer, provider clients, cache implementations.

### 9. V2 Structural Rules And Budgets

Goal: make structural search reusable and safe for broad agent workflows.

Tasks:

- Add reusable structural rule references that resolve to canonical V1
  `where:{kind:"structural", lang, pattern | rule}`.
- Add `structuralRef` resolution from local/project/package rule registries.
- Add `octocode search --validate-rule` or an equivalent validation surface.
- Validate `lang`, file extensions, parser availability, rule shape, relational
  `stopBy`, metavariable constraints, and examples before execution.
- Add `controls.budget` across provider, local, materialization, binary, and
  semantic plans.

Tests:

- Rule examples parse and fail with repairable diagnostics.
- `structuralRef` snapshots include resolved rule identity.
- Budget caps produce continuations or typed truncation diagnostics, not silent
  loss.

### 10. V3 Fixes And Dataflow

Goal: support codemod planning and flow research without overstating proof.

Tasks:

- Add dry-run structural fixes with proposed ranges, replacement text,
  conflicts, and metavariable provenance.
- Add candidate dataflow planning for `mayFlowTo`, `flowKind`, sources, sinks,
  sanitizers, and propagators.
- Add diagnostics for `candidateOnly`, `zeroSources`, `zeroSinks`,
  `sourcesTruncated`, `sinksTruncated`, `pathTruncated`,
  `interproceduralDegraded`, `dynamicDispatchApproximation`,
  `aliasingApproximation`, `dependencySourceUnavailable`,
  `sanitizerAmbiguous`, `propagatorUnsupported`, and `noTraceAvailable`.
- Add real local dataflow proof only after `octocode-engine` can provide
  traces.
- Add global dataflow/taint only after the engine can prove cross-file/package
  flows with bounded dependencies and provenance.

Tests:

- Candidate mode never emits `flowsTo`.
- Engine-backed proof includes trace/provenance and truncation state.
- Dry-run fixes do not mutate files.

## Implementation References

- OQL contract:
  https://github.com/bgauryy/octocode/blob/main/docs/octocode-language/OCTOCODE_QUERY_LANGUAGE.md
- CLI reference:
  https://github.com/bgauryy/octocode/blob/main/docs/cli/REFERENCE.md
- MCP clone workflow:
  https://github.com/bgauryy/octocode/blob/main/docs/mcp/CLONE_WORKFLOW.md
- Local tools:
  https://github.com/bgauryy/octocode/blob/main/docs/mcp/tools/LOCAL_TOOLS.md
- LSP tools:
  https://github.com/bgauryy/octocode/blob/main/docs/mcp/tools/LSP_TOOLS.md
- Binary tools:
  https://github.com/bgauryy/octocode/blob/main/docs/mcp/tools/BINARY_TOOLS.md
- GitHub tools:
  https://github.com/bgauryy/octocode/blob/main/docs/mcp/tools/GITHUB_TOOLS.md
- Tool behavior:
  https://github.com/bgauryy/octocode/blob/main/docs/mcp/tools/TOOL_BEHAVIOR.md
- Engine support matrix:
  https://github.com/bgauryy/octocode/blob/main/packages/octocode-benchmark/benchmark/SUPPORT.md
- OQL/eval tracking:
  https://github.com/bgauryy/octocode/blob/main/docs/OCTOCODE_EVALS.md

## Gotchas

- OQL must not become string DSL syntax; keep it a typed object.
- `view` controls output density only; it must not select the search engine.
- `select` is projection, not a hidden fetch-all instruction.
- No predicate may disappear during planning.
- Provider filters are not proof unless the provider can actually evaluate them.
- GitHub code search can be unindexed or incomplete; diagnostics must say so.
- AST and LSP are different: AST proves syntax shape, LSP proves semantic
  relationships.
- LSP availability is runtime-dependent and must not be treated as absence.
- Materialization must be bounded and explicit.
- `proof:"candidate"` is not proof of a bug or correctness property.
- Fix fields are not part of V1 or V2 execution. V3 may return dry-run patches
  only through an explicit edit/apply surface.
- Budget exhaustion must be visible as diagnostics/continuations.
- Secret sanitization and path validation contracts must survive every adapter.
- Current command schemas remain the live compatibility contract until OQL
  parity tests pass.

## Verification Plan

Minimum required gates:

1. Schema examples: every example in the V1 contract parses.
2. Planner snapshots: every active target/source/predicate family has expected
   routing.
3. V1 legacy parity: local text, regex, PCRE2, structural, content, files,
   tree, GitHub code, GitHub content, GitHub tree, and GitHub remote-as-local
   proof match current tools.
4. V2 legacy parity: LSP, repo search, npm search, PR/history, binary/archive,
   diff, materialization, and quick-command lowering match current tools.
5. V3 proof parity: dry-run fixes never mutate files; candidate dataflow never
   emits engine-proof relations; engine-backed dataflow includes trace and
   truncation state.
6. Materialization safety: bounded route works; unbounded route fails.
7. Pagination: every pagination domain returns a typed continuation.
8. Diagnostics: unsupported, empty, partial, stale, sanitized, parser-failed,
   LSP-unavailable, candidate-only, backend-unavailable, and rate-limited
   states are distinct.
9. CLI/MCP parity: same OQL schema and behavior from both surfaces.
10. Eval coverage: `docs/OCTOCODE_EVALS.md` covers OQL schema, normalizer,
    planner,
    materialization, `octocode search`, quick-command lowering, raw-tool
    compatibility, structural rules, budgets, fixes, and dataflow.

## Minimum Viable Release

The first useful OQL release is:

1. `octocode search --query`, `--scheme`, and `--explain`.
2. Canonical `oql/v1` shape with strict unknown-field rejection,
   discriminated `where.kind`, and `scope`.
3. `target:"code"` over local paths for text, fixed string, regex, PCRE2, file
   filters, exact match enumeration, and structural AST search.
4. `target:"content"`, `target:"structure"`, and `target:"files"` over local
   and GitHub sources.
5. GitHub pushdown for valid code/content/tree/file plans.
6. `materialize:"auto"` and `materialize:"required"` for bounded GitHub
   repo/path/ref scopes.
7. Remote-as-local proof for AST, PCRE2, exact matching, repeatable reads, and
   provider-gap verification.
8. Standard result envelope with executable OQL `next.*`, pagination,
   diagnostics, provenance, and evidence.
9. MCP schema exposure from core.
10. Clear unsupported diagnostics for everything not yet implemented.

After V1, add LSP remote-as-local, repository/package discovery, PR/history,
binary/archive, relationships, diff, quick-command lowering, reusable
structural rules, rule validation, and budget controls in V2. Add dry-run
fixes and dataflow in V3.

## Availability Milestones

| Milestone | Version | Available To Users |
|---|---|---|
| Schema only | V1 | `octocode search --scheme`, docs, example validation. |
| Planner explain | V1 | Dry-run routing, capability decisions, diagnostics, and continuations. |
| Local execution | V1 | OQL local code/content/structure/files parity with current tools. |
| GitHub execution | V1 | GitHub code/content/tree/file plans with provider pushdown. |
| Remote-as-local proof | V1 | GitHub repo/path/ref OQL can route to local AST, PCRE2, exact matching, and content proof. |
| MCP OQL schema/tool | V1 | AI assistants get the same OQL schema and execution path for V1 targets. |
| Universal research targets | V2 | OQL handles LSP, repos, packages, PR/history, binary/archive, diff, and materialization. |
| Quick command lowering | V2 | Existing CLI research commands compile to OQL internally. |
| Reusable rule system | V2 | Named structural rules, validation, tests, and budget controls. |
| Dry-run fixes | V3 | Structural rules can propose safe patches without mutation. |
| Candidate dataflow | V3 | OQL can produce `mayFlowTo` candidates with explicit uncertainty. |
| Engine-backed dataflow | V3+ | OQL can report local/global proof only when `octocode-engine` backs it. |

Do not remove legacy quick commands or raw tools until the quick-command lowering
milestone has parity tests.
