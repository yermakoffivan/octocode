# Octocode AST Grep Comparison

This document compares the Octocode-owned structural matcher against the
current `ast-grep-core` / `ast-grep-config` matcher before dependency removal.

## Decision

Do not remove `ast-grep-core` or `ast-grep-config` yet.

Correctness parity is now strong for the implemented Octocode subset, including
real benchmark files, exact ranges, exact text, and exact captures. The removal
gate is still blocked by dependency cleanup and Node/NAPI benchmark coverage.
The production matcher now defaults to the Octocode implementation while keeping
ast-grep available as an explicit fallback.

## Compared Implementations

- Current matcher: `src/structural/matcher.rs`, backed by `ast-grep-core` and
  `ast-grep-config`.
- Octocode matcher: `src/structural/octo.rs`, backed directly by the
  tree-sitter grammars already linked by `octocode-engine`.
- Shadow harness: `src/structural/compare.rs`.

The production default routes to the Octocode matcher. The ast-grep fallback can
be selected with:

```bash
OCTOCODE_STRUCTURAL_ENGINE=ast-grep
```

## Method

The comparison harness compiles the same query twice:

1. `compile_matcher_ast_grep`
2. `compile_matcher_octo`

Then it runs both matchers against the same content and compares:

- match count
- start/end lines
- start/end columns
- matched text
- capture names
- capture text lists

No normalization is allowed except deterministic map ordering for comparison.
This means synthetic captures such as ast-grep's relational `secondary` capture
must be emitted by the Octocode matcher too.

## Canonical Pattern Results

Latest run:

```text
canonical structural comparison: 11 cases, 17 matches, ast-grep 5.89375ms, octocode 900.959µs
```

Cases covered:

| Case | Extension | Query type | Purpose |
|---|---:|---|---|
| TypeScript call | `ts` | pattern | `foo($X)` single capture |
| JavaScript multi capture | `js` | pattern | `log($$$ARGS)` separator-preserving multi capture |
| JavaScript repeated capture | `js` | pattern | `$A && $A()` guarded call pattern |
| Python expando | `py` | pattern | non-dollar internal expando support |
| Rust expando | `rs` | pattern | non-dollar internal expando support |
| HTML tag capture | `html` | pattern | `<$TAG>` special fragment |
| CSS declaration | `css` | pattern | declaration capture under stylesheet wrapper |
| JSON pair | `json` | pattern | `$K: $V` special fragment |
| YAML pair | `yaml` | pattern | `$K: $V` special fragment |
| Inside rule | `ts` | rule | `inside` with `stopBy: end` and `secondary` capture |
| Composition rule | `ts` | rule | `kind` plus `not` |

Result: pass.

## Real Benchmark Sample Results

Latest run:

```text
real-sample structural comparison: 19 cases, 6367 matches, ast-grep 330.074042ms, octocode 939.791582ms
```

Files covered from `benchmark/ast/samples/`:

| File | Extension | Query |
|---|---:|---|
| `typescript-utilitiesPublic.ts` | `ts` | document root |
| `antd-InternalTable.tsx` | `tsx` | document root |
| `express-application.js` | `js` | `kind: call_expression` |
| `httpx-client.py` | `py` | `kind: call` |
| `go-fmt-print.go` | `go` | `kind: call_expression` |
| `rust-core-option.rs` | `rs` | `kind: call_expression` |
| `spring-StringUtils.java` | `java` | `kind: method_invocation` |
| `git-add.c` | `c` | `kind: call_expression` |
| `llvm-raw_ostream.cpp` | `cpp` | `kind: call_expression` |
| `dotnet-String.cs` | `cs` | `kind: invocation_expression` |
| `nvm.sh` | `sh` | `kind: command` |
| `mdl-dashboard.html` | `html` | `kind: element` |
| `bootstrap-grid.css` | `css` | `kind: rule_set` |
| `bootstrap-variables.scss` | `scss` | `kind: rule_set` |
| `bootstrap-navbar.less` | `less` | `kind: rule_set` |
| `scala-List.scala` | `scala` | `kind: call_expression` |
| `vscode-package.json` | `json` | `kind: pair` |
| `home-assistant-ci.yaml` | `yaml` | `kind: block_mapping_pair` |
| `pip-pyproject.toml` | `toml` | `kind: pair` |

Result: pass.

## Compatibility Findings

The comparison found and fixed real compatibility gaps:

- HTML `<$TAG>` needs special fragment behavior because tree-sitter does not
  expose the same match range as ast-grep for this shorthand.
- CSS patterns need `stylesheet` treated as a pattern wrapper.
- JSON and YAML `$K: $V` need special pair-fragment support because standalone
  pair fragments do not parse cleanly in every grammar.
- Relational rules need ast-grep-compatible `secondary` captures for matched
  `inside` / `has` nodes.

## Agent Flow Comparison

`ast-grep-core` / `ast-grep-config` are strong structural-match dependencies,
but they stop at AST matching and rule parsing. The surrounding agent workflow
still has to be built separately: result shaping, minified source fetches, LSP
follow-up, pagination, and next-step guidance.

The Octocode path now owns that full workflow:

| Capability | ast-grep-core/config path | Octocode structural grep path |
|---|---|---|
| AST pattern/rule matching | Mature and broad | Implemented subset with parity harness |
| Shared grammars | Separate ast-grep language adapter | Reuses engine tree-sitter grammars |
| Ripgrep prefilter | Not part of matcher layer | Native fixed-string/operator prefilter before parse |
| Result shape | Needs adapter | Native `localSearchCode` shape |
| Fetch flow | Needs external orchestration | `next.fetchExact`, `next.fetchStandard`, `next.fetchSymbols` |
| LSP flow | Needs external orchestration | `next.lspDefinition` / `next.lspReferences` when symbol inference is safe |
| Pagination flow | Needs external orchestration | `nextPage` and `nextMatchPage` |
| Dependency weight | Adds `ast-grep-core` and `ast-grep-config` | Removes those after final gate |
| Rule coverage | Broader today | Narrower, controlled subset |
| Debug real-sample performance | Faster today | Slower today; optimization still required |

Conclusion: ast-grep remains a better off-the-shelf matcher today, especially
for broad rule-language compatibility and current debug performance. Octocode is
the better agent workflow engine because it can connect AST matches directly to
source-fetch minification, LSP semantics, pagination, and Octocode's result
contracts. That workflow advantage is why the production default can be
Octocode while removal of the ast-grep crates still waits on performance and
NAPI benchmark gates.

## Performance Finding

The real-sample debug test shows:

```text
ast-grep: 330.074042ms
octocode: 939.791582ms
```

That makes the current Octocode matcher about 2.8x slower in this Rust debug
real-sample comparison. This does not prove release/NAPI performance, and the
canonical pattern comparison is now faster for Octocode in the latest run, but
large kind-only real-file scans still need optimization.

Likely causes:

- The Octocode matcher currently reparses patterns and rules simply.
- `kind` rules still walk through the generic rule path.
- Pattern matching allocates capture maps and child vectors during traversal.
- Real sample kind scans traverse every named node without specialized fast
  paths.

## Removal Gate

`ast-grep-core` and `ast-grep-config` can be removed only after:

- release-mode comparison is measured
- Node/NAPI benchmarks are run through the built binary
- the Octocode matcher is optimized or the performance delta is accepted
- full Rust verification still passes in both default and Octocode-opt-in modes
- `benchmark/ast/check-ast.mjs` and `benchmark/check-matrix.mjs` pass

Current local Node benchmark status:

```text
node benchmark/ast/check-ast.mjs
```

Blocked in this session by macOS native addon loading. The existing
`octocode-engine.darwin-arm64.node` fails `dlopen` under the Codex app Node with
a code-signature Team ID mismatch. Yarn/npm/corepack were not available in this
shell to rebuild the NAPI binary.

Current recommendation: keep Octocode as the production default, keep ast-grep
behind `OCTOCODE_STRUCTURAL_ENGINE=ast-grep` until final dependency removal, and
optimize the native matcher before deleting the ast-grep crates.
