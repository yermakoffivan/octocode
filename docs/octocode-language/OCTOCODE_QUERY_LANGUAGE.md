# Octocode Query Language

**Status:** north-star language reference for OQL.

This document describes the Octocode Query Language: the typed query object that
agents and humans use to search, fetch, inspect, and prove facts across local
code, GitHub, npm, and future external providers.

This is not an implementation plan. Implementation plans depend on this document.

Companion docs:

- Folder map:
  https://github.com/bgauryy/octocode/blob/main/docs/octocode-language/README.md
- Current `octocode grep` / `localSearchCode` behavior:
  https://github.com/bgauryy/octocode/blob/main/docs/octocode-language/QUERY-LANGUAGE.md
- OQL implementation plan:
  https://github.com/bgauryy/octocode/blob/main/docs/octocode-language/OPTIMIZATION-PLAN.md

## Purpose

OQL gives agents one explicit language for code research:

- discover external candidates
- inspect repository structure
- fetch files, trees, packages, PRs, commits, archives, and binaries
- grep local or materialized external code
- ask AST and LSP questions when the source is local
- continue safely through pagination, offsets, cache locations, and proof hops

The language is a schema, not a raw DSL. OQL borrows familiar ideas from SQL,
Mongo-style predicates, Elasticsearch planning, ripgrep, ast-grep, Semgrep,
GraphQL selection, and LSP, but it stays a typed object.

## Core Rule

**`octocode search` is the universal OQL runner.**

The query's `target`, `from`, `where`, and `fetch` fields decide whether the
operation is discovery, grep, structure browsing, file fetch, materialization,
semantic navigation, package lookup, PR/history research, binary inspection, or
diffing.

Existing commands such as `grep`, `ls`, `cat`, `find`, `lsp`, `clone`, `repo`,
`pkg`, `pr`, `history`, `binary`, and `unzip` remain ergonomic aliases for common
OQL shapes. They should lower into the same language rather than grow separate
semantics.

## Command Semantics

| Command | Meaning in OQL | OQL shape |
|---|---|---|
| `octocode search` | universal OQL entrypoint | any research `target` |
| `octocode grep` | code fact checking | `target:"code"` with text/regex/AST predicates |
| `octocode ls` | structure and symbol orientation | `target:"structure"` or `target:"symbols"` |
| `octocode cat` | bounded content fetch | `target:"content"` with `fetch.content` |
| `octocode find` | file/path/content discovery | `target:"files"` or `target:"code"` |
| `octocode lsp` | semantic proof | `target:"relationships"` |
| `octocode clone` | reusable materialization | `target:"materialization"` |
| `octocode cache fetch` | materialize file/tree/repo | `target:"materialization"` with `fetch.materialize` |
| `octocode repo` | repository discovery | `target:"repos"` |
| `octocode pkg` | package discovery and source handoff | `target:"packages"` |
| `octocode pr` | PR search/detail | `target:"prs"` |
| `octocode history` | commit history | `target:"commits"` |
| `octocode binary` | binary/archive inspection | `target:"binary"` |
| `octocode unzip` | unpack archive for local tools | `target:"materialization"` with `fetch.archive.mode:"unpack"` |
| `octocode diff` | compare two content sources | `target:"diff"` |

Management commands (`install`, `auth`, `login`, `logout`, `status`, `context`,
and cache status/clear) are outside OQL. They operate the product rather than
query a research corpus.

## Query Object

```ts
interface OctocodeQuery {
  target: QueryTarget
  from: QuerySource
  where?: QueryPredicate
  select?: SelectField[]
  view?: QueryView
  fetch?: FetchInstructions
  orderBy?: OrderBy[]
  groupBy?: GroupBy[]
  limit?: number
  page?: number
  itemsPerPage?: number
  explain?: boolean
}
```

Field meanings:

| Field | Meaning |
|---|---|
| `target` | what kind of thing should be returned |
| `from` | source corpus and optional materialization policy |
| `where` | typed predicates and boolean composition |
| `select` | projected result fields and next-hop handles |
| `view` | output density and shape, not match semantics |
| `fetch` | instructions for acquiring tree/file/repo data before or after matching |
| `orderBy` | result ordering |
| `groupBy` | aggregation for discovery/history/package analysis |
| `limit` | bounded result count |
| `page`, `itemsPerPage` | result pagination |
| `explain` | return planner decisions and capability diagnostics |

## Targets

`target` says what the query returns.

| Target | Description | Local | External |
|---|---|---|---|
| `code` | text, regex, AST, or code-shaped matches | localSearchCode | provider code search or remote-as-local |
| `content` | bounded file or diff content | localGetFileContent | ghGetFileContent, PR content, fetched artifact |
| `structure` | tree, directory, file list, repo layout | localViewStructure | ghViewRepoStructure or materialized local tree |
| `files` | file metadata and path discovery | localFindFiles | ghSearchCode `match:"path"` or tree metadata |
| `symbols` | declarations, outlines, semantic locations | LSP/signatures | materialize first, then LSP/signatures |
| `relationships` | definitions, references, callers, callees, implementations | LSP | materialize first, then LSP |
| `binary` | archive, compressed stream, native binary, printable strings | localBinaryInspect | fetch artifact first |
| `diff` | comparison between two bounded content sources | local content diff | fetch both sides, then compare |
| `repos` | repository candidates and metadata | not applicable | ghSearchRepos |
| `packages` | package candidates and source repository handoff | local package metadata later | npmSearch |
| `prs` | pull requests, reviews, patches, comments | not applicable | ghHistoryResearch |
| `commits` | commit history and changed files | later | ghHistoryResearch |
| `materialization` | saved local copy of a repo/file/tree | local path already exists | ghCloneRepo/cache |

## Sources

```jsonc
{ "kind": "local", "path": "./src" }
{ "kind": "github", "repo": "facebook/react" }
{ "kind": "github", "repo": "facebook/react", "ref": "main", "path": "packages/react" }
{ "kind": "npm" }
{ "kind": "materialized", "localPath": "/abs/.octocode/github/facebook/react/packages/react" }
{ "kind": "gitlab", "project": "group/project" } // future
```

Provider sources may include `owner`, `repo`, `org`, `branch`, `ref`, `path`,
`visibility`, and provider-specific capability fields only when the planner can
validate them.

## Materialization

Materialization means: fetch, cache, clone, or unpack external data so local
tools can operate on it.

```ts
type MaterializeMode = "never" | "auto" | "required"

interface MaterializePolicy {
  mode: MaterializeMode
  strategy?: "file" | "tree" | "subtree" | "repo" | "artifact"
  forceRefresh?: boolean
  maxDepth?: number
  sparsePath?: string
  cache?: "reuse" | "refresh"
}
```

Short form:

```jsonc
{
  "from": {
    "kind": "github",
    "repo": "facebook/react",
    "path": "packages/react",
    "materialize": "auto"
  }
}
```

Expanded form:

```jsonc
{
  "from": {
    "kind": "github",
    "repo": "facebook/react",
    "ref": "main",
    "path": "packages/react",
    "materialize": {
      "mode": "required",
      "strategy": "subtree",
      "forceRefresh": false,
      "cache": "reuse"
    }
  }
}
```

Materialization modes:

| Mode | Meaning |
|---|---|
| `never` | Use provider APIs only. Local-only predicates fail with `requiresMaterialization`. |
| `auto` | Use provider pushdown when enough; materialize only when the query asks for local-only capabilities. |
| `required` | Materialize first; fail if source cannot be saved locally. |

Local-only capabilities include AST search, LSP, PCRE-only local matching when
the provider cannot prove it, exact match enumeration, binary/artifact
inspection, and repeated multi-file proof work.

Materialized results must expose `localPath`, `repoRoot`, provider source, ref,
cache status, and continuation hints.

## Fetch Instructions

`fetch` tells OQL how to acquire data. It can appear in the original query or in
a `next.*` continuation.

```ts
interface FetchInstructions {
  tree?: {
    depth?: number
    includeSizes?: boolean
    filesOnly?: boolean
    dirsOnly?: boolean
  }
  content?: {
    path?: string
    range?: { startLine?: number; endLine?: number; contextLines?: number }
    match?: { text: string; regex?: boolean; caseSensitive?: boolean }
    contentView?: "exact" | "compact" | "symbols"
    fullContent?: boolean
  }
  materialize?: MaterializePolicy
  archive?: {
    mode: "inspect" | "list" | "extract" | "decompress" | "strings" | "unpack"
    archiveFile?: string
  }
}
```

Fetch examples:

```jsonc
{
  "target": "structure",
  "from": { "kind": "github", "repo": "facebook/react", "path": "packages/react" },
  "fetch": { "tree": { "depth": 2, "includeSizes": true } },
  "view": "discovery"
}
```

```jsonc
{
  "target": "content",
  "from": { "kind": "github", "repo": "facebook/react", "path": "packages/react/src/ReactHooks.js" },
  "fetch": {
    "content": {
      "match": { "text": "function useState" },
      "range": { "contextLines": 12 },
      "contentView": "exact"
    }
  }
}
```

```jsonc
{
  "target": "materialization",
  "from": {
    "kind": "github",
    "repo": "facebook/react",
    "path": "packages/react",
    "materialize": { "mode": "required", "strategy": "subtree" }
  },
  "select": ["localPath", "repoRoot", "ref", "next.grep", "next.lsp"]
}
```

## Predicates

`where` is a typed predicate tree.

```ts
type QueryPredicate =
  | { all: QueryPredicate[] }
  | { any: QueryPredicate[] }
  | { not: QueryPredicate }
  | { xor: QueryPredicate[] }
  | TextPredicate
  | RegexPredicate
  | AstPredicate
  | StructuralRulePredicate
  | SymbolPredicate
  | RelationshipPredicate
  | FilePredicate
  | MetadataPredicate
  | BinaryPredicate
```

Boolean nodes:

```jsonc
{ "all": [{ "text": "import" }, { "text": "react" }] }
{ "any": [{ "text": "axios" }, { "text": "fetch" }] }
{ "not": { "field": "path", "op": "glob", "value": "**/*.test.ts" } }
```

### Text And Regex

```jsonc
{ "text": "createSession" }
{ "text": "createSession", "fixed": true }
{ "regex": "use[A-Z]\\w+", "dialect": "rust" }
{ "regex": "function\\s+(?=handle)", "dialect": "pcre2" }
```

Options:

| Option | Meaning |
|---|---|
| `fixed` | literal string search |
| `dialect:"rust"` | default ripgrep-compatible regex |
| `dialect:"pcre2"` | lookaround/backreferences |
| `case` | `sensitive`, `insensitive`, or provider default |
| `wholeWord` | whole-word matching |
| `multiline` | allow line-spanning matches |
| `dotAll` | `.` matches newlines when multiline |
| `invert` | return non-matching lines/files where supported |

### AST And Structural Rules

```jsonc
{ "pattern": "useEffect($$$ARGS)", "lang": "tsx" }
```

```jsonc
{
  "rule": "rule:\n  pattern: await $X\n  not:\n    inside:\n      kind: try_statement\n      stopBy: end",
  "lang": "ts"
}
```

Rules:

- `pattern` and `rule` are mutually exclusive.
- `$X` matches one node.
- `$$$ARGS` matches a node list.
- Patterns should match complete AST nodes.
- `rule` supports relational logic such as `inside`, `has`, `not`, `all`, and
  `any`.
- AST predicates are local-only. External AST queries require materialization.

### File And Path Predicates

```jsonc
{ "field": "path", "op": "glob", "value": "packages/*/src/**/*.ts" }
{ "field": "basename", "op": "regex", "value": "^(index|main)\\.(ts|js)$" }
{ "field": "extension", "op": "in", "value": ["ts", "tsx"] }
{ "field": "size", "op": ">", "value": "100k" }
{ "field": "modified", "op": "within", "value": "7d" }
{ "field": "entryType", "op": "=", "value": "file" }
{ "field": "permissions", "op": "=", "value": "755" }
```

Short forms:

```jsonc
{ "path": "src/**/*.ts" }
{ "lang": "ts" }
```

The normalizer expands short forms to explicit `field/op/value` leaves.

### Symbols And Relationships

Symbols are declarations or outline entries. Relationships are semantic
operations anchored to a symbol occurrence.

```jsonc
{
  "symbol": "runCLI",
  "semantic": "references",
  "anchor": { "path": "packages/octocode/src/cli/index.ts", "line": 73 }
}
```

Supported semantic kinds:

| Semantic kind | Meaning |
|---|---|
| `definition` | declaration location |
| `references` | usages of the anchored symbol |
| `callers` | incoming calls |
| `callees` | outgoing calls |
| `callHierarchy` | combined call graph |
| `hover` | type/docs at anchor |
| `documentSymbols` | file outline |
| `typeDefinition` | declared type location |
| `implementation` | concrete implementation |

Rules:

- `documentSymbols` needs a file URI/path, not a symbol.
- Other semantic operations need `symbol` plus `anchor.line`.
- `anchor.order` may disambiguate repeated symbols on the same line.
- LSP is local-only. External semantic queries require materialization.
- `serverUnavailable` or `unsupportedOperation` is a capability diagnostic, not
  proof of absence.

All-symbols request:

```jsonc
{
  "target": "symbols",
  "from": {
    "kind": "github",
    "repo": "facebook/react",
    "path": "packages/react",
    "materialize": "auto"
  },
  "where": { "field": "kind", "op": "in", "value": ["function", "class", "method"] },
  "select": ["path", "symbol", "kind", "range", "container", "next.lspReferences"],
  "view": "discovery",
  "limit": 100
}
```

### Relation Model

OQL relationships must be typed. A relationship query says which layer it uses,
which relation it asks for, and which anchor/scope bounds the work.

```ts
interface RelationshipPredicate {
  relation: RelationKind
  layer?: "syntax" | "semantic" | "derived"
  subject?: SymbolSelector | FileSelector
  object?: SymbolSelector | FileSelector
  anchor?: { path: string; line?: number; symbol?: string; order?: number }
  scope?: { path?: string; depth?: number; includeTests?: boolean }
  direction?: "incoming" | "outgoing" | "both"
}
```

Layers:

| Layer | Backing | Use for | Proof strength |
|---|---|---|---|
| `syntax` | AST/structural search | imports, exports, declarations, class/function containment, call-shaped syntax | syntax exists in matched files |
| `semantic` | LSP | definitions, references, implementations, type definitions, call hierarchy | symbol identity according to language server |
| `derived` | explicit graph over syntax/semantic edges | module dependency graph, reverse dependencies, ownership trees, impact slices | only as strong as its input edges |

Relation kinds should stay explicit and finite:

| Relation kind | Layer | Meaning |
|---|---|---|
| `declares` | syntax | file/module declares a symbol |
| `contains` | syntax | class/module/function contains another symbol or block |
| `imports` | syntax | module imports another module or symbol |
| `importedBy` | derived | reverse of `imports` |
| `exports` | syntax | module exports a symbol |
| `reExports` | syntax | module forwards exports from another module |
| `dependsOn` | derived | file/module depends on another file/module through imports or references |
| `dependedOnBy` | derived | reverse dependency |
| `defines` | semantic | symbol use resolves to a definition |
| `references` | semantic | definition has usages |
| `calls` | semantic | callable has outgoing calls |
| `calledBy` | semantic | callable has incoming calls |
| `implements` | semantic | symbol implements an interface/abstract declaration |
| `typeOf` | semantic | expression or symbol has a type/hover result |
| `typeDefinition` | semantic | symbol resolves to declared type |
| `extends` | syntax | class/interface extends another |
| `decorates` | syntax | decorator/annotation applies to a declaration |
| `throws` | syntax | function contains throw/raise syntax |
| `reads` / `writes` | syntax | code reads or writes a field/variable shape |

Examples:

```jsonc
{
  "target": "relationships",
  "from": { "kind": "local", "path": "./src" },
  "where": {
    "relation": "imports",
    "layer": "syntax",
    "subject": { "path": "src/**/*.ts" },
    "object": { "path": "@octocodeai/*" }
  },
  "select": ["from.path", "to.module", "line", "next.fetch"],
  "view": "discovery"
}
```

```jsonc
{
  "target": "relationships",
  "from": { "kind": "local", "path": "./src" },
  "where": {
    "relation": "calledBy",
    "layer": "semantic",
    "anchor": { "path": "src/server.ts", "line": 42, "symbol": "createSession" },
    "scope": { "depth": 2 }
  },
  "select": ["caller", "path", "line", "range", "next.fetch"],
  "view": "paginated"
}
```

```jsonc
{
  "target": "relationships",
  "from": {
    "kind": "github",
    "repo": "facebook/react",
    "path": "packages/react",
    "materialize": "required"
  },
  "where": {
    "relation": "dependsOn",
    "layer": "derived",
    "subject": { "path": "packages/react/src/**/*.js" },
    "scope": { "depth": 1 }
  },
  "select": ["from.path", "to.path", "via", "confidence", "next.grep"],
  "view": "detailed"
}
```

Rules:

- `syntax` relations can be found with AST patterns/rules and path filters.
- `semantic` relations require a local/materialized source and a real anchor.
- `derived` relations must expose their input edges in provenance.
- OQL must never auto-upgrade `syntax` matches into semantic truth. A call-shaped
  AST match says "this call expression exists"; LSP `calls` says "this symbol is
  called by/within these resolved locations."

### Provider Metadata

Repository predicates:

```jsonc
{ "field": "stars", "op": ">=", "value": 100 }
{ "field": "forks", "op": ">", "value": 50 }
{ "field": "language", "op": "=", "value": "TypeScript" }
{ "field": "topic", "op": "in", "value": ["mcp", "code-search"] }
{ "field": "license", "op": "=", "value": "mit" }
{ "field": "updated", "op": "since", "value": "2025-01-01" }
{ "field": "archived", "op": "=", "value": false }
```

Package predicates:

```jsonc
{ "field": "package", "op": "=", "value": "@octokit/rest" }
{ "text": "react state management" }
{ "field": "repository", "op": "exists", "value": true }
```

PR and history predicates:

```jsonc
{ "field": "state", "op": "=", "value": "merged" }
{ "field": "author", "op": "=", "value": "octocat" }
{ "field": "label", "op": "in", "value": ["bug", "performance"] }
{ "field": "created", "op": "range", "value": "2025-01-01..2025-12-31" }
{ "field": "path", "op": "glob", "value": "packages/*/src/**" }
```

Provider predicates should push down when the provider supports them. Otherwise
they must become residual, route to another lane, or fail loudly.

### Binary And Archive Predicates

```jsonc
{ "field": "binary.mode", "op": "=", "value": "strings" }
{ "regex": "ghp_[A-Za-z0-9_]{36}", "dialect": "pcre2" }
{ "field": "archive.file", "op": "glob", "value": "**/*.js" }
```

Binary and archive work is local-only. External artifacts must be fetched first.

## Views

`view` controls output density only.

| View | Meaning |
|---|---|
| `discovery` | cheapest orientation: paths, names, counts, minimal fields |
| `paginated` | default result page with snippets or rows |
| `detailed` | context, metadata, match ranges, diagnostics |
| `explain` | planner decisions and capability checks |

Search engine selection belongs to predicates and planner capability checks, not
to `view`.

## Selection

`select` is projection. It asks for fields, not execution behavior.

Common fields:

```jsonc
["path", "line", "endLine", "snippet", "match", "score", "next"]
["repo", "description", "stars", "pushedAt", "topics", "next.structure"]
["package", "version", "description", "repository", "next.source"]
["symbol", "kind", "range", "container", "next.lspReferences"]
["localPath", "repoRoot", "ref", "cache", "next.grep"]
```

Heavy content must be requested through `target:"content"` or `next.fetch`, not
by selecting entire files from search rows.

## Content View

OQL uses `contentView` for content density.

| OQL `contentView` | Current backing value | Meaning |
|---|---|---|
| `exact` | `minify:"none"` | exact raw text for quotes, patches, diffs |
| `compact` | `minify:"standard"` | compact readable content |
| `symbols` | `minify:"symbols"` | outline/skeleton with line anchors |

`contentView` applies to content fetches, not to search semantics.

PR/diff content may support only `exact` and `compact`.

## Pagination And Continuations

OQL has multiple pagination domains. They must not be conflated.

| Domain | Controls | Current backing examples |
|---|---|---|
| result rows | `page`, `itemsPerPage`, `limit` | search pages, repo pages, tree pages |
| matches inside one file | `matchPage`, `maxMatchesPerFile` | localSearchCode match paging |
| content bytes/chars | `charOffset`, `charLength` | local/GitHub content, PR body/patches |
| archive entries | `entryPage`, `entriesPerPage` | localBinaryInspect list |
| binary string scan | `scanOffset` | localBinaryInspect strings |
| PR details | `filePage`, `commentPage`, `commitPage`, `commentBodyOffset` | ghHistoryResearch |

Continuation rule:

```text
Use offsets and next-page values returned by the previous result. Do not compute
offsets manually.
```

Every partial result should include a continuation handle:

```jsonc
{
  "pagination": {
    "kind": "content",
    "hasMore": true,
    "next": {
      "target": "content",
      "from": { "kind": "local", "path": "/abs/file.ts" },
      "fetch": { "content": { "contentView": "compact" } },
      "charOffset": 50000,
      "charLength": 50000
    }
  }
}
```

## Result Envelope

Every OQL response should use this shape.

```jsonc
{
  "results": [],
  "pagination": {},
  "next": {},
  "diagnostics": [],
  "provenance": {
    "source": "github",
    "engine": "remote-as-local",
    "materialized": true,
    "localPath": "/abs/.octocode/github/facebook/react/packages/react"
  },
  "evidence": {
    "answerReady": false,
    "complete": false,
    "kind": "search"
  }
}
```

Result rows should be typed:

```jsonc
{
  "kind": "codeMatch",
  "path": "src/index.ts",
  "range": { "startLine": 40, "endLine": 44 },
  "match": { "text": "createSession", "column": 12 },
  "snippet": "const session = createSession(...)",
  "next": {
    "fetch": {},
    "lspDefinition": {},
    "lspReferences": {}
  },
  "provenance": {
    "predicateIds": ["p1", "p2"],
    "engine": "localSearchCode"
  }
}
```

## Diagnostics

Diagnostics are part of the language. They prevent agents from confusing
capability limits with evidence.

Common diagnostics:

| Diagnostic | Meaning |
|---|---|
| `unsupportedPredicate` | selected source cannot run the predicate |
| `requiresMaterialization` | local-only feature requested against provider-only source |
| `materializationFailed` | clone/fetch/cache failed |
| `partialResult` | more result pages exist |
| `contentTruncated` | content was cut by char limit |
| `matchTruncated` | matches were capped |
| `parserFailed` | AST parse failed for some files |
| `lspUnavailable` | language server unavailable |
| `unsupportedSemanticOperation` | LSP server lacks that operation |
| `rateLimited` | provider rate limit |
| `staleCache` | cached result may be older than requested |
| `sanitized` | secrets or unsafe paths were redacted |
| `providerUnindexed` | provider search may not cover the repo |
| `zeroMatches` | query executed successfully and found nothing |

## Planner Semantics

The OQL planner assigns every predicate one mode per source.

| Mode | Meaning |
|---|---|
| `PUSHDOWN` | backend can evaluate the predicate directly |
| `RESIDUAL` | fetch bounded candidates and filter locally |
| `ROUTE` | send work to another lane, such as remote-as-local |
| `UNSUPPORTED` | fail with diagnostics and repair hints |

Invariant:

```text
pushed predicates + residual predicates + routed predicates == all predicates
```

No predicate may be silently dropped.

## Backend Mapping

| OQL concept | Current backing |
|---|---|
| local text/regex/code search | `localSearchCode` |
| local AST pattern/rule search | `localSearchCode mode:"structural"` |
| local tree | `localViewStructure` |
| local file metadata | `localFindFiles` |
| local content | `localGetFileContent` |
| local LSP | `lspGetSemantics` |
| local archives/binaries | `localBinaryInspect` |
| GitHub code search | `ghSearchCode` |
| GitHub file content | `ghGetFileContent` |
| GitHub tree | `ghViewRepoStructure` |
| GitHub materialization | `ghCloneRepo` |
| GitHub repository discovery | `ghSearchRepos` |
| GitHub PR/commit history | `ghHistoryResearch` |
| npm package discovery | `npmSearch` |

## Coverage Against Current Resources

This section maps the current `octocode-core` tool and CLI resource fields into
OQL concepts. The goal is one language with typed families, not one giant flat
option list.

### Tool Schema Coverage

| Current tool | Current field families | OQL coverage |
|---|---|---|
| `ghSearchCode` | keywords, owner/repo/path, extension/filename/language, match file/path, concise, limit/page | `target:"code"` or `target:"files"`, provider source, text/path predicates, `view`, pagination |
| `ghGetFileContent` | owner/repo/ref/path, line range, match string/regex, full content, force refresh, file/directory type, context, char offsets, minify | `target:"content"`, `fetch.content`, `fetch.tree`, `contentView`, char pagination, cache refresh |
| `ghViewRepoStructure` | owner/repo/ref/path, depth, page/items, sizes | `target:"structure"`, `fetch.tree`, bounded tree pagination |
| `ghSearchRepos` | keywords/topics/language/owner/stars/forks/license/size/dates/archived/visibility/match/sort/concise/page | `target:"repos"`, provider metadata predicates, `orderBy`, `view`, pagination |
| `ghHistoryResearch` | PR/commit mode, dates, path/ref, PR filters, labels/users/reviews/checks, list/detail content selectors, patches/comments/commits, char and item pagination, minify | `target:"prs"` and `target:"commits"`, provider metadata predicates, `fetch.content`, `contentView`, PR-specific pagination |
| `npmSearch` | packageName, mode, page | `target:"packages"`, package predicates, `view:"discovery"` vs detailed/full, pagination |
| `ghCloneRepo` | owner/repo/ref, sparsePath, forceRefresh | `target:"materialization"`, `from.materialize`, cache refresh |
| `localSearchCode` | keywords, regex flags, mode, pattern/rule, include/exclude/langType, hidden/noIgnore, counts, onlyMatching, match window/page, sort/ranking, page/items | `target:"code"`, text/regex/AST predicates, file predicates, `view`, `orderBy`, ranking/debug fields, match pagination |
| `localViewStructure` | path, details, hidden, sort, pattern, file/dir filters, recursive/depth, extensions, limit/page/items | `target:"structure"`, tree fetch, file predicates, `view`, pagination |
| `localFindFiles` | depth, name/path/regex, empty, time/size/permission/readability, exclude dirs, details, sort, entry type, page/items | `target:"files"`, file metadata predicates, `orderBy`, pagination |
| `localGetFileContent` | path, full content, match string/regex, line range, context, char offsets, minify | `target:"content"`, `fetch.content`, `contentView`, char pagination |
| `lspGetSemantics` | uri, semantic type, symbol, line/order hint, depth, include declaration, group by file, page/items, context, format, workspaceRoot | `target:"symbols"` and `target:"relationships"`, semantic predicates, anchor, workspace, pagination, view/format |
| `localBinaryInspect` | path, inspect/list/extract/decompress/strings/unpack, detailed/verbose, archive entry, match, char offsets, compression format, strings offsets/scan/page | `target:"binary"` or `target:"materialization"`, `fetch.archive`, binary predicates, archive/string pagination |

### CLI Coverage

| Current CLI command | OQL status |
|---|---|
| `cat` | alias for `target:"content"` |
| `ls` | alias for `target:"structure"` or `target:"symbols"` |
| `grep` | alias for `target:"code"` |
| `find` | alias for `target:"files"` plus optional `target:"code"` |
| `diff` | alias for `target:"diff"` |
| `pr` | alias for `target:"prs"` |
| `history` | alias for `target:"commits"` |
| `repo` | alias for `target:"repos"` |
| `pkg` | alias for `target:"packages"` |
| `binary` | alias for `target:"binary"` |
| `unzip` | alias for `target:"materialization"` via archive unpack |
| `clone` | alias for `target:"materialization"` via Git clone/cache |
| `cache fetch` | alias for `target:"materialization"` |
| `lsp` | alias for `target:"relationships"` |
| `context`, `install`, `auth`, `login`, `logout`, `status`, `cache status`, `cache clear` | outside OQL; product operation/diagnostics |

### Normalized Parameter Families

OQL covers current parameters through these families:

| Family | Examples |
|---|---|
| source identity | `kind`, `path`, `repo`, `owner`, `ref`, `branch`, `package`, `uri`, `localPath` |
| materialization | `materialize.mode`, `strategy`, `sparsePath`, `forceRefresh`, `cache` |
| text/regex matching | `text`, `regex`, `fixed`, `dialect`, `case`, `wholeWord`, `multiline`, `dotAll`, `invert` |
| AST/structural matching | `pattern`, `rule`, `lang`, metavariables |
| file metadata | path globs, names, extension, depth, type, size, times, permissions, hidden/noIgnore |
| provider metadata | stars, forks, topics, language, license, archived, visibility, PR state, labels, reviewers, dates |
| semantic relationships | symbol, semantic type, anchor line/order, workspace root, depth, groupByFile |
| fetch/read controls | tree depth, content range, match slices, full content, contentView/minify |
| binary/archive controls | inspect/list/extract/decompress/strings/unpack, archive entry, compression format, offsets |
| result shaping | `select`, `view`, concise/full, detailed/compact, `orderBy`, ranking/debug |
| pagination | page/items, match page, char offsets, archive entry pages, string scan offsets, PR file/comment/commit pages |

Conclusion: OQL can cover the current research surface with one language. The
universal `octocode search` command can cover all research commands if it accepts
full OQL input. Existing quick commands should remain as convenience shorthands
that compile into OQL.

## Examples

### Universal `octocode search`

`octocode search` should accept a full OQL object. The target decides which
capability runs.

```bash
octocode search --query '{
  "target": "code",
  "from": {
    "kind": "github",
    "repo": "facebook/react",
    "path": "packages/react",
    "materialize": "auto"
  },
  "where": {
    "pattern": "useEffect($$$ARGS)",
    "lang": "js"
  },
  "select": ["repo", "localPath", "path", "line", "snippet", "next.lspReferences"],
  "view": "detailed",
  "limit": 50
}'
```

The same command can run repository discovery, package lookup, content fetch,
tree browsing, semantic relationships, PR/history research, binary inspection,
or materialization by changing `target` and `fetch`.

### Local Regex Grep

```jsonc
{
  "target": "code",
  "from": { "kind": "local", "path": "./packages/octocode/src" },
  "where": {
    "regex": "execute[A-Z]\\w+",
    "dialect": "rust",
    "case": "sensitive"
  },
  "select": ["path", "line", "snippet", "next.fetch", "next.lspDefinition"],
  "view": "paginated",
  "limit": 25
}
```

### Local PCRE2

```jsonc
{
  "target": "code",
  "from": { "kind": "local", "path": "./src" },
  "where": { "regex": "function\\s+(?=handle)", "dialect": "pcre2" },
  "view": "detailed"
}
```

### Local AST Rule

```jsonc
{
  "target": "code",
  "from": { "kind": "local", "path": "./src" },
  "where": {
    "rule": "rule:\n  pattern: await $X\n  not:\n    inside:\n      kind: try_statement\n      stopBy: end",
    "lang": "ts"
  },
  "select": ["path", "line", "snippet", "metavars", "next.fetch"],
  "view": "detailed"
}
```

### External Grep Through Materialization

```jsonc
{
  "target": "code",
  "from": {
    "kind": "github",
    "repo": "facebook/react",
    "path": "packages/react",
    "materialize": "auto"
  },
  "where": {
    "all": [
      { "field": "extension", "op": "=", "value": "js" },
      { "pattern": "useEffect($$$ARGS)", "lang": "js" }
    ]
  },
  "select": ["repo", "localPath", "path", "line", "snippet", "next.fetch", "next.lspReferences"],
  "view": "detailed",
  "limit": 50
}
```

### Fetch Tree, Then Grep

```jsonc
{
  "target": "structure",
  "from": {
    "kind": "github",
    "repo": "facebook/react",
    "path": "packages/react"
  },
  "fetch": { "tree": { "depth": 2, "includeSizes": true } },
  "select": ["path", "type", "size", "next.grep", "next.materialize"],
  "view": "discovery"
}
```

A returned `next.grep` may look like:

```jsonc
{
  "target": "code",
  "from": {
    "kind": "github",
    "repo": "facebook/react",
    "path": "packages/react/src",
    "materialize": "auto"
  },
  "where": { "text": "useState" },
  "view": "paginated"
}
```

### Fetch File Content

```jsonc
{
  "target": "content",
  "from": {
    "kind": "github",
    "repo": "facebook/react",
    "path": "packages/react/src/ReactHooks.js"
  },
  "fetch": {
    "content": {
      "match": { "text": "function useState" },
      "range": { "contextLines": 12 },
      "contentView": "exact"
    }
  },
  "select": ["path", "content", "range", "matchRanges", "next.lspReferences"]
}
```

### LSP References Over Remote Source

```jsonc
{
  "target": "relationships",
  "from": {
    "kind": "github",
    "repo": "facebook/react",
    "path": "packages/react/src/ReactHooks.js",
    "materialize": "required"
  },
  "where": {
    "symbol": "useState",
    "semantic": "references",
    "anchor": { "path": "packages/react/src/ReactHooks.js", "line": 72 }
  },
  "select": ["path", "line", "symbol", "relationship", "next.fetch"],
  "view": "paginated"
}
```

### Repository Discovery

```jsonc
{
  "target": "repos",
  "from": { "kind": "github" },
  "where": {
    "all": [
      { "text": "code search" },
      { "field": "language", "op": "=", "value": "TypeScript" },
      { "field": "stars", "op": ">=", "value": 100 },
      { "field": "archived", "op": "=", "value": false }
    ]
  },
  "select": ["repo", "description", "stars", "pushedAt", "topics", "next.structure"],
  "orderBy": [{ "field": "stars", "direction": "desc" }],
  "limit": 25
}
```

### Package To Source

```jsonc
{
  "target": "packages",
  "from": { "kind": "npm" },
  "where": { "field": "package", "op": "=", "value": "zod" },
  "select": ["package", "version", "repository", "repositoryDirectory", "next.source"]
}
```

### PR Patch Slice

```jsonc
{
  "target": "prs",
  "from": { "kind": "github", "repo": "owner/repo" },
  "where": {
    "all": [
      { "field": "state", "op": "=", "value": "merged" },
      { "field": "label", "op": "=", "value": "performance" }
    ]
  },
  "fetch": {
    "content": { "contentView": "compact" }
  },
  "select": ["number", "title", "state", "changedFiles", "next.patch", "next.grep"]
}
```

### Binary Strings

```jsonc
{
  "target": "binary",
  "from": { "kind": "local", "path": "./dist/addon.node" },
  "fetch": { "archive": { "mode": "strings" } },
  "where": {
    "any": [
      { "regex": "ghp_[A-Za-z0-9_]{36}", "dialect": "pcre2" },
      { "text": "BEGIN PRIVATE KEY" }
    ]
  },
  "select": ["path", "offset", "string", "redaction", "pagination"]
}
```

## Validation Rules

- `target`, `from`, and source identity are required.
- `where.pattern` and `where.rule` are mutually exclusive.
- Structural predicates require language inference or explicit `lang`.
- Text-only flags are invalid for structural predicates.
- `regex.dialect:"pcre2"` is required for lookaround and backreferences.
- LSP predicates require a local or materialized source plus a real anchor.
- Relationship predicates must declare a finite `relation` kind and a `layer`
  unless the relation kind is unambiguous.
- `layer:"semantic"` requires LSP-capable local/materialized source and a real
  file/symbol/line anchor, except for file-wide `documentSymbols`.
- `layer:"derived"` must expose provenance for the syntax/semantic edges used to
  compute the derived relation.
- Provider-only queries must fail on local-only predicates.
- `select` cannot request unbounded content from search rows.
- Continuation offsets must come from prior results.
- Semantic behavior must be explicit through `target:"relationships"` or
  `target:"symbols"`; stale or legacy semantic-ranking fields should produce a
  diagnostic instead of hidden LSP work.
- Results must distinguish true zero matches from unsupported, partial, stale,
  sanitized, parser-failed, and rate-limited states.

## Agent Rules

Agents using OQL should:

1. Start with `view:"discovery"` or provider search when the scope is unknown.
2. Materialize only bounded repo/path/ref scopes.
3. Use `contentView:"symbols"` or `view:"discovery"` for orientation.
4. Use exact content fetches only for quotes, diffs, or final proof.
5. Treat AST as syntax proof and LSP as semantic proof.
6. Follow `next.*` handles instead of inventing paths, line numbers, or offsets.
7. Prefer `relationships`/LSP for identity questions and `code`/grep for text
   existence questions.
8. Use `layer:"syntax"` for file/module/class/function shape questions and
   `layer:"semantic"` for symbol identity questions.
9. Treat derived dependency or impact graphs as explainable summaries, not raw
   proof, unless their input edges are present.
10. Treat diagnostics as evidence about capability, not just errors.

## Anti-goals

- No SQL joins.
- No raw string DSL.
- No hidden full-repo crawling.
- No hidden LSP escalation for every grep.
- No provider syntax leaking into generic fields.
- No unbounded full-file content in search results.
- No external AST/LSP without bounded materialization.
