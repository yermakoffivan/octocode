# Octocode AST Grep Plan

This document plans the replacement of `ast-grep-core` and `ast-grep-config`
with an Octocode-owned structural search engine.

The target is not to clone every feature from
[ast-grep](https://github.com/ast-grep/ast-grep). The target is to build a
lean, strong, Octocode-native AST grep that preserves the behavior our users
need, supports every grammar we wire into the engine, and can grow to other AST
backends later.

## Goal

Build `octocode-engine`'s own AST grep implementation in phases:

1. Implement it side-by-side with the current ast-grep-backed matcher.
2. Prove compatibility, correctness, performance, and grammar coverage.
3. Route structural search to the Octocode matcher.
4. Only then remove `ast-grep-config` and `ast-grep-core` from `Cargo.toml`.

## Implementation Status

Initial implementation slice is in place:

- `src/structural/octo.rs` implements a private Octocode matcher.
- The default production path uses the Octocode matcher.
- `OCTOCODE_STRUCTURAL_ENGINE=ast-grep` opts into the temporary legacy fallback.
- The Octocode matcher currently supports:
  - document probe: `$$$`
  - single captures: `$X`
  - ignored single captures: `$_`
  - multi captures: `$$$ARGS`
  - HTML tag-name capture: `<$TAG>`
  - JSON/YAML pair capture: `$K: $V`
  - YAML rules with `kind`, `pattern`, `regex`, `has`, `inside`, `all`, `any`,
    `not`, and `stopBy: end`
- Shadow comparison now exists in `src/structural/compare.rs`.
- Canonical side-by-side comparison passes: 11 cases, 17 exact matches.
- Real benchmark side-by-side comparison passes: 19 files, 6,367 exact matches.
- Rust verification passes in both default Octocode mode and legacy ast-grep
  fallback mode.
- `AST-GREP-COMPARISON.md` records current compatibility and removal readiness.
- Native ripgrep fixed-string preselection now runs before AST parsing when a
  safe literal/operator anchor exists.
- Removal is still blocked until the legacy fallback is deleted, NAPI benchmarks
  run against a rebuilt binary, and final dependency cleanup is verified.
- NAPI/Node benchmarks still need a rebuilt/loadable binary before they can
  validate the new matcher through `index.cjs`. In this session,
  `node benchmark/ast/check-ast.mjs` failed because the existing
  `octocode-engine.darwin-arm64.node` could not be loaded due to a macOS
  code-signature Team ID mismatch under the Codex app Node; Yarn/npm/corepack
  were not available to rebuild it.

## Current State

The current structural-search domain lives in `packages/octocode-engine/src/structural/`.

- `mod.rs` owns the public Rust entry points: `supported_extensions`, `search`,
  and `search_files`.
- `types.rs` owns the NAPI-safe result and options structs.
- `files.rs` owns gitignore-aware traversal, candidate grouping, max-file and
  max-byte guards, literal prefiltering, and warning counters.
- `query.rs` owns current query-shape validation and literal-anchor discovery.
- `language.rs` wraps existing `tree_sitter::Language` values so ast-grep can
  parse patterns without linking a second grammar set.
- `matcher.rs` is the main dependency boundary: it uses `ast-grep-core` for
  pattern matching and `ast-grep-config` for YAML rule parsing.

The existing architecture file already assigns AST search to `src/structural/`
and keeps bindings thin. This plan keeps that boundary.

## Replacement Target

Preserve the public behavior of:

- `structuralSearch(content, filePath, pattern, rule)`
- `structuralSearchFiles(options)`
- `getSupportedStructuralExtensions()`
- `localSearchCode` with `mode: "structural"`

The compatibility target is the current Octocode contract, not the full
ast-grep contract.

Compatibility must be measured against:

- Existing Rust tests under `src/structural/`.
- `benchmark/ast/check-ast.mjs`.
- `benchmark/check-matrix.mjs`.
- Node-facing calls through `index.cjs`.
- Real sample files in `benchmark/ast/samples/`.

## Non-Goals

- Do not implement the complete ast-grep rule language.
- Do not import `ast-grep-language`.
- Do not add a second set of tree-sitter grammar crates.
- Do not change the NAPI output structs during the first replacement.
- Do not remove ast-grep crates before the Octocode matcher passes the gates in
  this document.

## Design Principles

1. Single grammar source.
   Use `signatures::languages` as the grammar registry. Adding a new language
   should update one registry and then become available to structural search,
   signatures, and LSP where applicable.

2. Thin FFI.
   `src/bindings/` should keep calling `structural::search` and
   `structural::search_files`. The implementation belongs in `src/structural/`.

3. Backend abstraction before cleverness.
   Tree-sitter is the first backend. The matcher should use a small internal
   `SyntaxBackend`/`SyntaxNode` abstraction so future backends, such as OXC for
   JavaScript/TypeScript or another parser for a specific language, can be added
   without rewriting query logic.

4. Octocode subset, explicit errors.
   Support a documented subset. Unknown rule fields should fail clearly instead
   of silently behaving like ast-grep.

5. Deterministic and bounded.
   Traversal order, capture ordering, result ordering, file limits, byte limits,
   and prefilter behavior must be stable.

6. Bench first, replace second.
   Build shadow comparison and performance checks before changing production
   behavior.

## Hybrid Search Strategy: Ripgrep + AST + LSP

The replacement should not be "tree-sitter for everything." Octocode already
has three complementary engines, and AST grep should become the coordinator
between them:

1. Ripgrep is L0 candidate discovery.
   Use it to cheaply narrow files before parsing whenever the query has a safe
   literal anchor. Today `src/structural/files.rs` walks files with the `ignore`
   crate and then uses `content.contains(anchor)`. The next performance step is
   to reuse the native in-process ripgrep engine for anchor preselection so we
   avoid reading/parsing files that cannot match.

2. AST is L1 structural proof.
   Once files are narrowed, parse with the language's tree-sitter grammar and
   run code-shaped pattern/rule matching. This is where patterns like
   `$A && $A()` belong: ripgrep can find `&&`, but only the AST matcher can
   prove the left side and call callee are the same captured node.

3. LSP is L2 semantic enrichment.
   Structural matches already return line numbers that can be used as
   `lspGetSemantics` line hints. Keep LSP out of the hot search loop, but make
   it easy for callers to ask follow-up questions on matched symbols:
   definition, references, callers, callees, hover, implementation, and type
   definition.

4. Rewrite is a later, explicit contract.
   The ast-grep CLI supports `-p pattern -r rewrite`; Octocode should first
   support search parity, then add rewrite as a separate safe API that returns
   preview edits and source ranges. Do not mix write behavior into
   `localSearchCode`.

Pipeline target:

```text
query
  -> parse pattern/rule and extract safe anchors
  -> ripgrep candidate-file preselection when anchors exist
  -> tree-sitter structural match with captures and exact ranges
  -> optional rewrite preview from captured metavars
  -> optional LSP enrichment from match line/symbol anchors
```

For the example pattern:

```text
pattern: $A && $A()
rewrite: $A?.()
```

- Ripgrep anchor: `&&` if no stronger safe literal exists.
- AST proof: repeated capture equality ensures `foo && foo()` matches, while
  `foo && bar()` does not.
- Rewrite preview: replace the matched AST node range with `$A?.()`.
- LSP enrichment: use the `A` capture line/column to resolve definition or
  references when the caller asks for semantic context.

## Language and Implementation Decision

Use Rust for the structural grep core.

Rust is the best fit for this package because it keeps the hottest work in one
native boundary:

- file walking and literal preselection via the same `grep` / `ignore` crates
  that power the in-process ripgrep path
- tree-sitter parsing over the grammar registry already linked into
  `octocode-engine`
- matching, captures, range math, and rewrite preview generation without
  per-node Rust-to-JavaScript FFI calls
- NAPI as a coarse-grained boundary: one request in, one compact result out
- future parallel file processing without changing the TypeScript tool surface

Do not implement the core matcher in TypeScript, Python, or a subprocess CLI
wrapper. They are useful orchestration layers, but they force too many
cross-boundary calls for AST traversal and make structural search harder to
bound, benchmark, and package.

### Best-Practice Sources To Copy

From ripgrep:

- Extract safe literal anchors before doing expensive work.
- Use gitignore-aware walking, include/exclude globs, type filters, hidden-file
  handling, binary detection, and bounded output as first-class search concerns.
- Prefer fixed-string search when anchors are literal.
- Search candidate files in parallel, but keep deterministic result ordering.
- Treat high-match-count queries as a performance risk; fail or warn before
  producing huge responses.

From ast-grep:

- Parse the pattern as code, then match AST to AST.
- Support metavars as structural wildcards, not regex groups:
  `$A`, `$_`, `$$$ARGS`, and repeated-capture equality.
- Support strictness profiles. Start with ast-grep-compatible `smart`, then add
  `ast`, `cst`, and `relaxed` only when tests prove the need.
- Keep rule YAML composable but explicitly scoped to Octocode's subset.
- Add rewrite as a preview/edit engine after search parity, using captured
  metavars and exact source ranges.

From LSP:

- Do not put language-server calls in the hot search loop.
- Use structural matches as anchors for semantic follow-up:
  definition, references, type definition, implementation, hover, callers, and
  callees.
- Treat LSP results as enrichment, not proof that a structural pattern matches.
  LSP availability varies by language and user environment.

### Target Engine Shape

```text
CompiledStructuralQuery
  anchors: AnchorPlan
  languages: Vec<LanguageProfile>
  matcher: PatternMatcher | RuleMatcher
  rewrite: Option<RewriteTemplate>
  semanticHints: Vec<SemanticAnchorHint>
```

```text
search_files(query, root)
  compile query once
  build candidate file set
    if safe anchors exist:
      use ripgrep fixed-string files-only preselection
    else:
      use ignore walker over supported extensions
  group candidates by language profile
  parse + match each candidate in Rust
  emit compact StructuralMatch rows
  optionally emit rewrite preview edits
  expose line/metavar anchors for LSP follow-up
```

### Performance Rules

- Compile the pattern/rule once per language, not per file.
- Parse each candidate file at most once per structural request.
- Avoid allocating child vectors on every candidate node in the hot path; use
  cursors or small stack buffers where possible.
- Add a fast path for `kind`-only rules.
- Add a fast path for single-root pattern matching with a known candidate kind.
- Keep capture maps lazy. `$_` and ignored branches should not allocate maps.
- Reuse byte ranges into source slices during matching; allocate strings only
  when building final NAPI-safe results.
- Add a multi-capture backtracking budget and report a clear diagnostic when a
  pattern is too broad.
- Keep NAPI calls coarse-grained. Never expose per-node traversal to
  TypeScript for normal search.

### Semantic Grep Boundary

"Semantic grep" should mean structural search with optional semantic evidence,
not an always-on LSP query engine.

Supported levels:

1. Text anchor: ripgrep proves a file may contain the required literal.
2. Syntax anchor: AST proves the code shape and metavars.
3. Symbol anchor: tree-sitter/OXC/LSP resolves a matched name to a declaration
   or reference set.
4. Edit anchor: rewrite preview is generated from exact structural match ranges.

This keeps the fast path deterministic and offline, while still letting users
move from "find this shape" to "what symbol is this and who calls it?"

## Proposed Module Layout

Keep the current structural domain, then replace the ast-grep dependency pieces
inside it.

```text
src/structural/
  mod.rs              # public Rust API, unchanged shape
  types.rs            # NAPI-safe public structs, unchanged shape
  files.rs            # traversal/prefilter, mostly unchanged
  query.rs            # query validation, literal anchor, rule parsing entry
  language.rs         # LanguageProfile and backend adapter
  matcher.rs          # compile_matcher facade
  octo/
    mod.rs
    backend.rs        # SyntaxBackend, SyntaxDocument, SyntaxNodeView traits
    tree_sitter.rs    # TreeSitterBackend implementation
    pattern.rs        # code-shaped pattern parser/compiler
    rule.rs           # Octocode YAML rule AST
    match_node.rs     # node matching engine
    match_list.rs     # sibling/list matching, $$$ captures
    captures.rs       # capture env, merge/backtrack logic
    text.rs           # byte/line/column/text helpers
    diagnostics.rs    # precise user-facing compile errors
```

The first implementation can keep `octo/` private. Public Rust entry points
stay as they are.

## Core Abstractions

### LanguageProfile

`LanguageProfile` should replace the ast-grep-specific `AgLanguage`.

Fields:

- `extension`
- `language_id`
- `tree_sitter_language`
- `expando_char`
- `ignored_kinds`
- `anonymous_separator_policy`
- `pattern_root_policy`
- `supports_error_tolerant_parse`

The profile is created from `signatures::languages::LanguageEntry`.

### SyntaxBackend

Initial backend: tree-sitter.

Responsibilities:

- Parse a document.
- Parse a pattern fragment with the language profile's expando behavior.
- Return stable node views with:
  - kind
  - byte range
  - point range
  - text slice
  - named/anonymous marker
  - field name when available
  - parent and children traversal

Future backends can implement the same surface for non-tree-sitter parsers.

### CompiledQuery

`compile_matcher` should produce an internal enum:

```text
CompiledQuery
  Pattern(CompiledPattern)
  Rule(CompiledRule)
  Document
```

`Document` keeps the special `$$$` root-probe behavior.

## Pattern Query Design

Pattern syntax should start with the subset we already expose:

- Literal code fragments, such as `foo($X)`.
- Single-node captures: `$X`.
- Ignored single-node captures: `$_`.
- Multi-node captures: `$$$ARGS`.
- Anonymous multi-node wildcard: `$$$`.
- Literal lowercase `$name` in languages like SCSS must remain literal.

Pattern compilation steps:

1. Validate non-empty pattern text.
2. Preprocess metavar sigils using the same language expando table currently
   used in `language.rs`.
3. Parse the pattern fragment with the target backend.
4. Select the effective pattern root.
5. Convert the pattern tree into a `PatternAst`.
6. Mark metavar nodes and multi-capture positions.
7. Derive a literal anchor for file prefiltering.

### Effective Pattern Root

Tree-sitter usually wraps fragments in a document/program node. The compiler
needs a deterministic rule to find the node that represents the user's pattern.

Planned root policy:

1. If the pattern is exactly `$$$`, compile `Document`.
2. Otherwise, prefer the smallest named node that covers all non-wrapper,
   non-error pattern tokens.
3. If that fails, use the first non-error named child under the document root.
4. If parsing still cannot produce a stable root, return a clear invalid-pattern
   error.

This root selection must be tested per grammar because languages differ in how
they parse fragments.

## Matching Algorithm

The matcher runs the compiled query against every candidate node in document
order.

High-level flow:

```text
parse document
for each searchable node in document order:
  try match_node(pattern_root, candidate, empty_captures)
  if success:
    emit StructuralMatch from candidate and captures
```

### Node Match

A pattern node matches a candidate node when:

- A single metavar captures exactly one candidate node.
- An ignored metavar matches one candidate node without recording it.
- A literal node has the same kind and compatible text/children.
- Named children match according to order and field constraints.
- Anonymous syntax nodes are handled by the profile policy.

### List Match

Multi-captures are the main hard part.

`$$$ARGS` should match zero or more sibling nodes in a list context. For current
compatibility, JavaScript argument lists must preserve the existing capture
shape where separators can appear in the captured list. This means the list
matcher needs a language/profile policy for whether anonymous separator nodes
are captured, ignored, or normalized.

Use backtracking with caps:

- Candidate child count is bounded by the AST node's child list.
- Backtracking should short-circuit on impossible remaining pattern length.
- Add a recursion/backtracking budget to prevent pathological patterns.

### Capture Merge

Capture state must support speculative matching:

- Clone or snapshot on branch.
- Commit only when a full node/list match succeeds.
- If the same capture name appears twice, require textual equality unless a
  later phase explicitly adds "same kind" or "same node" policies.
- Multi-captures preserve ordered text slices.

## Rule Query Design

Rules should be Octocode YAML, not ast-grep YAML compatibility forever.

Initial supported fields:

```yaml
rule:
  kind: call_expression
  pattern: foo($X)
  regex: "foo|bar"
  has:
    kind: identifier
    stopBy: end
  inside:
    kind: function_declaration
    stopBy: end
  all:
    - kind: call_expression
    - pattern: foo($X)
  any:
    - pattern: foo($X)
    - pattern: bar($X)
  not:
    pattern: eval($X)
```

### Rule Semantics

- `kind`: candidate node kind must match.
- `pattern`: candidate must match the compiled code-shaped pattern.
- `regex`: candidate text must match the regex.
- `has`: descendant must match the nested rule.
- `inside`: ancestor must match the nested rule.
- `all`: every nested rule must match the same candidate.
- `any`: at least one nested rule must match.
- `not`: nested rule must not match.
- `stopBy: end`: traverse all ancestors or descendants.

Fields not in the subset should produce:

```text
unsupported structural rule field '<field>'; Octocode AST grep supports: ...
```

### Rule Parser

Use existing `serde_yaml_ng`, not `serde_yaml`.

Implementation shape:

```text
RawRuleDocument
  rule: RawRule

RawRule
  kind: Option<String>
  pattern: Option<String>
  regex: Option<String>
  has: Option<Box<RawRule>>
  inside: Option<Box<RawRule>>
  all: Option<Vec<RawRule>>
  any: Option<Vec<RawRule>>
  not: Option<Box<RawRule>>
  stopBy: Option<StopBy>
```

Compile raw rules into `CompiledRule`, validating:

- non-empty object
- no unknown fields
- no empty `all`/`any`
- valid nested pattern syntax
- valid regex
- known `stopBy` values

## File Search Behavior

Keep `files.rs` mostly intact.

Preserve:

- gitignore-aware traversal through `ignore`
- include overrides
- default excluded directories
- deterministic path sorting
- single-file root behavior
- supported-extension filtering
- max file count
- max file bytes
- unreadable/large/prefilter warning counters

Improve:

- Replace line-based rule anchor extraction with parsed-rule anchor extraction.
- For `all`, use the strongest safe positive anchor.
- For `any` and `not`, use no anchor unless every branch shares the same safe
  literal.

## Language Onboarding

Adding a new tree-sitter language should require:

1. Add the grammar dependency.
2. Add one `LanguageEntry`.
3. Add benchmark sample provenance in `benchmark/ast/manifest.json`.
4. Add a canonical pattern probe in `benchmark/ast/check-ast.mjs`.
5. Add language profile overrides only if the default profile fails.
6. Run the AST and matrix benchmarks.

For non-tree-sitter backends:

1. Implement `SyntaxBackend`.
2. Add a backend selector in `LanguageProfile`.
3. Add equivalent pattern parse and document parse probes.
4. Run the same contract tests.

## Compatibility Gates

Do not switch production structural search to the Octocode matcher until all
gates pass.

### Rust Unit Gates

- Existing `structural::tests` pass unchanged.
- New unit tests cover:
  - `$X`
  - `$_`
  - `$$$`
  - `$$$ARGS`
  - repeated capture names
  - comments and strings do not match code patterns
  - invalid pattern diagnostics
  - invalid rule diagnostics
  - `kind`
  - `pattern`
  - `has`
  - `inside`
  - `all`
  - `any`
  - `not`
  - `stopBy: end`
  - JSON/YAML/TOML structural-only grammars
  - HTML/CSS/SCSS/LESS expando behavior
  - Scala expando behavior

### Node/Benchmark Gates

These must pass through the built NAPI binary:

```bash
node benchmark/ast/check-ast.mjs
node benchmark/check-matrix.mjs
```

When `yarn` is available:

```bash
yarn ast:check
yarn matrix:check
yarn benchmark
```

### Shadow Comparison Gate

Before removal, add a temporary shadow harness:

```text
structural::matcher::compile_matcher_ast_grep
structural::matcher::compile_matcher_octo
```

For each structural test and benchmark probe:

- run both matchers
- compare match count
- compare match ranges
- compare match text
- compare capture names
- compare capture text lists

Allowed differences must be documented in this file before switching.

### Performance Gate

Use representative inputs:

- 2,000 small TypeScript files
- one large TypeScript file near `max_file_bytes`
- JSON/YAML config corpus
- CSS/SCSS corpus
- Rust/Python/Go/Java snippets

Track:

- pattern compile time per language
- parse time per file
- match time per file
- total search time with and without anchor
- allocations if easy to measure

Initial target:

- no more than 20 percent slower than ast-grep on common structural searches
- faster or equal for rule parsing because `ast-grep-config` is removed
- no pathological backtracking on crafted multi-capture patterns

## Rollout Plan

### Phase 0 - Document and Freeze Contract

Deliverables:

- This plan.
- A short structural-search contract section in architecture docs later.
- A list of compatibility tests that define "current behavior".

No implementation changes.

### Phase 1 - Add Octocode Matcher Behind Tests

Deliverables:

- `src/structural/octo/` module.
- Tree-sitter backend.
- Pattern compiler for document probe and simple single-node captures.
- Direct unit tests that do not affect production routing.

Completed. The production path now defaults to the Octocode matcher; ast-grep is
available only through the explicit fallback environment variable.

### Phase 2 - Implement Rule Parser Without Routing

Deliverables:

- `serde_yaml_ng` rule parser.
- `CompiledRule` model.
- Unknown-field diagnostics.
- Anchor derivation from compiled rules.

Still no production routing.

### Phase 3 - Implement Pattern Matching Core

Deliverables:

- node matching
- child-list matching
- capture env
- ignored captures
- multi-captures
- repeated-capture validation
- per-language expando behavior

Run Rust structural tests against the Octocode matcher directly.

### Phase 4 - Implement Relational Rules

Deliverables:

- `kind`
- `pattern`
- `regex`
- `has`
- `inside`
- `all`
- `any`
- `not`
- `stopBy: end`

Add compatibility tests for the rules we actually document.

### Phase 5 - Shadow Compare

Deliverables:

- Temporary comparison harness.
- Compatibility report in test output or benchmark output.
- Documented intentional differences.

Do not remove ast-grep yet.

### Phase 6 - Route Production to Octocode Matcher

Deliverables:

- `compile_matcher` uses Octocode matcher by default.
- Optional temporary environment switch for fallback during testing:
  `OCTOCODE_STRUCTURAL_ENGINE=ast-grep`.
- Existing NAPI functions unchanged.
- Existing localSearchCode behavior unchanged except documented improvements.

### Phase 7 - Remove Dependencies

Only after all gates pass:

- Remove `ast-grep-core` from `Cargo.toml`.
- Remove `ast-grep-config` from `Cargo.toml`.
- Update `Cargo.lock`.
- Update `ARCHITECTURE.md` dependency list.
- Update comments mentioning ast-grep compatibility.
- Run full Rust, Node, benchmark, audit, and pack-size checks.

## Risks and Mitigations

### Risk: Pattern fragment parsing differs by language

Mitigation:

- Keep language profile overrides.
- Add per-grammar canonical probes.
- Fail invalid patterns with clear diagnostics.

### Risk: `$$$ARGS` backtracking becomes slow

Mitigation:

- Use lower/upper bound pruning.
- Add a branch budget.
- Benchmark crafted worst-case patterns.

### Risk: Captures drift from existing output

Mitigation:

- Shadow compare exact capture names and text lists.
- Preserve current public shape until a major contract update.

### Risk: Rule subset surprises ast-grep users

Mitigation:

- Document Octocode-supported rule fields.
- Fail unknown fields loudly.
- Add hints in TypeScript for unsupported rule features.

### Risk: Tree-sitter anonymous nodes differ across grammars

Mitigation:

- Language profile controls separator capture/ignore behavior.
- Tests cover JS commas, CSS declarations, JSON pairs, YAML mappings, and HTML
  tag patterns.

### Risk: Removing ast-grep hides mature edge-case behavior

Mitigation:

- Keep ast-grep available until shadow comparison passes.
- Compare against real benchmark samples.
- Add focused regression tests for every discovered mismatch.

## Verification Checklist Before Full Replacement

- `cargo test --all-targets --all-features`
- `cargo clippy --all-targets --all-features -- -D warnings`
- `cargo audit -D unmaintained -D unsound -D yanked`
- `node benchmark/ast/check-ast.mjs`
- `node benchmark/check-matrix.mjs`
- `node benchmark/run-all.mjs`
- `yarn build:dev` when the local Yarn runtime is available
- `yarn test:node` when the local Yarn runtime is available
- `yarn pack:check` when the local Yarn runtime is available
- binary size comparison before and after dependency removal

## Definition of Done

The Octocode AST grep replacement is done when:

1. `ast-grep-core` and `ast-grep-config` are absent from `Cargo.toml`.
2. `Cargo.lock` has no ast-grep crates.
3. Public NAPI function signatures are unchanged.
4. `localSearchCode mode:"structural"` still returns compatible results.
5. All supported structural extensions still pass live AST benchmarks.
6. Rule support is documented as the Octocode subset.
7. Unknown or unsupported rule fields produce clear errors.
8. Full engine verification passes.
9. Architecture docs describe Octocode AST grep as the owner of structural
   matching.

## First Implementation Task

Do not start by deleting dependencies.

Start by adding the private `src/structural/octo/` module with:

1. Tree-sitter document parse wrapper.
2. `Document` query for `$$$`.
3. Simple `kind` rule matching.
4. Simple `foo($X)` pattern matching for TypeScript and JavaScript.
5. Direct unit tests comparing the new matcher against expected Octocode output.

After that first slice works, expand grammar coverage and only then add shadow
comparison against the ast-grep matcher. This is now complete; keep the shadow
comparison until the ast-grep crates are removed.
