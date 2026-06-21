# Current `octocode grep` Query Reference

**Status:** implementation reference for the current CLI and `localSearchCode`.
For the target OQL contract, read:
https://github.com/bgauryy/octocode/blob/main/docs/octocode-language/OCTOCODE_QUERY_LANGUAGE.md

This document answers one question: what works today?

## Surfaces

Quick CLI:

```bash
octocode grep "useState" ./src
octocode grep "useState" facebook/react/packages/react
octocode grep "useState" packages/react --repo facebook/react
octocode grep ./src --pattern 'eval($X)' --type ts
octocode grep packages/react --repo facebook/react --pattern 'useEffect($$$ARGS)' --type js
```

Raw tool:

```bash
octocode tools localSearchCode --scheme
octocode tools localSearchCode \
  --queries '{"path":"./src","keywords":"useState","mode":"discovery"}'
```

Rule: read `tools localSearchCode --scheme` before constructing raw calls.

## Current Execution Modes

`localSearchCode.mode` currently mixes two ideas: output shape and engine
selection.

| Mode | Meaning today | Future OQL mapping |
|---|---|---|
| `discovery` | matched paths/counts, cheap orientation | `view:"discovery"` |
| `paginated` | default snippets with pages | `view:"paginated"` |
| `detailed` | snippets plus context/metadata | `view:"detailed"` |
| `structural` | AST search with `pattern` or `rule` | `where.pattern` or `where.rule` |

Implementation work should split this into `where` predicates and `view`.

## Text And Regex Fields

Text/regex searches use `keywords`.

| Field | Use |
|---|---|
| `keywords` | text or regex pattern |
| `fixedString` | literal search, mutually exclusive with `perlRegex` |
| `perlRegex` | PCRE2 features such as lookaround/backrefs |
| `caseInsensitive` / `caseSensitive` | mutually exclusive case controls |
| `wholeWord` | word-boundary search |
| `invertMatch` | matching lines are inverted |
| `multiline` / `multilineDotall` | multi-line patterns |

Common examples:

```jsonc
{ "path": "./src", "keywords": "useEffect", "fixedString": true }
{ "path": "./src", "keywords": "use[A-Z]\\w+", "mode": "detailed" }
{ "path": "./src", "keywords": "function\\s+(?=handle)", "perlRegex": true }
```

## File Filters

Filters are orthogonal to text and structural search.

| Field | Use |
|---|---|
| `include` | file glob allowlist, for example `*.ts` |
| `exclude` | file glob denylist |
| `excludeDir` | skip whole directories |
| `langType` | language filter such as `ts`, `js`, `py`, `rust` |
| `hidden` | include dot-files |
| `noIgnore` | ignore `.gitignore`/`.ignore` rules |
| `maxFiles` | cap files returned |

CLI `--type` maps to include globs in quick commands. Raw `localSearchCode`
also exposes `langType`.

## Structural Search

Structural search is local-engine AST search.

Required:

- `mode:"structural"`
- exactly one of `pattern` or `rule`

Examples:

```jsonc
{
  "path": "./src",
  "mode": "structural",
  "pattern": "eval($X)",
  "langType": "ts"
}
```

```jsonc
{
  "path": "./src",
  "mode": "structural",
  "rule": "rule:\n  pattern: await $X\n  not:\n    inside:\n      kind: try_statement\n      stopBy: end",
  "langType": "ts"
}
```

Structural notes:

- `$X` matches one AST node.
- `$$$ARGS` matches a node list.
- Patterns must usually match a complete node.
- YAML rules handle relations such as `inside`, `has`, `not`, `all`, and `any`.
- Ripgrep-only flags such as `onlyMatching`, `unique`, and `countUnique` are not
  valid in structural mode.
- In shells, quote `$` metavariables with single quotes.

## Remote Behavior

Current grep has two external paths:

| CLI shape | Current behavior |
|---|---|
| `octocode grep "x" owner/repo/path` | provider GitHub code search |
| `octocode grep "x" path --repo owner/repo` | materialize remote path, then run local grep |
| `octocode grep path --repo owner/repo --pattern '...'` | materialize remote path, then run local structural search |

This is the precedent for OQL `from.materialize`.

## Counts, Matching, And Pagination

| Field | Use |
|---|---|
| `filesOnly` | return matching file paths only |
| `filesWithoutMatch` | return files missing a pattern |
| `countLinesPerFile` | count matching lines per file |
| `countMatchesPerFile` | count all matches per file |
| `onlyMatching` | return only matched substrings |
| `unique` | unique matched substrings per file, requires `onlyMatching` |
| `countUnique` | unique matched substrings with frequency, requires `onlyMatching` |
| `matchWindow` | context around `onlyMatching` spans |
| `maxMatchesPerFile` | per-file match page size |
| `matchPage` | page matches within a noisy file |
| `itemsPerPage` | files per page |
| `page` | result page |

Use `onlyMatching` for minified one-line files where line snippets are too broad.
Use `matchPage` when one file has many hits.

## LSP Is A Second Hop

`grep` does not silently run semantic navigation. It emits anchors that can feed
`lspGetSemantics`.

Common flow:

```text
grep -> path + line/symbol -> lspGetSemantics -> localGetFileContent proof
```

Supported semantic kinds live in `lspGetSemantics`: definition, references,
callers, callees, callHierarchy, hover, documentSymbols, typeDefinition, and
implementation.

## Current Gaps OQL Should Fix

1. `mode` mixes output shape with structural engine selection.
2. Boolean composition across text, field filters, AST, and LSP is not one typed
   tree yet.
3. Remote-as-local exists in CLI behavior but is not yet a first-class query
   field.
4. Result provenance and planner explanation need to become explicit.
5. Quick-command flags and raw tool fields differ in places, for example
   quick `cat --mode` versus raw content `minify`.

Keep this file current with implementation. Put target design in
`OCTOCODE_QUERY_LANGUAGE.md`; put rollout sequencing in `OPTIMIZATION-PLAN.md`.
