# Structural Grep Comparison Recipes

Use these recipes to compare Octocode structural grep against the external
ast-grep CLI and to validate the Node/NAPI benchmark flow. Octocode does not
link ast-grep crates or packages.

## Install ast-grep CLI

Official docs: [ast-grep quick start](https://ast-grep.github.io/guide/quick-start.html)
and [ast-grep GitHub](https://github.com/ast-grep/ast-grep).

Install one of:

```bash
brew install ast-grep
npm install --global @ast-grep/cli
pip install ast-grep-cli
cargo install ast-grep --locked
cargo binstall ast-grep
```

Other official options include MacPorts, Nix, Scoop, and mise.

Verify:

```bash
ast-grep --version
ast-grep --help
```

The binary may also be available as `sg`, but Linux already has an `sg`
command. Prefer `ast-grep` in benchmark docs and scripts. Use `AST_GREP_BIN`
when testing a custom binary:

```bash
AST_GREP_BIN=/path/to/ast-grep yarn workspace @octocodeai/octocode-benchmark ast:compare
```

## Recipe 1: Prove ast-grep is not linked into Octocode

```bash
cargo tree --manifest-path packages/octocode-engine/Cargo.toml --edges normal | rg 'ast-grep|ast_grep'
rg -n 'ast_grep_core|ast_grep_config|ast-grep-core|ast-grep-config' packages/octocode-engine
```

Expected: no output. The only ast-grep integration is the optional external CLI
used from this benchmark package.

## Recipe 2: Try ast-grep CLI directly

Search:

```bash
ast-grep run --pattern 'foo($X)' --json=stream packages/octocode-benchmark/benchmark/ast/samples/typescript-utilitiesPublic.ts
```

Rewrite preview:

```bash
ast-grep run --pattern '$A && $A()' --rewrite '$A?.()' --lang ts path/to/file.ts
```

The CLI reference documents `run`, `scan`, `--pattern`, `--kind`, `--lang`,
`--rewrite`, and `--json=stream`: [Command Line Reference](https://ast-grep.github.io/reference/cli.html).

## Recipe 3: Compare Octocode grep with ast-grep CLI

```bash
yarn workspace @octocodeai/octocode-benchmark ast:compare
```

This runs `benchmark/ast/compare-ast-grep-cli.mjs`, shells out to `ast-grep`,
and compares match text for CLI-compatible structural cases against Octocode's
Node-facing `structuralSearch`.

## Recipe 4: Compare on ast-grep's upstream benchmark scenarios

ast-grep has an upstream `benchmarks/` directory. As of the imported scenario
snapshot, its public benchmark is an agent/outline benchmark: it runs real
`claude -p` sessions with and without `ast-grep outline` over repositories such
as VS Code, Excalidraw, Django, Tokio, OkHttp, Gin, and Alamofire.

For Octocode structural grep, use those same repositories as the shared corpus
and compare the two CLIs directly:

```bash
yarn workspace octocode build:dev
yarn workspace @octocodeai/octocode-benchmark ast:compare:upstream -- --sync-repos --scenario gin-middleware-routing
```

Run every Octocode-supported upstream scenario:

```bash
yarn workspace @octocodeai/octocode-benchmark ast:compare:upstream -- --sync-repos
```

The same runner is also available under the explicit layer-benchmark alias:

```bash
yarn workspace @octocodeai/octocode-benchmark ast:compare:layers -- --sync-repos --scenario gin-middleware-routing --files-per-scenario 1 --repeats 3
```

The runner uses
`benchmark/ast-grep/upstream-outline-scenarios.json`, builds a deterministic
temporary corpus from the same scenario repo files, then runs both tools against
that same corpus. Determinism guards:

- scenario repositories are pinned to exact commits in the manifest
- files are selected by sorted `git ls-files`
- `--files-per-scenario`, `--max-file-bytes`, and `--repeats` are fixed inputs
- the output includes a corpus SHA-256 prefix
- match counts must stay stable across repeats

```bash
ast-grep run --json=stream --kind <kind> <temp-corpus>
octocode grep <temp-corpus> --rule 'rule:\n  kind: <kind>\n' --type <ext> --json
```

It reports four timing lanes:

- `ast-grep CLI`: external Rust CLI baseline.
- `octocode raw native`: direct `structuralSearchFiles` through the native addon.
- `octocode localSearchCode tool`: direct tool path, including path/security validation, result shaping, pagination metadata, hints, and sanitization.
- `octocode grep CLI`: public CLI path, including Node process startup, CLI routing, native addon load, tool wrappers, result shaping, JSON serialization, and process exit.

Swift/Alamofire is recorded but skipped until Octocode structural grep supports
Swift. Use `--strict` when a CI job should fail on match-count differences.
Displayed timings are median wall-clock milliseconds over the fixed repeat
count, so counts and corpus identity are deterministic while timings remain
machine/load dependent.

## Recipe 5: Validate Node/NAPI structural grep

```bash
yarn workspace @octocodeai/octocode-engine build:dev
yarn workspace @octocodeai/octocode-benchmark ast:check
```

This does not invoke ast-grep. It validates the shipped Node-facing engine over
real AST samples, grammar coverage, canonical patterns, and signatures.

## Recipe 6: Run the full benchmark package

```bash
yarn workspace @octocodeai/octocode-engine build:dev
yarn workspace @octocodeai/octocode-benchmark benchmark
```

This runs AST, LSP wiring, minify, and support-matrix checks from the private
benchmark package.

## Adding a Comparison Case

1. Add or update a real sample under `benchmark/ast/samples/`.
2. Record provenance in `benchmark/ast/manifest.json`.
3. Add the Node-facing grammar/pattern check in `benchmark/ast/check-ast.mjs`.
4. Add a CLI-compatible case in `benchmark/ast/compare-ast-grep-cli.mjs`.
5. Run `ast:compare`, then `ast:check` after rebuilding the engine.

Keep comparison cases portable: use `ast-grep run --pattern` or `--kind`, avoid
project config, and compare stable match text rather than terminal formatting.
