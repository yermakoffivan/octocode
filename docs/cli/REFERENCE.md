# Octocode CLI Reference

`octocode` is the terminal interface for code research:

- Run all Octocode MCP tools directly from the shell.
- Use smart quick commands for files, trees, search, PRs, packages, LSP workflows, and repo cloning.
- Use raw `tools` for lower-level GitHub/local research and exact schema-driven calls.
- Manage Octocode setup for IDEs when needed.

## Usage

```bash
octocode <command> [options]

# Quick research commands
octocode cat <path|owner/repo/path>
octocode ls <path|owner/repo>
octocode grep <keywords> <path|owner/repo>
octocode find <query> [path|owner/repo]
octocode ast <pattern> [path]
octocode fetch <owner/repo[/path][@branch]|url>
octocode pr <owner/repo[#N]|PR-URL>
octocode repo <keywords...>
octocode pkg <package>
octocode symbols <file|path>
octocode lsp <file> --type <type>
octocode binary <file>

# Raw tool runner
octocode tools
octocode tools <name> --scheme
octocode tools <name> --queries '<json>'
octocode context
```

## Agent Flow

Agents should use this order:

1. `octocode context`
2. `octocode tools`
3. `octocode tools <name> --scheme`
4. `octocode tools <name> --queries '<json>'`

Use `octocode context --full` only when every inline JSON schema is needed.

## Global Options

| Option | Meaning |
|--------|---------|
| `--help` | Show help. |
| `--version` | Show version. |
| `--json` | Print raw JSON MCP envelope for tool runs. |
| `--compact` | Print lean tool output. |
| `--no-color` | Disable ANSI color. Also honors `NO_COLOR=1`. |

## Quick Commands

Auto-route based on target: a local path routes to local tools; `owner/repo[/path][@branch]` routes to GitHub. All commands support `--json`.

| Command | Routes to | What it does |
|---------|-----------|------|
| `cat` | `localGetFileContent` / `ghGetFileContent` | Read and minify file content |
| `ls` | `localViewStructure` / `ghViewRepoStructure` | Directory structure |
| `grep` | `localSearchCode` / `ghSearchCode` | Text or regex search |
| `find` | `localFindFiles` / `localSearchCode` / `ghSearchCode` | Find files by name, path, or content |
| `ast` | `localSearchCode` (structural) | AST shape search via ast-grep (local only) |
| `fetch` | `ghCloneRepo` | Clone a repo or subtree to `~/.octocode/repos/` |
| `pr` | `ghHistoryResearch` | List or deep-dive pull requests |
| `repo` | `ghSearchRepos` | Discover GitHub repositories |
| `pkg` | `npmSearch` | npm package metadata + source repo |
| `symbols` | `lspGetSemantics` (documentSymbols) | Semantic symbol outline |
| `lsp` | `lspGetSemantics` | Definitions, references, callers, hover, … |
| `binary` | `localBinaryInspect` | Archives, compressed files, native binaries |

### cat

```
cat <path|owner/repo/path>
    --mode  none|standard|symbols    minification (default: standard)
    --branch <ref>                   branch for GitHub paths
    --match-string <s>               return only sections containing this string
    --match-regex                    treat --match-string as a regex
    --match-case-sensitive
    --start-line <n>                 first line (1-based)
    --end-line <n>
    --context-lines <n>              context lines around --match-string hits
    --page-size <n>                  characters per page
    --page <n>
    --char-offset <n>                character offset for continuation
    --char-length <n>
    --full-content                   return the whole file
    --content-type file|directory    GitHub content type
    --force-refresh                  bypass GitHub cache
    --json
```

Examples:

```bash
octocode cat src/index.ts
octocode cat src/index.ts --mode symbols
octocode cat src/index.ts --match-string "runCLI" --mode none
octocode cat src/index.ts --start-line 40 --end-line 90 --mode none
octocode cat facebook/react/packages/react/index.js
octocode cat facebook/react/packages/react/index.js --branch 18.2.0
```

### ls

```
ls <path|owner/repo>
    --depth <n>      recursion depth
    --branch <ref>   branch for GitHub paths
    --pattern <glob> name filter (local only)
    --ext <list>     comma-separated extension whitelist (local only)
    --sort name|size|time|extension   (local only)
    --reverse        reverse sort (local only)
    --files-only     list files only (local only)
    --dirs-only      list directories only (local only)
    --hidden         include dot-files (local only)
    --limit <n>
    --page <n>
    --page-size <n>
    --json
```

Examples:

```bash
octocode ls src
octocode ls src --depth 3 --ext ts,tsx
octocode ls facebook/react
octocode ls facebook/react --branch 18.2.0 --depth 2
```

### grep

```
grep <keywords> <path|owner/repo>
    --type <ext>       filter by language or extension (ts, py, go, rs)
    --mode paginated|discovery|detailed   (local only, default: paginated)
    --concise          paths only, no snippets — cheapest orientation
    --include <glob>   include globs (local only)
    --exclude <glob>   exclude globs (local only)
    --context-lines <n>   context around each match (local only)
    --max-matches <n>  max matches per file (local only)
    --branch <ref>     branch for GitHub paths
    --limit <n>        max files in output
    --page <n>
    --page-size <n>
    --json
```

For AST/structural search use `ast` instead.

Examples:

```bash
octocode grep runCLI src
octocode grep executeDirectTool src --type ts --mode discovery
octocode grep "useState" facebook/react --type ts
octocode grep "executeCloneRepo" bgauryy/octocode-mcp --concise
```

### find

```
find <query> [path|owner/repo]
    --source auto|local|github      routing (default: auto)
    --search path|content|both      search mode (default: path)
    --ext <list>                    comma-separated extensions
    --path <subpath>                local root or GitHub repo subpath
    --owner <owner>                 GitHub owner
    --repo <repo>                   GitHub repository
    --filename <name>               GitHub filename filter
    --limit <n>
    --page <n>
    --page-size <n>

    Local path filters:
    --name <glob>                   basename glob(s)
    --regex <pattern>               basename regex
    --min-depth <n>
    --max-depth <n>
    --entry f|d                     file (f) or directory (d)
    --modified-within <window>      e.g. 7d, 2h, 1w
    --modified-before <window>
    --size-greater <size>           e.g. 100k, 1m
    --size-less <size>
    --executable / --readable / --writable
    --empty

    Local content filters (when --search content|both):
    --mode paginated|discovery|detailed
    --include <glob>
    --exclude <glob>
    --case-insensitive / --case-sensitive / --whole-word
    --fixed-string / --perl-regex
    --invert-match
    --context-lines <n>
    --max-matches-per-file <n>
    --count-lines / --count-matches
    --files-only / --files-without-match
    --json
```

Examples:

```bash
octocode find auth src --source local --search path --ext ts
octocode find executeDirectTool . --source local --search content --ext ts
octocode find auth bgauryy/octocode-mcp --source github --search path --ext ts
octocode find auth . --search both --limit 20
```

### ast

AST shape search using [ast-grep](https://ast-grep.github.io). Structure-aware — comments and strings never false-match. **Local only** — for text/regex or GitHub use `grep`.

```
ast <pattern> [path]
ast [path] --rule <yaml>
    --pattern <ast>    AST shape. Metavars: $X = one node, $$$ARGS = a list.
                       e.g. 'eval($X)', 'console.log($$$)', 'foo($X, $Y)'
    --rule <yaml>      Relational YAML rule — not/inside/has/all/any.
                       Mutually exclusive with positional pattern.
    --type <ext>       filter by language or extension (ts, py, go)
    --context-lines <n>   context around each match (default: 0)
    --max-matches <n>  max matches per file
    --limit <n>        max files in output (default: 10)
    --page <n>
    --page-size <n>
    --json
```

Examples:

```bash
octocode ast 'eval($X)' src
octocode ast 'console.log($$$)' src --type ts
octocode ast 'useState($X)' . --type tsx --context-lines 3
octocode ast src --rule 'rule:\n  pattern: await $C\n  inside:\n    kind: for_statement'
```

### fetch

Clone a GitHub repo or subtree locally. Clones land at `~/.octocode/repos/<owner>/<repo>/<branch>/` with a 24-hour cache.

```
fetch <owner/repo[/path][@branch]|url>
    --branch <ref>      override branch (also parses from @branch syntax)
    --force-refresh     bypass 24-hour cache and re-clone
    --json
```

Accepted ref formats:

| Input | Effect |
|-------|--------|
| `owner/repo` | Full clone of default branch |
| `owner/repo/packages/core` | Sparse checkout of `packages/core` subtree |
| `owner/repo@main` | Full clone at branch `main` |
| `owner/repo@main/src` | Sparse checkout of `src` at branch `main` |
| `https://github.com/owner/repo/tree/main/src` | Same as above |

Examples:

```bash
octocode fetch facebook/react
octocode fetch facebook/react/packages/react
octocode fetch facebook/react@18.2.0/packages/react
octocode fetch https://github.com/vercel/next.js/tree/main/packages/next
```

After fetching, use local tools against the cloned path:

```bash
octocode ls ~/.octocode/repos/facebook/react/main
octocode grep "useState" ~/.octocode/repos/facebook/react/main
```

### pr

```
pr <owner/repo[#N]|PR-URL>
    --pr <n>                     PR number (alternative to #N syntax)
    --state open|closed|merged
    --query <keywords>           keyword filter in list mode
    --author <user>
    --label <label>
    --base <branch>
    --sort created|updated|best-match|comments|reactions
    --order asc|desc
    --draft                      show only draft PRs
    --created <range>            e.g. >2024-01-01
    --merged-at <range>
    --concise                    flat "#number title" list — cheapest triage
    --limit <n>
    --page <n>
    --page-size <n>
    --patches                    include unified diffs
    --file <path>                diff for one file only
    --comments                   include comments
    --commits                    include commits
    --deep                       patches + comments + commits + reviews
    --match-string <s>           narrow returned content
    --char-length <n>
    --char-offset <n>
    --json
```

Examples:

```bash
octocode pr facebook/react
octocode pr facebook/react --state merged --limit 20
octocode pr facebook/react#29940 --patches --comments
octocode pr https://github.com/vercel/next.js/pull/65000 --deep
```

### repo

```
repo <keywords...>
    --topic <list>                    comma-separated GitHub topics
    --language <lang>
    --owner <owner>                   owner or organization
    --stars <range>                   e.g. >100, 50..500
    --forks <range>
    --good-first-issues <range>
    --license <spdx>                  e.g. mit, apache-2.0
    --created <range>                 e.g. >2023-01-01
    --updated <range>
    --size <range>                    repository size in KB
    --match name,description,readme
    --sort stars|forks|help-wanted-issues|updated|best-match
    --archived true|false
    --visibility public|private
    --limit <n>
    --page <n>
    --verbose                         structured repository objects
    --json
```

Examples:

```bash
octocode repo react state --language TypeScript --stars '>1000'
octocode repo --topic mcp,agents --sort stars --limit 10
octocode repo --owner vercel --language TypeScript --verbose
```

### pkg

```
pkg <package|keywords>
    --mode lean|full    lean (default) or full metadata
    --page <n>          result page for keyword searches
    --json
```

Examples:

```bash
octocode pkg zod
octocode pkg @modelcontextprotocol/sdk
octocode pkg "http client typescript"
```

### symbols

```
symbols <file|path>
    --ext <list>      comma-separated extensions for directory mode
    --kind <kind>     filter by symbol kind: function, class, method, …
    --limit <n>       max files in directory mode (default: 10)
    --depth <n>       directory discovery depth (default: 4)
    --page-size <n>   symbols per file from LSP (default: 40)
    --json
```

For a file, runs `lspGetSemantics type=documentSymbols`. For a directory, discovers source files then batches `documentSymbols` over them.

Examples:

```bash
octocode symbols src/index.ts
octocode symbols src --ext ts,tsx --limit 10
octocode symbols src/index.ts --kind function
```

### lsp

```
lsp <file> --type <type>
    --type   definition|references|callers|callees|callHierarchy
             hover|documentSymbols|typeDefinition|implementation   (required)
    --symbol <name>             required unless --type documentSymbols
    --line <n>                  required unless --type documentSymbols
    --workspace-root <path>
    --format structured|compact
    --context-lines <n>
    --depth <n>                 call hierarchy depth
    --page <n>
    --page-size <n>
    --json
```

Run `grep` or `symbols` first to get a real `--line` value. Never guess `--line`.

Examples:

```bash
octocode lsp src/index.ts --type documentSymbols
octocode lsp src/index.ts --type references --symbol runCLI --line 42
octocode lsp src/index.ts --type callers --symbol executeDirectTool --line 18
octocode lsp src/index.ts --type hover --symbol runCLI --line 42
```

### binary

```
binary <file>
    (no flags)           auto-detect mode from extension
    --list               list archive entries
    --extract <entry>    extract one archive member (exact path from --list)
    --strings            readable strings from a native binary
    --decompress         decompress a single-stream file
    --identify           file type and magic bytes only
    --match <s>          filter extracted/decompressed lines
    --min-length <n>     strings: shortest run to keep (default 8)
    --max-entries <n>    list: cap entries
    --format <fmt>       decompress: force compression format
    --verbose            list: include size and mtime
    --offsets            strings: prefix each with hex byte offset
    --page <n>
    --json
```

Always run `--identify` or no flags first. Use `--list` before `--extract` — do not guess entry names.

Examples:

```bash
octocode binary archive.zip --list
octocode binary archive.zip --extract src/index.ts
octocode binary release.tar.gz --decompress
octocode binary lib.node --strings --min-length 12
```

## Management Commands

### install

```
install --ide <client> [--method npx] [--force] [--check] [--rollback] [--backup-path <path>] [--json]
```

Configures the MCP server for an IDE. `--check` does a pre-flight only. `--rollback` restores the most recent backup.

Supported `--ide` values: `cursor`, `claude-desktop`, `claude-code`, `windsurf`, `zed`, `vscode-cline`, `vscode-roo`, `vscode-continue`, `opencode`, `trae`, `antigravity`, `codex`, `gemini-cli`, `goose`, `kiro`

### auth

```
auth [login|logout|status|token|refresh] [--hostname <host>] [--json]

login   [--hostname <host>] [--git-protocol ssh|https] [--force] [--json]
logout  [--hostname <host>] [--yes] [--json]
```

GitHub OAuth authentication. `login` opens the device flow. `logout` removes encrypted credentials. `--hostname` targets GitHub Enterprise.

### token

```
token [--type auto|octocode|gh] [--hostname <host>] [--source] [--validate] [--reveal] [--json]
```

Prints the resolved GitHub token (masked by default). Resolution order: `OCTOCODE_TOKEN` → `GH_TOKEN` → `GITHUB_TOKEN` → encrypted store → `gh auth token`.

- `--source` — show token origin and authenticated username
- `--validate` — ping the GitHub API; shows rate-limit info
- `--reveal` — print the full token (default: masked on terminal, raw when piped)

### status

```
status [--hostname <host>] [--sync] [--json]
```

Shows auth state, MCP client install health, and cache info. `--sync` adds cross-client token sync analysis.

### skills

```
skills [search|read|install|remove|list|sync]
    --skill <name>            bundled skill name
    --local <path>            path to a local skill folder
    --targets <list>          comma-separated install targets
    --target <target>         filter list to one target
    --mode copy|symlink       install mode (default: copy)
    --force                   overwrite existing skills
    --dry-run                 show plan without writing
    --limit <n>               max search results (default: 20)
    --full                    show full SKILL.md without truncation (read only)
    --direct                  search skills.sh and show results
    --install                 install the top search result (with search --direct)
    --json
```

Supported install targets: `claude-code`, `claude-desktop`, `cursor`, `codex`, `opencode`.

Skills guide: [docs/SKILLS_GUIDE.md](https://github.com/bgauryy/octocode-mcp/blob/main/docs/SKILLS_GUIDE.md)

## Tool Runner

`octocode tools` imports the canonical public catalog from `octocode-mcp/public`; the CLI does not maintain separate tool schemas.

`--queries` accepts an object, array, or wrapped object:

```json
{ "path": ".", "keywords": "runCLI" }
[{ "path": ".", "keywords": "runCLI" }]
{ "queries": [{ "path": ".", "keywords": "runCLI" }] }
```

Direct CLI runs auto-fill required context fields when omitted.

### Tools

| Category | Tools |
|----------|-------|
| GitHub | `ghSearchCode`, `ghGetFileContent`, `ghViewRepoStructure`, `ghSearchRepos`, `ghHistoryResearch`, `ghCloneRepo` |
| Local | `localSearchCode`, `localViewStructure`, `localFindFiles`, `localGetFileContent`, `localBinaryInspect` |
| LSP | `lspGetSemantics` |
| Package | `npmSearch` |

Examples:

```bash
octocode tools
octocode tools localSearchCode --scheme
octocode tools localSearchCode --queries '{"path":".","keywords":"runCLI"}'
octocode tools ghSearchCode --queries '{"keywordsToSearch":["useReducer"],"owner":"facebook","repo":"react"}'
octocode tools ghCloneRepo --queries '{"owner":"facebook","repo":"react","sparsePath":"packages/react"}'
```

## Environment

| Variable | Meaning |
|----------|---------|
| `OCTOCODE_TOKEN` | Highest-priority GitHub token. |
| `GH_TOKEN` | GitHub CLI compatible token. |
| `GITHUB_TOKEN` | GitHub token fallback. |
| `OCTOCODE_HOME` | Override Octocode data directory (default: `~/.octocode`). |
| `ENABLE_LOCAL` | Enable local filesystem tools (default: `true`). |
| `ENABLE_CLONE` | Enable `ghCloneRepo` / `fetch` command (default: `false`). |
| `NO_COLOR` | Disable terminal color. |

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success. |
| `1` | General error. |
| `2` | Invalid input or unsupported flags. |
| `3` | Unknown tool or command. |
| `4` | Authentication failure. |
| `5` | Tool/API execution error. |
| `7` | Rate limited. |
