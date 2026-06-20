# Octocode Grep Flow Eval

This eval checks whether Octocode's local grep stack gives an agent enough
signal to move from discovery to source inspection and semantic follow-up.

## Local Runtime Status

Rust/native engine checks run successfully in this session.

The Node/NAPI tool path is blocked in this shell:

```text
node packages/octocode-benchmark/benchmark/ast/check-ast.mjs
```

fails with `ERR_DLOPEN_FAILED` because the existing
`octocode-engine.darwin-arm64.node` has a macOS code-signature Team ID mismatch
under the Codex app Node. Yarn/npm/pnpm/corepack are not available in this
shell, so the addon could not be rebuilt here.

## Commands Run

```bash
cargo test --manifest-path packages/octocode-engine/Cargo.toml structural -- --nocapture
cargo test --manifest-path packages/octocode-engine/Cargo.toml search::ripgrep_search -- --nocapture
cargo test --manifest-path packages/octocode-engine/Cargo.toml search::line_extractor -- --nocapture
cargo test --manifest-path packages/octocode-engine/Cargo.toml lsp::resolver -- --nocapture
cargo test --manifest-path packages/octocode-engine/Cargo.toml minify -- --nocapture
cargo test --manifest-path packages/octocode-engine/Cargo.toml signatures -- --nocapture
```

Results:

| Surface | Result | What It Proves |
|---|---:|---|
| Octocode structural grep | 49 passed | AST patterns/rules, metavars, file search, operator prefilter |
| Native ripgrep text/regex | 19 passed | fixed string, regex, PCRE2, whole word, lang type, include/exclude, gitignore, files-only |
| Fetch-content line extraction | 14 passed | literal/regex matchString, context slices, unicode, max matches |
| LSP resolver anchor | 4 passed | lineHint + tree-sitter symbol anchoring, UTF-16 positions, comment immunity |
| Minification | 46 passed | standard content-view minification and failure containment |
| Symbol skeletons | 31 passed | minify:"symbols" source outlines and semantic boundary offsets |

## CLI Language And Command Path Check

External landscape checked:

- `ripgrep` is the reference text-search design: Rust, line-oriented,
  gitignore-aware, fast cross-platform binary.
  https://github.com/BurntSushi/ripgrep
- `fd` shows the same Rust pattern for modern search-like CLIs: simple UX,
  parallel traversal, ignore-file defaults.
  https://github.com/sharkdp/fd
- `tree-sitter` is the right parser substrate for this layer: general,
  fast enough for editor use, robust on broken code, embeddable runtime.
  https://github.com/tree-sitter/tree-sitter
- `Semgrep` and `Comby` prove the broader semantic/structural grep category,
  but their stacks are less aligned with this repo than the existing Rust
  native engine plus tree-sitter.
  https://github.com/semgrep/semgrep
  https://github.com/comby-tools/comby
- Agent/infra CLIs commonly use Go or Rust for distribution. GitHub CLI is a
  Go-style single CLI, while Codex CLI has also moved toward a native Rust path.
  Octocode's split is still sensible: TypeScript for MCP/agent orchestration,
  Rust for code-search hot paths.
  https://github.com/cli/cli
  https://github.com/openai/codex

Octocode command paths:

| User/Agent Need | Best Command Path | Engine Path | Rating |
|---|---|---|---:|
| cheap text discovery | `octocode grep <keywords> <path> --mode discovery` | `grep.ts` -> `localSearchCode` -> native ripgrep | 9/10 |
| exact regex discovery | `octocode grep <regex> <path> --perl-regex --context <n>` | `grep.ts` -> `localSearchCode` -> native ripgrep | 8/10 |
| AST/shape discovery | `octocode grep <path> --pattern '$A && $A()' --type ts` | `grep.ts` -> `localSearchCode mode:"structural"` -> Octocode Rust matcher | 8/10 |
| relational structural query | `octocode grep <path> --rule '<yaml>'` | same structural path | 7.5/10 |
| source proof | `octocode cat <path> --start-line <n> --end-line <n> --mode none` | `cat.ts` -> `localGetFileContent` | 9/10 |
| large-file orientation | `octocode cat <path> --mode symbols` or `octocode ls <path> --symbols` | signature/LSP outline path | 8/10 |
| semantic proof | `octocode lsp <file> --type definition --symbol <s> --line <n>` | `lsp.ts` -> `lspGetSemantics` | 7.5/10 |
| schema-exact automation | `octocode tools <name> --scheme`, then `octocode tools <name> --queries '<json>'` | direct tool runner | 9/10 |

Verdict: the command paths are good. Keep one public search verb (`grep`) and
make structural search an axis (`--pattern` / `--rule`) rather than re-adding an
`ast` command. Agents already get the right ladder:

```text
grep discovery -> cat proof -> lsp semantics -> tools raw mode when schema precision matters
```

The biggest remaining CLI improvement is not another command. It is richer
machine-readable follow-up metadata in tool responses. `localSearchCode` now
emits `next.fetchExact`, `next.fetchStandard`, `next.fetchSymbols`,
`next.lspDefinition`, `next.lspReferences`, `nextPage`, and `nextMatchPage`.
The remaining gap is structural `metavarRanges` and a similar `next` map inside
`localGetFileContent` continuations.

## Flow Matrix

| Flow | Status | Agent Next-Step Score | Notes |
|---|---|---:|---|
| text grep -> fetch content | Strong | 9/10 | Search returns path, line, column, match snippets, pagination, hints, and `next.fetchExact` / `next.fetchStandard` / `next.fetchSymbols`. |
| regex grep -> fetch content | Strong | 8.5/10 | Regex and PCRE2 are supported natively; grep still emits line-range fetch next calls, while no-match hints explain per-line regex and case sensitivity. |
| AST grep -> fetch content | Strong | 9/10 | Structural results include exact node text, start/end lines, columns, metavars, and fetch next calls for exact/standard/symbols views. |
| AST grep -> LSP | Better but not perfect | 8/10 | Returned match line is ready as `lineHint`; `next.lspDefinition` / `next.lspReferences` are emitted only when a structural capture gives a plausible symbol. Capture ranges are still missing. |
| grep -> fetch minify:"none" | Strong | 9/10 | Exact source is available when comments, tests, docstrings, or formatting matter. |
| grep -> fetch minify:"standard" | Strong | 8/10 | Default mode is efficient and warns when exact comments/tests/docstrings may require minify:"none". |
| grep -> fetch minify:"symbols" | Good for navigation | 8/10 | Skeleton index is useful for large files. It intentionally ignores matchString and tells the agent to use gutter lines for a body fetch. |
| grep -> fetch pagination continuation | Strong | 9/10 | Content fetch emits charOffset, semantic boundary, nextBlockChar, and line continuation hints. |
| search empty/error recovery | Good | 8/10 | Empty/error hints generally explain narrowing, widening, regex mode, re-anchoring, or path checks. |
| full MCP/NAPI execution | Blocked here | N/A | Native addon cannot be loaded by this shell's Node until rebuilt or signature-compatible. |

## Returned Value Quality

### localSearchCode

Strengths:

- `searchEngine` distinguishes `rg`, `grep`, and `structural`.
- `files[].path` is enough to fetch content.
- `files[].matches[].line` is usable as an LSP `lineHint`.
- `column`, `endLine`, and `endColumn` are present for structural matches.
- Structural matches include `metavars`.
- Pagination and large-result hints tell the agent how to narrow or continue.
- `next.fetchExact`, `next.fetchStandard`, and `next.fetchSymbols` give ready
  `localGetFileContent` calls for `minify:"none"`, `standard`, and `symbols`.
- `next.lspDefinition` and `next.lspReferences` give ready LSP calls when a
  symbol can be safely inferred from a text query or structural capture.
- `next.nextPage` and `next.nextMatchPage` give ready pagination calls.

Weak spots:

- No capture ranges for metavars, only capture text.
- For AST-to-LSP, LSP next calls are heuristic unless capture ranges are added.

Rating: 8.75/10.

### localGetFileContent

Strengths:

- Mutually exclusive extraction modes fail loudly.
- `matchString` returns matched lines, context slices, start/end lines, and
  lineHint-oriented warnings.
- `minify:"none"` preserves exact source.
- `minify:"standard"` is token-efficient and warns when exact text may matter.
- `minify:"symbols"` gives a skeleton index and clear body-fetch guidance.
- Pagination hints include char offsets and semantic boundary hints.

Weak spots:

- No machine-readable continuation query.
- `minify:"symbols"` cannot combine with matchString; it warns, but an agent
  must manually choose the next startLine/endLine.

Rating: 8.5/10.

### lspGetSemantics

Strengths:

- Hints explicitly say to re-anchor with localSearchCode when symbol resolution
  fails.
- Success hints recommend definition, references, callers, callees, and content
  follow-ups.
- Resolver tests prove tree-sitter-assisted lineHint anchoring and UTF-16
  positions.

Weak spots:

- LSP depends on language-server availability and workspace state.
- Structural grep emits ready LSP query objects only when a metavar contains a
  plausible symbol.

Rating: 7.5/10.

## Recommended Next Improvements

1. Add structural capture ranges.

Current:

```json
"metavars": { "A": ["foo"] }
```

Target:

```json
"metavars": { "A": ["foo"] },
"metavarRanges": {
  "A": [{ "text": "foo", "line": 1, "column": 0, "endLine": 1, "endColumn": 3 }]
}
```

This would make AST grep -> LSP much more reliable.

2. Add machine-readable `next` suggestions to fetch-content continuations.

Example:

```json
{
  "next": {
    "continueChars": {
      "tool": "localGetFileContent",
      "query": {
        "path": "/repo/src/a.ts",
        "charOffset": 8000,
        "charLength": 4000,
        "minify": "standard"
      }
    },
    "refetchExact": {
      "tool": "localGetFileContent",
      "query": {
        "path": "/repo/src/a.ts",
        "startLine": 20,
        "endLine": 45,
        "minify": "none"
      }
    }
  }
}
```

3. Add an explicit grep-flow integration test once NAPI loads.

Target scenario:

```text
localSearchCode(mode:"structural", pattern:"$A && $A()")
  -> localGetFileContent(startLine/endLine, minify:"none")
  -> localGetFileContent(matchString, minify:"standard")
  -> localGetFileContent(minify:"symbols")
  -> lspGetSemantics(type:"definition", symbolName from capture, lineHint)
```

4. Keep `minify:"none"` as the recommended follow-up for edits, tests, comments,
and rewrite previews. Use `standard` for reading, and `symbols` for large-file
navigation.

## Overall Verdict

Octocode grep is usable for advanced agent workflows today at the native-engine
level:

```text
text/regex discovery -> source fetch -> AST proof -> LSP semantic follow-up
```

The agent can usually know the next step from the returned path, line, column,
metavars, pagination, and hints. The biggest improvement is making those next
steps machine-readable, especially for AST captures and LSP follow-up.
