# OQL Implementation Plan

**Status:** implementation plan for Octocode Query Language and `grep`/`search`
readiness.

Target contract:
https://github.com/bgauryy/octocode/blob/main/docs/octocode-language/OCTOCODE_QUERY_LANGUAGE.md

Current grep reference:
https://github.com/bgauryy/octocode/blob/main/docs/octocode-language/QUERY-LANGUAGE.md

## Goal

Ship OQL without inventing a new engine.

OQL should compile typed query objects into the tools Octocode already has:
provider search, remote materialization, local ripgrep, structural AST search,
LSP, content fetch, structure browsing, and binary inspection.

## Ownership Rules

Follow the monorepo architecture:

| Layer | Owns |
|---|---|
| `@octocodeai/octocode-core` | schemas, descriptions, command metadata |
| `packages/octocode-tools-core` | planner, execution, adapters, result contracts |
| `packages/octocode-engine` | native primitives: ripgrep parsing, structural search, LSP, minify, binary |
| `packages/octocode` | CLI parsing and rendering only |
| `packages/octocode-mcp` | MCP registration only |

No OQL business logic should live in CLI or MCP interface packages.

## Build Order

### 0. Freeze Docs And Examples

Outcome: the docs are short enough to implement from.

Tasks:

- Keep this plan as the sequencing source of truth.
- Keep `OCTOCODE_QUERY_LANGUAGE.md` as the target contract.
- Keep `QUERY-LANGUAGE.md` as current behavior reference.
- Add or update examples only when they map to a planned implementation slice.

Done when:

- Each doc has one job.
- No doc repeats the full design from another doc.
- All doc links use absolute GitHub URLs.

### 1. Add OQL Schema Types

Outcome: OQL input can be validated before planning.

Tasks:

- Add query schema in `@octocodeai/octocode-core`.
- Model `target`, `from`, `where`, `select`, `view`, `limit`, `page`, and
  `explain`.
- Add `from.materialize: "auto" | "never" | "required"` for external code.
- Normalize short forms, for example `{ "path": "**/*.ts" }`.
- Keep current `localSearchCode` schema working while OQL is opt-in.

Tests:

- Valid local text query.
- Valid structural query.
- Valid remote-as-local query.
- Invalid mixed predicates fail loudly.
- Unsupported provider/local-only combinations produce diagnostics.

Done when:

- A Zod schema accepts the documented examples.
- Invalid states are rejected before execution.

### 2. Build The Planner

Outcome: OQL becomes a deterministic execution plan.

Tasks:

- Classify predicates by lane: structure, text, regex, AST, LSP, provider
  metadata, package metadata, binary.
- Assign each predicate an execution mode: `PUSHDOWN`, `RESIDUAL`, `ROUTE`, or
  `UNSUPPORTED`.
- Preserve the invariant:

```text
pushed predicates + residual predicates + routed predicates == all predicates
```

- Add `explain:true` output before executing heavy operations.
- Add provenance for which engine handled each predicate.

Tests:

- Text local -> local ripgrep.
- Text GitHub -> provider pushdown.
- AST GitHub with `materialize:"auto"` -> remote-as-local route.
- AST GitHub with `materialize:"never"` -> unsupported diagnostic.
- Mixed `path + text + AST` plans cheapest filters first.

Done when:

- Planner output is stable and snapshot-testable.
- No predicate can disappear.

### 3. Adapt Local Grep

Outcome: OQL can execute against local paths through current `localSearchCode`.

Tasks:

- Compile `where.text` and `where.regex` to `keywords` plus flags.
- Compile `where.pattern` and `where.rule` to `mode:"structural"`.
- Compile file predicates to `include`, `exclude`, `excludeDir`, `langType`, or
  local file filters.
- Compile `view` to current `mode` values where possible.
- Preserve `onlyMatching`, counts, match pagination, and result pagination.

Tests:

- OQL text result equals equivalent current grep result.
- OQL structural result equals equivalent current structural grep result.
- `view:"discovery"` stays path-oriented.
- `view:"detailed"` includes context.
- Pagination and `next.fetch` survive translation.

Done when:

- `localSearchCode` can run OQL and legacy inputs side by side.

### 4. First-class Remote-as-local

Outcome: external code can use local-only power in a bounded, explicit way.

Tasks:

- Move CLI `--repo` materialization behavior into a reusable tools-core planner
  lane.
- Materialize only bounded repo/path/ref scopes.
- Return `localPath`, `repoRoot`, ref, cache state, and cleanup/refresh hints.
- Route AST, LSP, PCRE-only matching, exact local-only enumeration, and other
  local-engine needs through this lane.
- Respect `materialize:"never"` and `materialize:"required"`.

Tests:

- GitHub text query can stay provider-only.
- GitHub AST query routes through materialization.
- Materialization disabled yields `requiresMaterialization`.
- Materialized results can feed `next.fetch` and `next.lsp*`.

Done when:

- `octocode grep` and raw tools share one remote-as-local implementation path.

### 5. Add OQL Result Contract

Outcome: results are easy for agents to continue safely.

Tasks:

- Standardize `results`, `pagination`, `next`, `diagnostics`, and `provenance`.
- Distinguish zero matches from unsupported, truncated, parser-failed,
  rate-limited, sanitized, or stale results.
- Keep content bounded; use `next.fetch` for exact proof.
- Add `contentView` names for future OQL while mapping to current `minify`.

Tests:

- Empty-but-supported result.
- Unsupported predicate result.
- Truncated/paginated result.
- Secret-sanitized result.
- Materialized result with local continuation.

Done when:

- Agents can decide whether to stop, page, fetch, grep, or use LSP without
  parsing prose.

### 6. Implement `octocode search`

Outcome: external discovery uses the same query model.

Tasks:

- Support `target:"repos"`, `target:"packages"`, `target:"code"`,
  `target:"prs"`, and `target:"commits"` by provider capability.
- Compile provider-supported predicates to pushdown filters.
- Mark provider-limited predicates as residual, route, or unsupported.
- Emit `next.grep` handles for proof-capable follow-up.

Tests:

- GitHub repo search by text/language/stars.
- npm package search by text/package fields.
- GitHub code search by text/path/ref.
- Unsupported package AST query fails loudly.
- Search result can route to grep remote-as-local.

Done when:

- `search` discovers candidates and `grep` proves them with the same OQL shape.

### 7. CLI And MCP Surfaces

Outcome: interfaces stay thin.

Tasks:

- Add CLI support for OQL JSON input or a named `--query` surface.
- Keep quick commands as ergonomic shorthands.
- Ensure MCP tool schemas come from `octocode-core`.
- Do not duplicate planner logic in CLI or MCP.
- Update help text to point users to `--scheme` and OQL examples.

Tests:

- Quick `grep` still works.
- Raw legacy `tools localSearchCode` still works.
- OQL `grep` works through CLI.
- OQL works through MCP with the same schema.

Done when:

- The same query shape works from both CLI and MCP.

## Implementation Risks

| Risk | Mitigation |
|---|---|
| OQL becomes a second DSL | Keep it a Zod object and compile to existing tool fields. |
| Provider APIs cannot prove predicates | Use `RESIDUAL`, `ROUTE`, or `UNSUPPORTED`; never silently drop. |
| Remote materialization becomes unbounded | Require repo/path/ref bounds and explicit limits. |
| AST and LSP get blurred | AST proves syntax in files; LSP proves semantic project relations. |
| CLI/MCP drift | Keep schemas/descriptions in `octocode-core`, execution in tools-core. |
| Result blobs grow too large | Use `view`, pagination, and `next.fetch` continuations. |

## Not Now

- Replacing ripgrep.
- Replacing the structural engine.
- Inventing SQL-like joins.
- Global semantic indexing of GitHub.
- Hidden clone of broad org/user scopes.
- Retiring quick commands before OQL parity tests exist.

## Minimum Viable OQL

The smallest useful release is:

1. Local OQL grep for text, regex, file filters, and structural search.
2. Planner `explain:true`.
3. Standard result envelope with `next.fetch`.
4. Remote-as-local for GitHub repo/path with `materialize:"auto"`.
5. Clear unsupported diagnostics for everything else.

After that, add `octocode search` targets and richer provider routing.
