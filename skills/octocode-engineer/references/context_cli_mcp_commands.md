# Context — CLI ↔ MCP Command Map

This skill drives the **octocode CLI** or the **octocode MCP tools** — the same engine, two transports. Pick one (see [SKILL.md](../SKILL.md) §Choose your transport) and use the matching column.

Canonical, always-current CLI docs: **[docs/cli/REFERENCE.md](https://github.com/bgauryy/octocode/blob/main/docs/cli/REFERENCE.md)**. This file is the condensed map for engineering work; run `octocode <cmd> --help` for the exact flags in your installed version.

---

## Transport probe

```bash
# MCP? — if localSearchCode / lspGetSemantics calls succeed, you're on MCP.
# CLI? —
octocode --version        # prints → CLI available
octocode context          # tool context for agents
octocode tools            # list runnable tools
octocode tools <name> --scheme   # schema for one tool on demand
```

Neither works → octocode is required; stop and ask the user to register the MCP server or install the CLI. Do not substitute native search.

---

## Tool map

| Job | CLI command | MCP tool | Routes to |
|-----|-------------|----------|-----------|
| Map a directory / repo tree | `octocode ls <path\|owner/repo> --depth N` | `localViewStructure` / `ghViewRepoStructure` | structure |
| Find files by name / size / mtime | `octocode find <q> [path] --regex/--size-greater/--modified-within` | `localFindFiles` | file metadata |
| Text / regex search | `octocode grep <kw> <path\|owner/repo> [--mode discovery]` | `localSearchCode` / `ghSearchCode` | content |
| **AST** structural search | `octocode ast '<pattern>' <path>` / `--rule <yaml>` | `localSearchCode(mode:"structural")` | ast-grep (local only) |
| Read / minify a file | `octocode cat <f> --mode symbols\|none --match-string` | `localGetFileContent` / `ghGetFileContent` | content |
| **Symbols** (file outline) | `octocode symbols <f\|path>` | `lspGetSemantics(type=documentSymbols)` | LSP |
| **LSP** semantic nav | `octocode lsp <f> --type <t> --symbol S --line N` | `lspGetSemantics(type=…)` | LSP |
| PR list / deep-dive | `octocode pr <owner/repo[#N]> --deep` | `ghHistoryResearch(type=prs)` | history |
| Commit history | `octocode history <owner/repo/path>` | `ghHistoryResearch(type=commits)` | history |
| Discover repos | `octocode repo <keywords> --stars '>1000'` | `ghSearchRepos` | GitHub |
| Package → repo | `octocode pkg <package>` | `npmSearch` | npm |
| Inspect archive / binary | `octocode binary <f> --list/--strings/--decompress` | `localBinaryInspect` | binary |
| Unpack archive to dir | `octocode unzip <archive>` | `localBinaryInspect(unpack)` | binary |
| Clone repo / subtree locally | `octocode clone <owner/repo[/path][@branch]>` | `ghCloneRepo` | clone (needs `ENABLE_CLONE=true`) |

Global CLI flags: `--json` (raw envelope), `--compact` (lean), `--concise` (paths/titles only for search), `--no-color`. Unknown flags are rejected with a near-miss suggestion.

---

## `ast` — structural search (the old scanner's job)

AST shape search via [ast-grep](https://ast-grep.github.io). Structure-aware — comments and strings never false-match. **Local only**; for a GitHub repo, `octocode clone owner/repo/path` first.

```
octocode ast <pattern> [path]
octocode ast [path] --rule <yaml>
    --pattern <ast>      shape; metavars $X (one node), $$$ARGS (a list)
    --rule <yaml>        relational rule — not/inside/has/all/any (mutually exclusive with pattern)
    --type <ext>         ts, py, go, rs, …
    --context-lines <n>  context around each match (default 0)
    --max-matches <n>    per file
    --limit <n>          max files (default 10)
    --page <n> / --page-size <n>
    --json
```

MCP equivalent: `localSearchCode({ mode:"structural", pattern:"…" | rule:{…}, path, langType })`.

Pattern library (the former presets) and pitfalls: [context_ast_pattern_cookbook.md](./context_ast_pattern_cookbook.md).

---

## `lsp` — semantic navigation

```
octocode lsp <file> --type <type> --symbol <name> --line <n>
    --type   definition|references|callers|callees|callHierarchy|hover|typeDefinition|implementation
    --symbol <name>           required
    --line <n>                required — get a REAL value from grep/symbols/ast first; never guess
    --format structured|compact
    --context-lines <n>
    --depth <n>               call hierarchy depth
    --json
```

- File outline uses `octocode symbols <f>` / `lspGetSemantics(type=documentSymbols)` — no `--line` needed.
- Semantic misses (`symbolNotFound`, `noReferences`, `noCalls`, …) exit `3` so shell scripts fail fast.
- `references`/`callers`/`implementation` are open-file-scoped — empty ≠ unused. Load the consumer file (MCP: batch a `documentSymbols`/`definition` query on it in the same call; CLI: `symbols`/`cat` it first), then re-query.
- `callers`/`callees`/`callHierarchy`: TS/JS/Go/Rust only. Python/C++ → use `references`.

---

## Reading less — minify by goal

`cat --mode` (CLI) / `minify` (MCP):

| Goal | mode | Notes |
|------|------|-------|
| Orient on an unknown file | `symbols` | line-numbered skeleton; never paginated |
| Read | `standard` (default) | strips comments / blank lines |
| Quote / diff exact text, get a `line` | `none` | raw; pair with `--match-string` → returns the real line number |

`grep --mode discovery` (paths only) before `paginated`/`detailed`. `--concise` for the leanest discovery list.

---

## Environment

| Variable | Meaning |
|----------|---------|
| `ENABLE_LOCAL` | local filesystem tools (default `true`) |
| `ENABLE_CLONE` | `clone` / `ghCloneRepo` (default `false`) |
| `OCTOCODE_TOKEN` → `GH_TOKEN` → `GITHUB_TOKEN` | GitHub token resolution order |
| `OCTOCODE_HOME` | data dir (default `~/.octocode`) |

Local tools are confined to `$HOME` (+ `ALLOWED_PATHS`); paths outside are rejected.

---

## What the native toolset does NOT do

The CLI/MCP find **shapes** (AST) and **relationships** (LSP, imports). They do **not** compute a dependency graph, cycle clusters, coupling/instability metrics, complexity/Halstead/Maintainability-Index numbers, or run a multi-detector scan. For those, approximate with fan-in/fan-out counts (see [SKILL.md](../SKILL.md) §4 Architecture, metrics & graph) or use an external measurement tool from [context_external_measurement_tools.md](./context_external_measurement_tools.md) — and **flag in the artifact** when a claim rests on approximation.
