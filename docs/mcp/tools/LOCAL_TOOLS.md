# Local Tools Reference

> Complete reference for Octocode MCP local tools: file system exploration, metadata search, code search, and targeted file reading.

---

## Scope

| Tool | Purpose |
|------|---------|
| `localSearchCode` | Ripgrep content search + AST/structural search (`mode:"structural"`). |
| `localViewStructure` | Browse directory structure and metadata. |
| `localFindFiles` | Find files/directories by name, path, time, size, type, and permissions. |
| `localGetFileContent` | Read targeted file content by line range, match, signature skeleton, or char page. |
| `localBinaryInspect` | Inspect archives, compressed streams, and native binaries. See [BINARY_TOOLS.md](https://github.com/bgauryy/octocode-mcp/blob/main/docs/mcp/tools/BINARY_TOOLS.md). |

---

## Configuration

Local tools must be enabled before use:

```bash
ENABLE_LOCAL=true
```

Or via config:

```json
{
  "local": {
    "enabled": true
  }
}
```

Useful local-tool environment variables:

| Variable | Description |
|----------|-------------|
| `ENABLE_LOCAL` | Enables local filesystem tools. Defaults to `true`. |
| `WORKSPACE_ROOT` | Root used to resolve relative local paths. Overrides `local.workspaceRoot` in config. |
| `ALLOWED_PATHS` | Optional comma-separated allowlist. Empty means all paths are allowed after normal validation. |
| `ENABLE_CLONE` | Enables clone-backed workflows and GitHub directory fetches that materialize local files. |

Config reference: [Configuration Reference](https://github.com/bgauryy/octocode-mcp/blob/main/docs/mcp/CONFIGURATION.md).

---

## Platform Support

`localSearchCode` uses the bundled `@vscode/ripgrep` binary. There is no `grep` fallback. If the bundled binary cannot load, the tool returns an actionable error.

`localGetFileContent` is pure Node.js and works on macOS, Linux, and Windows.

`localFindFiles` and `localViewStructure` use POSIX `find` and `ls`. They work on macOS and Linux out of the box. On Windows, use Git Bash or WSL, or prefer `localSearchCode(filesOnly=true, ...)` when content search can answer the question.

---

## Pagination

All tools accept up to 5 queries per call.

Local tools expose two pagination layers:

| Layer | Fields | Applies To |
|-------|--------|------------|
| Native result pagination | `page`, `itemsPerPage` | `localSearchCode`, `localViewStructure`, `localFindFiles` |
| Per-file match pagination | `matchPage`, `maxMatchesPerFile` | `localSearchCode` when a matched file has more matches |
| Content pagination | `charOffset`, `charLength` | `localGetFileContent` and oversized per-query payloads |
| Bulk response pagination | `responseCharOffset`, `responseCharLength` | Any local-tool bulk response |

Use native pagination first for result lists, then char pagination only when a single result payload is still too large.

---

## Tool Selection

| Need | Use |
|------|-----|
| "Which directories/files exist here?" | `localViewStructure` |
| "Find files named `*.test.ts` or changed recently." | `localFindFiles` |
| "Search for text, regex, imports, TODOs, or identifiers." | `localSearchCode` |
| "Read this exact file section." | `localGetFileContent` |
| "Find files containing a pattern without match bodies." | `localSearchCode(filesOnly=true, ...)` |
| "Find files that do not contain a pattern." | `localSearchCode(filesWithoutMatch=true, ...)` |

Recommended order for code research:

```text
DISCOVER -> SEARCH -> READ
```

Start broad with structure or metadata, narrow with content search, then read the smallest exact file slice needed.

---

## `localSearchCode`

Fast content search powered by ripgrep.

### Best For

- Finding identifiers, imports, route names, constants, TODOs, errors, config keys, and string literals.
- Listing files that contain or do not contain a pattern.
- Getting compact match context before deciding which file section to read.

### Key Parameters

| Parameter | Description |
|-----------|-------------|
| `path` | File or directory to search. Relative paths resolve from the workspace root. |
| `pattern` | Text or regex pattern. Use `fixedString=true` for literal search. |
| `mode` | `paginated` (default), `discovery` (file paths only), `detailed` (expanded context), `structural` (AST/shape — use `pattern` or `rule`). |
| `pattern` | ast-grep code-shaped pattern. `$X` = single node, `$$$ARGS` = list. **Only with `mode:"structural"`**. |
| `rule` | YAML relational rule (`not`/`inside`/`has`/`all`/`any`). Add `stopBy: end` for ancestor/descendant relations. **Only with `mode:"structural"`**. |
| `filesOnly` | Return matching file paths only. |
| `filesWithoutMatch` | Return files that do not match. Mutually exclusive with `filesOnly`. |
| `contextLines` | Lines around each match. Max 100. |
| `matchContentLength` | Max characters per individual match snippet. Default 200, max 100000. |
| `maxFiles` | Hard cap on matched files. |
| `maxMatchesPerFile` | Hard cap on matches per file. Pair with `matchPage` to continue. |
| `page` | Result page across matched files. |
| `matchPage` | Per-file match page when a file has more matches. |

### Matching Options

| Parameter | Description |
|-----------|-------------|
| `fixedString` | Treat `pattern` as literal text. Mutually exclusive with `perlRegex`. |
| `perlRegex` | Enable PCRE2 regex features. Mutually exclusive with `fixedString`. |
| `caseSensitive` | Force case-sensitive matching. |
| `caseInsensitive` | Force case-insensitive matching. Mutually exclusive with `caseSensitive`. |
| `wholeWord` | Match whole words only. |
| `multiline` | Enable cross-line matching. |
| `multilineDotall` | Let `.` match newlines. Requires `multiline=true`. |
| `invertMatch` | Return non-matching lines, or with `filesOnly`, files lacking the pattern. |

### Filters

| Parameter | Description |
|-----------|-------------|
| `type` | Ripgrep language/type filter such as `ts`, `js`, `py`, `go`. |
| `include` | Glob patterns to include. |
| `exclude` | Glob patterns to exclude. |
| `excludeDir` | Directory names to skip. |
| `hidden` | Include hidden files. |
| `noIgnore` | Ignore `.gitignore` and `.ignore` files. |
| `sort` | Sort by `path`, `modified`, `accessed`, or `created`. |
| `sortReverse` | Reverse the selected sort direction. |

### Output

Normal results include matched files and match snippets with line and column information. Count modes (`count`, `countMatches`) return counts instead of match bodies.

### Examples

```bash
localSearchCode(path="packages/octocode-mcp/src", pattern="registerTool", type="ts")
localSearchCode(path=".", pattern="TODO", filesOnly=true)
localSearchCode(path="src", pattern="class\\s+\\w+Service", perlRegex=true, contextLines=3)
```

### Structural / AST Search

Use `mode:"structural"` for code-shape queries regex cannot express (find all `await` inside `for` loops, calls with N args, functions missing `try/catch`).

**Supported languages:** ts, tsx, js, jsx, mjs, cjs, py, go, rs, java, c/h, cpp/cc/cxx, cs, sh/bash/zsh.

```bash
localSearchCode(path="src", mode="structural", pattern="console.log($$$ARGS)")
localSearchCode(path="src", mode="structural", rule="rule:\n  pattern: await $C\n  inside:\n    kind: for_statement\n    stopBy: end")
localSearchCode(path=".", mode="structural", pattern="eval($X)")
```

---

## `localViewStructure`

Directory browsing for understanding shape, ownership, and file distribution.

### Best For

- Orienting in a new repository.
- Inspecting package/source/test boundaries.
- Finding likely entry points before content search.

### Key Parameters

| Parameter | Description |
|-----------|-------------|
| `path` | Directory to browse. Relative paths resolve from the workspace root. |
| `depth` | Recursion depth. Max 20. Use low depth first. |
| `page` | Result page. |
| `itemsPerPage` | Directory entries per page. Max 50. |
| `limit` | Hard pre-pagination cap. Max 10000. |
| `filesOnly` | Return files only. |
| `directoriesOnly` | Return directories only. |
| `extensions` | Only include files with selected extensions. |
| `pattern` | Filter entries by glob or substring. |
| `hidden` | Include hidden files and directories. |
| `details` | Include size, permissions, and dates. |
| `humanReadable` | Show sizes as KB/MB. |
| `showFileLastModified` | Include last-modified timestamps. |
| `sortBy` | Sort field. |
| `reverse` | Reverse sort order. |

### Output

`entries[]` contains structured file/directory entries. The response also includes summary and pagination metadata when applicable.

### Examples

```bash
localViewStructure(path=".", depth=1)
localViewStructure(path="packages/octocode-mcp/src", depth=2, directoriesOnly=true)
localViewStructure(path="docs", extensions=["md"], details=true)
```

---

## `localFindFiles`

Metadata search for files and directories.

### Best For

- Finding files by name, extension, regex, path slice, size, permission, or modified time.
- Locating tests, configs, generated files, or recently changed files.
- Metadata search when content search is not needed.

### Key Parameters

| Parameter | Description |
|-----------|-------------|
| `path` | Directory root for metadata search. |
| `name` | Case-sensitive filename glob such as `*.ts`. |
| `iname` | Case-insensitive filename glob. |
| `names` | Multiple filename globs OR-combined. |
| `pathPattern` | Glob matched against the full path. |
| `regex` | Regex path/name search. |
| `regexType` | Regex flavor. |
| `type` | `f` for files, `d` for directories. |
| `minDepth` / `maxDepth` | Depth bounds. |
| `modifiedWithin` | Files modified within a window, such as `7d` or `2h`. |
| `modifiedBefore` | Files modified before a date/window. |
| `accessedWithin` | Files accessed within a window. |
| `sizeGreater` / `sizeLess` | Size filters such as `100k` or `1m`. |
| `empty` | Empty files/directories only. |
| `permissions` | Permission string filter. |
| `executable` / `readable` / `writable` | Permission predicates. |
| `excludeDir` | Directory names to skip. |
| `details` | Include file metadata. |
| `showFileLastModified` | Include modification timestamps. |
| `sortBy` | Sort by `name`, `modified`, `size`, or `created`. |
| `page` | Result page. |
| `itemsPerPage` | Files per page. Max 50. |
| `limit` | Hard pre-pagination cap. Max 10000. |

### Examples

```bash
localFindFiles(path=".", name="*.test.ts")
localFindFiles(path="packages", iname="readme.md")
localFindFiles(path=".", modifiedWithin="24h", type="f", details=true)
```

---

## `localGetFileContent`

Targeted file reading. Use it after structure/search has narrowed the file and section.

### Best For

- Reading a known line range.
- Extracting context around a known string or regex.
- Viewing a small whole file.
- Getting signatures/imports/classes without full bodies.

### Extraction Modes

Choose one main extraction mode:

| Mode | Fields |
|------|--------|
| Match extraction | `matchString`, optional `matchStringContextLines`, `matchStringIsRegex`, `matchStringCaseSensitive` |
| Line range | `startLine` and `endLine` |
| Whole file | `fullContent=true` |
| Structural skeleton | `signaturesOnly=true` |

Do not combine `fullContent` with match or line-range extraction. Do not combine `matchString` with `startLine`/`endLine`.

### Key Parameters

| Parameter | Description |
|-----------|-------------|
| `path` | File path to read. Use `localViewStructure` for directories. |
| `startLine` / `endLine` | 1-based inclusive line range. Use together. |
| `matchString` | Anchor text or regex. |
| `matchStringContextLines` | Lines around each match. Default 5, max 100. |
| `matchStringIsRegex` | Treat `matchString` as regex. |
| `matchStringCaseSensitive` | Case-sensitive match search. |
| `charOffset` / `charLength` | Character pagination for large content. |
| `page` | Continue paginated full-file or match results when the response advertises pages. |
| `signaturesOnly` | Return structural skeleton only. |

### Examples

```bash
localGetFileContent(path="packages/octocode-mcp/src/public.ts", startLine=1, endLine=80)
localGetFileContent(path="README.md", matchString="Configuration", matchStringContextLines=4)
localGetFileContent(path="src/index.ts", signaturesOnly=true)
```

---

## Local Workflows

### Explore A New Repository

```text
localViewStructure(path=root, depth=1)
localViewStructure(path=root+"/src", depth=2)
localFindFiles(path=root, names=["package.json", "tsconfig.json", "README.md"])
localSearchCode(path=root, pattern="export", filesOnly=true)
localGetFileContent(path="README.md", fullContent=true)
```

### Search Then Read

```text
localSearchCode(path="src", pattern="validateInput", contextLines=2)
localGetFileContent(path="src/validation.ts", matchString="validateInput", matchStringContextLines=20)
```

### Find Tests For A Feature

```text
localFindFiles(path=".", names=["*.test.ts", "*.spec.ts"])
localSearchCode(path="tests", pattern="featureName", filesOnly=true)
localGetFileContent(path="tests/feature.test.ts", matchString="featureName")
```

### Inspect Recent Changes

```text
localFindFiles(path=".", modifiedWithin="24h", type="f", details=true)
localSearchCode(path=".", pattern="TODO|FIXME", perlRegex=true)
```

---

## Rules

1. Use `localViewStructure` or `localFindFiles` before reading when the file is unknown.
2. Use `localSearchCode(filesOnly=true)` for fast discovery when match bodies are not needed.
3. Use `localSearchCode` with `contextLines` before opening a large file.
4. Use `localGetFileContent` with `matchString`, `startLine`/`endLine`, or `signaturesOnly` instead of `fullContent` for large files.
5. Use pagination fields when a response advertises `hasMore=true`.

---

## Response Shape

- Bulk envelope: `results[]` with `data`, `hints`, `pagination`, `outputPagination`.
- `localViewStructure` returns structured `entries[]`, not a string.
- `localSearchCode` returns snippets, file-only lists, counts, or files-without-match per mode.
- `localGetFileContent` returns file slices only — not directory listings.

## Anti-Patterns

| Anti-Pattern | Better Approach |
|--------------|-----------------|
| `fullContent=true` on large files | Use `matchString`, line range, or `signaturesOnly` |
| Search without scoping dirs | Use `excludeDir` to skip generated/vendor folders |
| Regex for exact literals | Use `fixedString=true` |
| Combining mutually exclusive flags | Pick one extraction mode |

**Parallelism:** independent queries run in parallel (batch limit: 5 per call). Sequential dependencies (`structure → search → read`) stay sequential.

---

## Related Documentation

- [Clone & Local Tools Workflow](https://github.com/bgauryy/octocode-mcp/blob/main/docs/mcp/CLONE_WORKFLOW.md) - cloning repositories before local analysis.
- [GitHub Tools Reference](https://github.com/bgauryy/octocode-mcp/blob/main/docs/mcp/tools/GITHUB_TOOLS.md) - remote GitHub search, fetch, clone, and PR tools.
- [Configuration Reference](https://github.com/bgauryy/octocode-mcp/blob/main/docs/mcp/CONFIGURATION.md) - environment variables and config file behavior.
