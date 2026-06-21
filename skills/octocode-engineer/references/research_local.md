# Research Local — Local Tools, AST, LSP, Symbols

Use this for local codebases, cloned repos, unpacked archives, local diffs, and any task needing exact `file:line`, AST shape proof, or LSP semantic proof.

## Local CLI ↔ MCP map

| Job | CLI | MCP | Notes |
|---|---|---|---|
| Map directory | `octocode ls <path> --depth N` | `localViewStructure` | First step on unknown trees; identify source/test/generated dirs |
| Find files/dirs | `octocode find <query> [path]` | `localFindFiles` | Names, regex, pathPattern, size, modified time, entryType |
| Text search | `octocode grep <kw> <path>` | `localSearchCode` | Discovery, paginated snippets, detailed context, counts |
| AST search | `octocode ast '<pattern>' <path>` / `--rule` | `localSearchCode(mode:"structural")` | Shape proof; comments/strings never false-match |
| Read file | `octocode cat <file>` | `localGetFileContent` | Use symbols/standard/none, matchString, line ranges |
| Symbols/outline | `octocode symbols <file>` | `lspGetSemantics(type:"documentSymbols")` or `localGetFileContent(minify:"symbols")` | Outline before body reads |
| Semantic nav | `octocode lsp <file> --type <t> --symbol S --line N` | `lspGetSemantics` | Definition, references, callers, callees, callHierarchy, hover, typeDefinition, implementation |

## Default local workflow

```text
localViewStructure(maxDepth:1)                    map package/source dirs first
→ localFindFiles(pathPattern/names/modified/size) slice noisy trees
→ localSearchCode(mode:"discovery")              search all cheaply
→ localGetFileContent(minify:"symbols")          understand declarations
→ localGetFileContent(matchString, minify:"none") exact body + lineHint
→ localSearchCode(mode:"structural")             prove code shape if needed
→ lspGetSemantics(lineHint)                       prove identity/blast radius
```

Rules:
- Do not open with `fullContent` on an unknown file.
- Search result snippets are discovery, not proof. Re-anchor with `matchString` or LSP/AST.
- Always get a real `lineHint` before LSP. Never guess.
- Use directory mapping before broad searches.

## `localViewStructure` — map before search

Use when entering an unfamiliar workspace or subdir.

Important options:
- `recursive:true`, `maxDepth:1|2` — shallow map first, then drill.
- `extensions:["ts","tsx"]` — filter returned files.
- `sortBy:"size"|"time"|"name"`, `details:true` — find large/churn files.
- `itemsPerPage` + `page` — paginate large dirs.

Use it to identify:
- source roots (`src`, `packages/*/src`, `crates/*`, `apps/*`);
- tests/docs/fixtures/generated output;
- noisy dirs to exclude (`dist`, `coverage`, `target`, `out`, generated SDKs).

## `localFindFiles` — metadata search

Use when you need locations, not content.

Patterns:
- Name glob: `names:["*.test.ts", "package.json"]`.
- Basename regex: `regex:"^(index|main)\\.(ts|js)$"`.
- Monorepo slice: `pathPattern:"packages/*/src/**"`.
- Recent work: `modifiedWithin:"24h", showFileLastModified:true, sortBy:"modified"`.
- Large/generated suspects: `sizeGreater:"1m", sortBy:"size"`.
- Directories only: `entryType:"d"`.

## `localSearchCode` — text search

Modes:
- `mode:"discovery"` — matching file paths only; cheapest orientation.
- default/paginated — snippets with line numbers.
- `mode:"detailed"` — snippets plus context.
- counts: `countLinesPerFile:true` or `countMatchesPerFile:true`.

Efficiency:
- Use `langType`, `include`, `excludeDir` before paging noisy results.
- Use `fixedString:true` for literals.
- Use `perlRegex:true` only for advanced regex features.
- Page files with `itemsPerPage/page`; page matches in one file with `maxMatchesPerFile/matchPage`.

## AST structural search

Use when the question is about code shape rather than text:
- `eval($X)` — real eval call with one arg.
- `eval($$$ARGS)` — eval with any arity.
- `$F($X)` — any function call with one arg.
- `$OBJ.$M($$$ARGS)` — any method call.
- `console.$M($$$ARGS)` — debug/log calls.
- `oldApi.$M($$$ARGS)` — migration/API usage.
- `new $C($$$ARGS)` — object construction.
- `throw new $E($$$ARGS)` — thrown error construction.

Rules:
- Use `pattern` for valid code-shaped snippets.
- Use YAML `rule` for `inside` / `has` / `not` / `all` / `any`.
- Add `stopBy: end` to relational sub-rules.
- Include a literal token when possible so files can be pre-filtered before parsing.
- AST is local only. Clone remote repos before AST.

Example relational rule:

```yaml
rule:
  pattern: await $C
  inside:
    kind: for_in_statement
    stopBy: end
```

## `localGetFileContent` — fetch/read proof

Minify modes:
- `symbols` — skeleton with original line gutter; orient first; ignores `matchString`.
- `standard` — readable compressed content.
- `none` — exact raw text for quotes, diffs, security findings.

Extraction modes:
- `matchString` — best proof path; returns `matchRanges[].start` as real lineHint.
- `startLine/endLine` — read known body range.
- `fullContent` — small files only, last resort.

Advanced `matchString`:
- Common symbol: use `matchStringIsRegex:true` and signature anchor, e.g. `export\\s+(async\\s+)?function\\s+NAME\\b`.
- Overloaded/common names: `matchStringCaseSensitive:true`, stricter phrase (`class Name`, `export const name`).
- Need a whole function: raise `contextLines` before reading full file.

## Symbols and LSP

Use `documentSymbols`/`symbols` to orient, then LSP queries for identity.

LSP types:
- `documentSymbols` — file outline, no line needed.
- `definition` — canonical source.
- `hover` — signature/docs/type hints.
- `references` — usages; use `groupByFile:true` for compact output.
- `callers` / `callees` / `callHierarchy` — call flow; strongest TS/JS/Go/Rust.
- `typeDefinition` — type contract behind a value.
- `implementation` — concrete implementation of interface/abstract member; use the member name.

Rules:
- Every non-documentSymbols query requires exact `symbolName` and real `lineHint`.
- If `resolvedSymbol.foundAtLine` is far from your hint, re-anchor.
- Empty `references`/`callers` is not proof of unused; load likely consumers and retry or lower confidence.
- Prefer `format:"compact"`, `groupByFile:true`, `contextLines`, and `depth` controls for token efficiency.
