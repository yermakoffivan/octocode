# Code Review: octocode-engine + octocode-tools-core — pagination check + CLI validation

Scope: `packages/octocode-engine` (Rust native primitives) + `packages/octocode-tools-core` (TS brain), focused on LSP / AST / flows, a pagination gap-analysis across all local tools, and live CLI validation of every local + GitHub tool. All file:line citations are from the current `main` build.

---

## 1. Pagination check (the key ask) — verdict: NO new pagination needed

Every local tool already paginates, most at multiple levels. The envelope is normalized by `responses.ts` (`isTrivialPagination` + `PAGINATION_KEYS`) which also strips no-op pagination (`hasMore:false`, `totalPages≤1`) to keep output lean.

| Tool | File | Pagination mechanism | Status |
|---|---|---|---|
| `localSearchCode` (text) | `tools/local_ripgrep/ripgrepResultBuilder.ts` (`buildSearchResult`) | file-level `page`/`itemsPerPage` (default 20, max 50) **+** per-file `matchPage`/`maxMatchesPerFile` (default 10, max 100) **+** `maxFiles` cap **+** `next.nextPage` / `next.nextMatchPage` continuation queries | ✅ multi-level |
| `localSearchCode` (structural/AST) | `tools/local_ripgrep/structuralSearch.ts` | routes engine results through the same `buildSearchResult` | ✅ identical to text |
| `localViewStructure` | `tools/local_view_structure/structureResponse.ts` (`paginateEntries`, `buildEntryPaginationHints`) | `page`/`itemsPerPage` (default 100) + next-page preview hint | ✅ |
| `localFindFiles` | `tools/local_find_files/findFiles.ts` | `page`/`itemsPerPage` + `limit` (pre-sort discovery cap, `totalFilesFound` when capped) | ✅ |
| `localGetFileContent` | `tools/local_fetch_content/fetchContent.ts` (`buildSuccessResult`) | char-level `charOffset`/`charLength` + **semantic-boundary snapping** (`snapToSemanticBoundary`, `isMidBlockCut`, `findNextBlockBoundary`) + auto-paginate over default char limit + line-range continuation (`startLine`/`endLine`) | ✅ best-in-class |
| `localBinaryInspect` | `tools/local_binary_inspect/binaryInspector.ts` | `list`: `entryPageNumber`/`entriesPerPage`; `extract`/`decompress`: `charOffset`/`charLength`; `strings`: **two cursors** — `charOffset` (within window) + `scanOffset`/`nextScanOffset` (across file, lossless) | ✅ (see ⚠️) |
| `lspGetSemantics` | `tools/lsp/semantic_content/execution.ts` (`paginateItems`) | `page`/`itemsPerPage` — defaults 40 (symbols/locations), 10 (calls); `callHierarchy` adds `completeness` + range sampling (`MAX_RANGE_SAMPLES=8`); `hover` not paginated (single bounded blob) | ✅ |

Constants: `utils/core/constants.ts` — `DEFAULT_FILES_PER_PAGE=20`, `DEFAULT_MATCHES_PER_PAGE=10`, `DEFAULT_ENTRIES_PER_PAGE=100`, `MAX_FILES_PER_PAGE=50`, `MAX_MATCHES_PER_PAGE=100`.

### The one gap (low severity, by-design-bounded)
`localBinaryInspect` **`inspect` with `detailed:true`** returns the full `symbols`/`imports`/`exports`/`sections` arrays. The engine caps each at `LIST_CAP = 2000` (`octocode-engine/src/binary/inspect.rs:14`), reports true totals via `symbol_count`/`import_count`/`export_count`, and sets `truncated: true` when counts exceed the array — but there is **no page cursor** to fetch beyond the first 2000.
- Mitigations: `detailed` defaults to `false` (counts only); exhaustive enumeration is the job of `strings` mode, which IS paginated (`charOffset` + `scanOffset`).
- Recommendation: optional — add an `entriesPerPage`/`page` cursor to `inspect` detailed arrays mirroring `list` mode, for users who need to page a 50k-symbol symtab. Not a blocker; current behavior is safe and flagged.

**Conclusion:** no pagination needs to be added to the local tools. Coverage is thorough and consistent (file/match/char/item/scan levels + continuation `next.*` queries).

---

## 2. octocode-engine review (Rust: LSP, AST, flows)

### AST / structural search — strong
`structural/octo.rs` (1275 lines) is a well-architected tree-sitter matcher:
- `compile_matcher` → boxed closure `OctoCompiledMatcher` (`octo.rs:11-16`); two paths: `CompiledPattern` (pattern) and `CompiledRule` (relational YAML).
- `CandidatePlan` (`octo.rs:135-191`) — prefilter plan that **intersects `all:`** and **unions `any:`**; `impossible_candidate_plan_returns_no_matches` test confirms empty plans short-circuit. Smart optimization.
- `CaptureEnv` (`octo.rs:193-222`) — metavar capture `$X` (single) / `$$$ARGS` (multi); `match_multi_capture` preserves argument separators.
- `LineIndex` (`octo.rs:1015-1060`) — byte→line/col conversion, UTF-8-correct (`point_column_to_char_column`).
- Relational: `matches_descendant` (inside) / `matches_ancestor` (has) with `stop_by_end` enforced; `unsafe_prefilter_reason` correctly bails on `not:`/`any:` (single literal anchor unsafe).
- Special patterns `HtmlTagName` / `KeyValuePair` for non-AST JSON/HTML shapes.
- Test coverage: document probe, single metavar, comments/strings don't false-match, multi-capture separators, kind rules, inside+stopBy, all/any/not composition, candidate-plan intersection/union. Solid.

`structural/query.rs` — clean literal-anchor derivation for the ripgrep prefilter; correctly prefers identifier literals, falls back to operator tokens, and bails on `not:`/`any:`. Good tests.

### Finding E1 (medium, UX/docs) — bodiless function-definition patterns match nothing
`grep <path> --pattern 'fn $NAME($$$ARGS)' --type rust` returns **0 matches** over files that provably contain functions (documentSymbols returned 12 fns in `query.rs`). Root cause: a pattern without a body `{ ... }` doesn't parse to a complete `function_item` root in tree-sitter Rust, so there's no matchable kind. The `kind: function_item` rule **does** work (70 matches in `octo.rs`). This is a pattern-shape limitation, not a matching bug — but it's **undocumented** and a user will hit it immediately.
- Fix: document the workaround in the `grep` help / skill — "to match definitions, use a `kind:` rule or include a body (`fn $NAME($$$ARGS) { $$$BODY }`)".

### binary/inspect.rs — solid
`LIST_CAP=2000`, `MAX_FILE=512MB` (`inspect.rs:14-17`), every napi call wrapped in `catch_unwind` (per Cargo comment), graceful degradation to magic-byte identity on parse failure, `truncated` flag when counts exceed arrays. ELF/PE/Mach-O/ar all expanded; universal magic sniffing covers formats goblin doesn't parse (wasm/gzip/zip…). Good tests.

### security/sanitizer.rs — contract upheld
`MAX_CONTENT_SIZE = 10_000_000` (`sanitizer.rs:5`); oversized content is fully redacted (`[CONTENT-REDACTED-SIZE-LIMIT]`) as a safety net. Chunked detection for large content. Returns `{ content, has_secrets, secrets_detected, warnings }`. Minor: `has_secrets:true` for the size-limit case is semantically odd (size ≠ secret) but intentionally conservative. Tests cover oversized / clean / redacted.

### Finding E2 (low, docs) — stale skill package map
Top-level `AGENTS.md` is current (engine absorbed `lsp` + `security` + the old `context-utils`). But `.agents/skills/octocode/SKILL.md` still lists `octocode-lsp`, `octocode-context-utils`, `octocode-security` as separate packages in its package map and "Native (Rust-accelerated) Packages" table — and claims `octocode-tools-core` depends on them. The real dep is `@octocodeai/octocode-engine` (`workspace:*`). The skill should be updated.

---

## 3. octocode-tools-core review (TS brain)

- `responses.ts` — `cleanJsonObject` + `isTrivialPagination` + `PAGINATION_KEYS` allowlist: elegant output shaping that strips no-op pagination and drops empty subtrees, while preserving `results:[]` at depth 0. `ContentBuilder` role-annotated blocks + `QuickResult` factories. High quality.
- `utils/contextUtils.ts` — lazy native loader (`createRequire` + cached singleton), `ContextUtilsLoadError` for clear failure, `setContextUtilsNativeLoaderForTesting`/`reset…` for DI in tests (no prod mocks). Thin pass-through facade over ~30 native functions. Clean seam. (Note: the source file is authored minified/one-line — hard to read; functionally fine.)
- `tools/lsp/semantic_content/execution.ts` — native oxc fast-path for JS/TS `documentSymbols`/`references` when no language server (stamps `source: 'native'`); import-alias resolution for `definition` (`resolveImportAliasDefinitions`); `references` `groupByFile`; call-hierarchy with `completeness` (`truncatedByDepth`, `cycleCount`, `failedRequestCount`, `dynamicCallsExcluded`, `stdlibCallsExcluded`) + range sampling. `paginateItems()` applied to every list type. Native JS/TS symbol extraction via `contextUtils.extractJsSymbols` / `findInFileReferences`. High quality.
- `tools/local_ripgrep/ripgrepResultBuilder.ts` — `buildSearchNextMap` constructs concrete `next.*` continuation queries (`fetchExact`/`fetchStandard`/`fetchSymbols`/`lspDefinition`/`lspReferences`/`nextPage`/`nextMatchPage`) — the best "flows" feature: the tool tells the agent the exact next call. LSP symbol inference is conservatively correct (`inferLspSymbolName` only infers from a bare identifier, never regex/literals/dotted text).
- `tools/local_fetch_content/fetchContent.ts` — mutual-exclusivity validation for `fullContent`/`matchString`/`startLine+endLine`; binary detection (null-byte + UTF-8 fatal + control-byte ratio); large-file guard; secret redaction via `ContentSanitizer`. `minify:"symbols"` falls back to standard with a warning when the type is unsupported.
- `tools/local_ripgrep/structuralSearch.ts` — `langType` → include-glob mapping for structural mode; clean engine → `buildSearchResult` wiring.

No defects found in the tools-core logic reviewed. Architecture is clean: tools-core owns behavior, interfaces stay thin.

---

## 4. CLI validation (built `packages/octocode/out/octocode.js`) — local + GitHub

Token resolved via `gh cli` stored creds (`status` → "Authenticated as guybary-wix"). All commands run with `--compact`.

### PASS (working correctly)
**Local:** `ls` (local tree + `owner/repo` GitHub structure), `cat --mode symbols` (skeleton + line gutter), `grep` (text + `--count-lines` + structural `--pattern` call patterns + structural `--rule kind:` with real newlines), `find` (`--name`/`--modified-within`/`--sort`), `binary` (auto-inspect of `.node` → Mach-O aarch64, 230 symbols, 244 imports, dylib deps), `lspGetSemantics --type documentSymbols` (via raw `tools` form — rust-analyzer online, 17 symbols, pagination).
**GitHub:** `cat facebook/react/README.md`, `pkg react` (19.2.7, weeklyDownloads, pagination), `ls facebook/react` (repo tree via routing), `history facebook/react` (commits + PR refs + `--page` pagination), `pr facebook/react --limit 3` + `--state open` (open PRs + `Page 1/2`).

### FAIL (reproducible bugs / gaps)

**C1 — `ast` quick command does not exist (doc gap).** `.agents/skills/octocode/SKILL.md` documents `ast '<pattern>' <path>` as a quick command, but `octocode ast …` → `Unknown command: ast`. Workaround: `grep <path> --pattern '...'`. Either add the `ast` command or fix the skill.

**C2 — `grep --rule` does not convert literal `\n` to newlines (doc/impl mismatch).** `grep <path> --rule 'rule:\n  kind: function_item'` → `Invalid structural rule: unknown field `rule:\n  kind`, expected `rule`` (the `\n` reached serde_yaml as a literal backslash-n, parsing `rule:\n  kind` as one key). Real newlines via `$'rule:\n  kind: function_item'` **work** (70 matches). But `grep --help` EXAMPLES show `--rule 'rule:\n  pattern: await $C\n  inside:\n    kind: for_statement\n    stopBy: end'` with literal `\n` — which fails exactly as above. Either the CLI should unescape `\n` in `--rule`/`--pattern` values, or the help must show `$'...'` ANSI-C quoting. (`packages/octocode/src/cli`.)

**C3 — `lsp` quick command rejects `documentSymbols` (medium).** `lsp <file> --type documentSymbols` → `Provide --type with one of: definition, references, callers, callees, callHierarchy, hover, typeDefinition, implementation` — `documentSymbols` is absent from the CLI enum, and the hint redirects to `ls --symbols`. But `ls --symbols` uses the engine **signature extractor** (oxc, JS/TS-only), NOT the LSP `documentSymbolProvider`. For Rust/Python/etc. this yields no outline, while the raw `tools lspGetSemantics --type documentSymbols` returns a full LSP outline (verified: rust-analyzer, 17 symbols). Add `documentSymbols` to the `lsp` quick command (no `--symbol`/`--line` required), or document the raw-tools fallback. (`packages/octocode/src/cli` lsp command builder.)

**C4 — `pr <owner/repo> --state merged` returns "No pull requests found" (medium, reproducible ×2).** `pr facebook/react --state merged --limit 2` → empty, while `--state open` works and merged PRs provably exist (`history` showed #36682, #36599 merged 2d ago). Likely root cause: `--state merged` is mapped to a REST *list* `state` param, which only accepts `open|closed|all` (not `merged`); `merged` is a *search* qualifier (`is:merged`) and belongs on the GraphQL search path. Verify against `tools/github_search_pull_requests/` + the CLI `pr` command builder. Repro: `pr facebook/react --state merged --limit 2`.

**C5 — `repo <owner/repo>` does repo *search*, not structure browse (low, UX).** `repo facebook/react` returns search hits (`react-devtools`, `react-native-deprecated-modules`), not the `facebook/react` tree. Structure browse is `ls facebook/react` (works). The `repo` name is unintuitive for "search repos". Consider renaming / clarifying in help.

**C6 — flag naming diverges from schema (low, UX).** CLI singularizes array fields: `--name` (not `--names`), `--sort` (not `--sort-by`), `binary --inspect` (not `--mode inspect`). The MCP schema fields are `names`/`sortBy`/`mode`. Error suggestions are good ("did you mean --name?"), but a parity alias or a help note would reduce friction.

---

## 5. Summary

- **Pagination:** complete across all local tools + LSP + AST. No additions needed; one optional cursor for `binary inspect` detailed arrays (low priority).
- **Engine:** well-architected, well-tested Rust. AST matcher is the highlight (CandidatePlan prefilter, metavar capture, UTF-8-correct offsets, relational with stopBy). One UX gap to document (bodiless definition patterns).
- **tools-core:** clean ownership, no logic defects found. `next.*` continuation queries and conservative LSP symbol inference are standout "flows" features.
- **CLI:** all 13 tools reachable and mostly working; **4 real bugs** to fix (C1 ast cmd, C2 `--rule \n`, C3 lsp documentSymbols, C4 pr --state merged) + 2 UX items (C5, C6) + the stale skill (E2).
