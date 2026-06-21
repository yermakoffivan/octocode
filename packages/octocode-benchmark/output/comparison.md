# Octocode vs ast-grep Structural Grep Comparison

Recorded: 2026-06-20 16:39:47 IDT

## Benchmark Matrix

This is the README-sized benchmark view: what was measured, who wins, and why.
Bars show relative throughput. Higher is better; lower `ms` is better.

What we tested: ast-grep CLI and Octocode structural grep on the same real
repository files, using the same broad AST node-kind searches
(`call_expression`, `call`, `method_invocation`). The goal was to check
structural AST grep compatibility by match count, then measure where time is
spent across Octocode's raw matcher, agent tool path, and public CLI.

This benchmark does not test text grep, LSP navigation, rewriting, or the full
ast-grep rule language. Those are separate capabilities.

```text
Octocode raw native  ████████████████████    5.0 ms median  │  3.0x faster  │  6/6 matched
ast-grep CLI         ███████░░░░░░░░░░░░░   15.1 ms median  │  baseline     │  6/6 matched
```

`Octocode raw native` means the direct Rust/NAPI `structuralSearchFiles`
matcher: parse and match only, with no tool validation, sanitizer, pagination,
JSON shaping, or Node CLI startup.

This is not the formal upstream ast-grep benchmark. Upstream's
[benchmark](https://github.com/ast-grep/ast-grep/blob/main/benchmarks/outline-benchmark.md)
evaluates `ast-grep outline` as an agent exploration tool using real
`claude -p` runs. This Octocode benchmark reuses ast-grep's
[outline scenario list](https://github.com/ast-grep/ast-grep/blob/main/benchmarks/outline-agent-scenarios.json)
as a deterministic same-corpus structural grep comparison.

| Benchmark lane | What it includes | Median timing | vs ast-grep CLI | Winner / DX take |
| --- | --- | ---: | ---: | --- |
| ast-grep CLI | External Rust CLI baseline | 13.6-17.1ms | 1.0x | Fast standalone structural grep |
| Octocode raw native | Direct `structuralSearchFiles` matcher | 4.0-6.6ms | 2.4x-4.1x faster | Fastest matcher path |
| Octocode localSearchCode tool | Validation, sanitization, pagination, hints, result shaping | 91.6ms-3.32s | 5.6x-210.7x slower | Agent-safe result path |
| Octocode grep CLI | Public CLI, Node startup, tool wrappers, JSON output | 1.62s-4.98s | 98.8x-316.2x slower | Human CLI path; startup dominates |

Correctness and scope:

Plain English: we took ast-grep's benchmark scenario repo list, picked one
deterministic file from each supported repo, asked both tools to find the same
AST node kind in that file, verified identical match counts, then timed the
median run.

| Benchmark size / coverage | Result |
| --- | --- |
| Benchmark type | Same-corpus structural grep timing and match-count parity |
| ast-grep parts reused | Only the upstream [outline scenario list](https://github.com/ast-grep/ast-grep/blob/main/benchmarks/outline-agent-scenarios.json): VS Code, Excalidraw, Django, Tokio, OkHttp, Gin |
| ast-grep parts not reused | The upstream [`outline_claude_benchmark.py`](https://github.com/ast-grep/ast-grep/blob/main/benchmarks/outline_claude_benchmark.py) runner, Claude calls, outline scoring, and agent-answer rubric |
| Query shape checked | Broad AST node-kind searches: `call_expression`, `call`, and `method_invocation` |
| Structural match parity | 6/6 supported scenarios matched |
| Count differences | 0 |
| Errors | 0 |
| Skipped | 1, Swift/Alamofire, because Octocode structural grep does not support Swift yet |
| Internal suite | 143 extensions, 19 AST grammars, 18 LSP checks, 141 minify samples |
| Full output | https://github.com/bgauryy/octocode/blob/main/packages/octocode-benchmark/output/ |

Per-scenario timing matrix:

| Scenario | ast-grep CLI | Octocode raw native | Raw vs ast-grep | localSearchCode tool | octocode grep CLI | Result |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| VS Code | 16.4ms | 4.0ms | 4.1x faster | 91.6ms | 1620.4ms | MATCH |
| Excalidraw | 14.4ms | 5.0ms | 2.9x faster | 656.5ms | 2317.7ms | MATCH |
| Django | 13.6ms | 4.9ms | 2.8x faster | 616.1ms | 2320.0ms | MATCH |
| Tokio | 15.8ms | 6.6ms | 2.4x faster | 3320.3ms | 4982.0ms | MATCH |
| OkHttp | 17.1ms | 5.0ms | 3.4x faster | 727.5ms | 2314.3ms | MATCH |
| Gin | 13.9ms | 5.6ms | 2.5x faster | 1393.9ms | 3007.4ms | MATCH |

Bottom line: Octocode's matcher is fast; the slow DX paths are the safe
agent/public-CLI layers around the matcher.

## Versions And Inputs

| Item | Value |
| --- | --- |
| ast-grep | `ast-grep 0.43.0` |
| Octocode CLI | `octocode v1.0.0` |
| Node used for benchmark | `/tmp/octocode-node-v24.17.0/bin/node` |
| ast-grep binary used | `/tmp/octocode-ast-grep-cli-check/bin/ast-grep` |
| Upstream source | `ast-grep/ast-grep` |
| Upstream source commit | `0af4b77cb07366a52f72180b2c850f64e9f6e455` |
| Upstream source path | `benchmarks/outline-agent-scenarios.json` |
| Scenario repo cache | `packages/octocode-benchmark/target/ast-grep-upstream/repos` |
| Result artifact | `packages/octocode-benchmark/target/ast-grep-upstream/latest.json` |
| Files per scenario | 1 |
| Max file bytes | 350000 |
| Warmups | 1 |
| Measured repeats | 3 |

In this Codex desktop environment, the bundled Codex Node binary could not load
the native addon cleanly, so the benchmark was executed with the temporary
official Node binary shown above. Normal local runs can use the repo's standard
Node as long as it can load `@octocodeai/octocode-engine`.

## What Was Checked

The internal benchmark suite checked:

| Check | Scope | Result |
| --- | --- | --- |
| Support matrix | 143 extensions | PASS |
| AST | 19 grammars, 38 declared structural extensions | PASS |
| LSP | 18 language checks | PASS |
| Minify | 141 samples | PASS |

The structural comparison checked four lanes for every supported upstream
scenario:

| Lane | What It Measures |
| --- | --- |
| `ast-grep CLI` | External ast-grep Rust CLI baseline |
| `octocode raw native` | Direct `structuralSearchFiles` native matcher path |
| `octocode localSearchCode tool` | Direct tool path, including path/security validation, sanitization, pagination, hints, and result shaping |
| `octocode grep CLI` | Public CLI path, including Node startup, CLI routing, native addon load, tool wrappers, result shaping, JSON serialization, and process exit |

## Determinism Controls

- Scenario repos are pinned to exact commits in
  `packages/octocode-benchmark/benchmark/ast-grep/upstream-outline-scenarios.json`.
- File selection uses sorted `git ls-files`.
- Git-tracked hidden path segments are skipped so both public CLIs traverse the
  same kind of corpus by default.
- `--files-per-scenario`, `--max-file-bytes`, `--warmups`, and `--repeats` were
  fixed.
- Each scenario prints a corpus SHA-256 prefix.
- Match counts must stay stable across warmup and measured repeats.
- Timings are still machine/load dependent; match counts and corpus identity are
  the deterministic parts.

## Timing Table

Values are median wall-clock milliseconds after warmup. `warm ms` is the median
warmup duration and is excluded from measured `ms`.

| Scenario | Kind | Files | Hash | Matches | Lane | Warm ms | Measured ms | Min ms | Max ms | Status |
| --- | --- | ---: | --- | ---: | --- | ---: | ---: | ---: | ---: | --- |
| vscode-extension-host | call_expression | 1 | ebc4763c | 0 | ast-grep CLI | 9.2 | 16.4 | 15.7 | 16.6 | MATCH |
| vscode-extension-host | call_expression | 1 | ebc4763c | 0 | octocode raw native | 5.6 | 4.0 | 4.0 | 4.1 | MATCH |
| vscode-extension-host | call_expression | 1 | ebc4763c | 0 | octocode localSearchCode tool | 1494.8 | 91.6 | 90.6 | 92.8 | MATCH |
| vscode-extension-host | call_expression | 1 | ebc4763c | 0 | octocode grep CLI | 1628.2 | 1620.4 | 1611.0 | 1634.3 | MATCH |
| excalidraw-render-update | call_expression | 1 | bd318ee4 | 5 | ast-grep CLI | 21.2 | 14.4 | 14.4 | 15.1 | MATCH |
| excalidraw-render-update | call_expression | 1 | bd318ee4 | 5 | octocode raw native | 5.2 | 5.0 | 4.8 | 5.0 | MATCH |
| excalidraw-render-update | call_expression | 1 | bd318ee4 | 5 | octocode localSearchCode tool | 700.3 | 656.5 | 652.6 | 656.6 | MATCH |
| excalidraw-render-update | call_expression | 1 | bd318ee4 | 5 | octocode grep CLI | 2269.6 | 2317.7 | 2279.3 | 2380.3 | MATCH |
| django-queryset-execution | call | 1 | b63e5279 | 4 | ast-grep CLI | 14.1 | 13.6 | 12.3 | 14.5 | MATCH |
| django-queryset-execution | call | 1 | b63e5279 | 4 | octocode raw native | 5.0 | 4.9 | 4.5 | 5.0 | MATCH |
| django-queryset-execution | call | 1 | b63e5279 | 4 | octocode localSearchCode tool | 628.7 | 616.1 | 614.9 | 621.4 | MATCH |
| django-queryset-execution | call | 1 | b63e5279 | 4 | octocode grep CLI | 2297.2 | 2320.0 | 2242.4 | 2320.0 | MATCH |
| tokio-runtime-scheduling | call_expression | 1 | 6106934b | 80 | ast-grep CLI | 18.9 | 15.8 | 15.5 | 17.0 | MATCH |
| tokio-runtime-scheduling | call_expression | 1 | 6106934b | 80 | octocode raw native | 6.9 | 6.6 | 6.2 | 6.8 | MATCH |
| tokio-runtime-scheduling | call_expression | 1 | 6106934b | 80 | octocode localSearchCode tool | 3343.4 | 3320.3 | 3300.8 | 3384.3 | MATCH |
| tokio-runtime-scheduling | call_expression | 1 | 6106934b | 80 | octocode grep CLI | 4984.5 | 4982.0 | 4971.9 | 4989.7 | MATCH |
| okhttp-interceptor-chain | method_invocation | 1 | 5a8858e1 | 6 | ast-grep CLI | 15.4 | 17.1 | 11.0 | 18.6 | MATCH |
| okhttp-interceptor-chain | method_invocation | 1 | 5a8858e1 | 6 | octocode raw native | 5.3 | 5.0 | 4.7 | 5.1 | MATCH |
| okhttp-interceptor-chain | method_invocation | 1 | 5a8858e1 | 6 | octocode localSearchCode tool | 738.3 | 727.5 | 722.0 | 741.3 | MATCH |
| okhttp-interceptor-chain | method_invocation | 1 | 5a8858e1 | 6 | octocode grep CLI | 2349.7 | 2314.3 | 2298.9 | 2354.6 | MATCH |
| gin-middleware-routing | call_expression | 1 | 96900b7a | 26 | ast-grep CLI | 15.1 | 13.9 | 12.4 | 14.1 | MATCH |
| gin-middleware-routing | call_expression | 1 | 96900b7a | 26 | octocode raw native | 5.7 | 5.6 | 5.0 | 5.6 | MATCH |
| gin-middleware-routing | call_expression | 1 | 96900b7a | 26 | octocode localSearchCode tool | 1432.5 | 1393.9 | 1392.1 | 1407.5 | MATCH |
| gin-middleware-routing | call_expression | 1 | 96900b7a | 26 | octocode grep CLI | 3016.0 | 3007.4 | 3000.1 | 3026.9 | MATCH |

Summary:

- Compared: 6 scenarios
- Match-count differences: 0
- Errors: 0
- Skipped: 1, Swift/Alamofire

## Key Interpretation

The raw native Octocode matcher was faster than ast-grep CLI in this small,
same-corpus run, but that is not a full product-path comparison. The public
Octocode CLI and direct tool lanes intentionally include extra agent-facing
work: validation, sanitizer passes, result shaping, pagination metadata, and
JSON output.

Node warmup was visible:

- VS Code `localSearchCode tool`: 1494.8ms warmup, 91.6ms measured
- Gin `localSearchCode tool`: 1432.5ms warmup, 1393.9ms measured
- Public `octocode grep CLI`: remains around 1.6s to 5.0s because every repeat
  starts a fresh Node process

The high `localSearchCode tool` and `octocode grep CLI` times are therefore not
pure matcher time. Use `octocode raw native` to isolate matcher performance.

## Full-Size Corpus Attempt

Command attempted:

```bash
AST_GREP_BIN=/tmp/octocode-ast-grep-cli-check/bin/ast-grep \
  /tmp/octocode-node-v24.17.0/bin/node \
  packages/octocode-benchmark/benchmark/ast-grep/compare-upstream-scenarios.mjs \
  --sync-repos \
  --warmups 1 \
  --repeats 3
```

This uses the default `--files-per-scenario 80`. The run was stopped after about
12 minutes. A macOS process sample showed the benchmark parent was CPU-bound in
`mask_sensitive_data` regex scanning during `localSearchCode` result shaping,
not in the structural matcher. That means the next optimization target for
large result sets is sanitizer/result shaping in the tool/CLI path.

## How To Run Again

From repo root, install or point to an ast-grep CLI:

```bash
brew install ast-grep
# or:
cargo install ast-grep --locked
```

Run the internal suite:

```bash
node packages/octocode-benchmark/benchmark/run-all.mjs
```

Run the bounded deterministic comparison:

```bash
AST_GREP_BIN="$(command -v ast-grep)" \
  node packages/octocode-benchmark/benchmark/ast-grep/compare-upstream-scenarios.mjs \
  --sync-repos \
  --files-per-scenario 1 \
  --warmups 1 \
  --repeats 3
```

Run one focused scenario:

```bash
AST_GREP_BIN="$(command -v ast-grep)" \
  node packages/octocode-benchmark/benchmark/ast-grep/compare-upstream-scenarios.mjs \
  --sync-repos \
  --scenario gin-middleware-routing \
  --files-per-scenario 1 \
  --warmups 1 \
  --repeats 3
```

Use the larger corpus only when profiling sanitizer/result-shaping cost:

```bash
AST_GREP_BIN="$(command -v ast-grep)" \
  node packages/octocode-benchmark/benchmark/ast-grep/compare-upstream-scenarios.mjs \
  --sync-repos \
  --files-per-scenario 80 \
  --warmups 1 \
  --repeats 3
```

## External References

- ast-grep benchmark folder:
  https://github.com/ast-grep/ast-grep/tree/main/benchmarks
- ast-grep outline benchmark:
  https://github.com/ast-grep/ast-grep/blob/main/benchmarks/outline-benchmark.md
- ast-grep CLI reference:
  https://ast-grep.github.io/reference/cli.html
